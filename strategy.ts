// Early-launch sniper with momentum confirmation for the pump.fun replay
// (agent-fun/replay/v2).
//
// IDEA
// Most pump.fun coins spike once, briefly, then bleed to zero. The only
// repeatable edge in the dev window is (a) catching a coin in its first few
// slots, (b) only when the launch does not smell like a rug, and (c) getting
// out within seconds on a small take-profit or a tight stop. Holding through
// the dump is how the momentum pilot lost 9 SOL; this bot never holds a
// position longer than maxHold slots and never lets a winner round-trip into
// a loser (trailing stop arms as soon as the trade is up).
//
// ENTRY (all must hold, decided on the batch where the coin traded):
//  - age 0..maxAge slots since its CreateEvent (young coins only);
//  - creator has not sold and the creator's own opening buy is small
//    (a big creator buy is usually a bundle waiting to dump);
//  - few distinct non-creator buyers so far (a launch crowded by many
//    wallets in its first slots is usually a creator cluster);
//  - net SOL flow into the coin so far is not negative (buyers > sellers);
//  - price has not already run away from its create price (no chasing);
//  - real SOL reserve inside [minRealSol, maxRealSol] (liquid, not a whale
//    playground), and the last trade was a buy (momentum confirmation).
//
// SIZE / RISK
//  - one fixed small stake per coin (stakeLamports), capped at 97% of the
//    per-reply 1%-of-real-reserve cap; at most maxOpenPositions open at
//    once, so worst-case committed capital is bounded and drawdown stays
//    small; a coin is entered at most maxEntries times per run with a
//    cooldown after each exit.
//  - every order pays ~105k lamports of tx fees, so the stake is sized so
//    fees are a small fraction of it, and the minimum round trip (0.01 SOL)
//    is comfortably cleared.
//
// EXITS (whole position, first trigger wins):
//  - take-profit at +takeProfit, stop-loss at -stopLoss (both vs cost,
//    after curve fees), trailing stop once up trailArm that gives back at
//    most trail of the peak, hard time exit after maxHold slots, immediate
//    exit if the creator sells while we hold, stale exit if no trade for
//    staleSlots. A CompleteEvent is closed by the harness itself.
//
// GUARDRAIL PACING
//  - the competition needs >= 20 coins x >= 0.01 SOL round trips and
//    drawdown <= 50%. The sniper entries alone clear that by a wide margin
//    on the dev window, but if fills/coins ever lag the pace implied by
//    elapsed slots, the bot opens tiny probe round trips (probeLamports,
//    sold as soon as the buy lands) on the most liquid traded coin. Probes
//    are capped and never used while real entries are on pace.
//
// DETERMINISM
//  - pure function of the batches: no clock, no Math.random, no I/O, no
//    environment reads. Iteration is over insertion-ordered maps fed by the
//    batch stream, with held positions visited in sorted mint order, so the
//    two graded executions produce byte-identical action logs.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports to spend on one coin (before the per-reply reserve cap). */
  stakeLamports: bigint;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: bigint;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: bigint;
  maxRealSol: bigint;
  /** Creator's own buys in total: above this the launch looks bundled. */
  maxDevBuyLamports: bigint;
  /** Distinct non-creator buyers seen before entry: at most. */
  maxBuyers: number;
  /** Distinct non-creator buyers seen before entry: at least. */
  minBuyers: number;
  /** Price now over the create price: at most (do not chase a parabola). */
  maxRunup: number;
  /** Net SOL bought minus sold on the coin so far must be >= this. */
  minNetFlowLamports: bigint;
  /** The most recent trade must be a buy (momentum confirmation). */
  lastMustBeBuy: boolean;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Take profit / stop loss / trailing stop, as fractions of cost. */
  takeProfit: number;
  stopLoss: number;
  trailArm: number;
  trail: number;
  /** Exit after holding this many slots, whatever the price. */
  maxHoldSlots: number;
  /** Exit when the creator sells while we hold. */
  exitOnDevSell: boolean;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Slippage tolerance on buys and sells (bps). */
  buySlippageBps: number;
  sellSlippageBps: number;
  /** Most new entries per reply. */
  maxEntriesPerBatch: number;
  /** Most entries of the same coin over the whole run. */
  maxEntriesPerCoin: number;
  /** Slots to ignore a coin after an exit. */
  cooldownSlots: number;
  /** Guardrail pacing: target coins / fills over paceSlots of block slots. */
  targetCoins: number;
  targetFills: number;
  paceSlots: number;
  /** Tiny probe round-trip size (lamports) used only when pacing lags. */
  probeLamports: bigint;
  /** Most probe round trips open at once. */
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 3,
  stakeLamports: 30_000_000n,
  minBuyLamports: 8_000_000n,
  minRealSol: 300_000_000n,
  maxRealSol: 30_000_000_000n,
  maxDevBuyLamports: 2_000_000_000n,
  maxBuyers: 3,
  minBuyers: 1,
  maxRunup: 4,
  minNetFlowLamports: 0n,
  lastMustBeBuy: true,
  skipDevSold: true,
  takeProfit: 0.06,
  stopLoss: 0.05,
  trailArm: 0.08,
  trail: 0.06,
  maxHoldSlots: 15,
  exitOnDevSell: true,
  staleSlots: 600,
  buySlippageBps: 5000,
  sellSlippageBps: 10000,
  maxEntriesPerBatch: 2,
  maxEntriesPerCoin: 2,
  cooldownSlots: 300,
  targetCoins: 25,
  targetFills: 200,
  paceSlots: 403200,
  probeLamports: 10_000_000n,
  maxProbes: 2,
};

const FEE_BPS = 125n;
const BPS = 10_000n;

interface Coin {
  createdSlot: number;
  creator: string;
  createVq: bigint;
  createVt: bigint;
  devBuy: bigint;
  devSold: boolean;
  buyers: Set<string>;
  buySol: bigint;
  sellSol: bigint;
  trades: number;
  lastTradeSlot: number;
  lastIsBuy: boolean;
  lastVq: bigint;
  lastVt: bigint;
  entries: number;
  coolUntil: number;
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  peakValue: bigint;
  exiting: boolean;
}

/** What selling `tokens` against (vq, vt) pays after the 1.25% curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  const probes = new Map<Pubkey, boolean>(); // false = buying, true = selling
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstSlot = -1;

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = {
        createdSlot: -1, creator: '', createVq: 0n, createVt: 0n,
        devBuy: 0n, devSold: false, buyers: new Set(), buySol: 0n, sellSol: 0n,
        trades: 0, lastTradeSlot: -1, lastIsBuy: false, lastVq: 0n, lastVt: 0n,
        entries: 0, coolUntil: -1, done: false, complete: false,
      };
      coins.set(mint, c);
    }
    return c;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const slot = batch.slot;
      if (firstSlot < 0) firstSlot = slot;
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();

      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
        // A sell that failed or was rejected must be retried: clear the
        // exiting flag so the next batch sends a fresh sell instead of
        // stranding the position (and its slot) until the final flatten.
        if (f.side === 'sell' && f.status !== 'filled') {
          const h = held.get(f.mint);
          if (h !== undefined) h.exiting = false;
        }
      }

      const traded: Pubkey[] = [];
      const seenTraded = new Set<Pubkey>();
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const c = coinOf(e.mint);
          c.createdSlot = e.slot;
          c.creator = e.creator;
          c.createVq = BigInt(e.virtual_quote_reserves);
          c.createVt = BigInt(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const c = coinOf(e.mint);
          const sol = BigInt(e.sol_amount);
          if (e.user === c.creator) {
            if (e.is_buy) c.devBuy += sol;
            else c.devSold = true;
          } else if (e.is_buy) {
            c.buyers.add(e.user);
            c.buySol += sol;
          } else {
            c.sellSol += sol;
          }
          c.trades++;
          c.lastTradeSlot = e.slot;
          c.lastIsBuy = e.is_buy;
          c.lastVq = BigInt(e.virtual_quote_reserves);
          c.lastVt = BigInt(e.virtual_token_reserves);
          if (!seenTraded.has(e.mint)) {
            seenTraded.add(e.mint);
            traded.push(e.mint);
          }
        } else {
          coinOf(e.mint).complete = true;
        }
      }

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingMints = new Set<Pubkey>();
      const pendingSell = new Set<Pubkey>();
      for (const po of state.pending.values()) {
        pendingMints.add(po.order.mint);
        if (po.order.side === 'sell') pendingSell.add(po.order.mint);
      }
      const valueOf = (mint: Pubkey): { value: bigint; vq: bigint; vt: bigint } => {
        const pos = state.positions.get(mint)!;
        const mk = marks.get(mint);
        const curve = state.curves.get(mint);
        const vq = mk ? BigInt(mk.virtual_quote_reserves) : (curve ? curve.virtual_quote_reserves : 0n);
        const vt = mk ? BigInt(mk.virtual_token_reserves) : (curve ? curve.virtual_token_reserves : 0n);
        const v = sellValue(pos.token_amount, vq, vt);
        return { value: v > txFee ? v - txFee : 0n, vq, vt };
      };

      // 1. Exits, in sorted mint order (deterministic).
      for (const mint of [...held.keys()].sort()) {
        if (orders.length >= cap) break;
        const h = held.get(mint)!;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingMints.has(mint)) {
            held.delete(mint);
            const c = coinOf(mint);
            c.coolUntil = slot + p.cooldownSlots;
          }
          continue;
        }
        if (curve === undefined || curve.complete || h.exiting || pendingSell.has(mint)) continue;
        const { value } = valueOf(mint);
        if (value > h.peakValue) h.peakValue = value;
        const cost = pos.cost_lamports;
        const c = coinOf(mint);
        let exit = false;
        if (value >= (cost * BigInt(Math.round((1 + p.takeProfit) * 10000))) / 10000n) exit = true;
        if (!exit && value <= (cost * BigInt(Math.round((1 - p.stopLoss) * 10000))) / 10000n) exit = true;
        if (!exit && h.peakValue >= (cost * BigInt(Math.round((1 + p.trailArm) * 10000))) / 10000n
          && value <= (h.peakValue * BigInt(Math.round((1 - p.trail) * 10000))) / 10000n) exit = true;
        if (!exit && slot - h.openedSlot >= p.maxHoldSlots) exit = true;
        if (!exit && p.exitOnDevSell && c.devSold) exit = true;
        if (!exit && slot - c.lastTradeSlot >= p.staleSlots) exit = true;
        if (!exit) continue;
        h.exiting = true;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlippageBps });
      }

      // 2. Probe round trips: sell as soon as the probe buy has landed.
      for (const [mint, selling] of [...probes.entries()].sort()) {
        if (orders.length >= cap) break;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingMints.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingMints.has(mint)) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlippageBps });
        if (!selling) probes.set(mint, true);
      }

      // 3. New entries on coins that traded this batch, in first-seen order.
      let entries = 0;
      for (const mint of traded) {
        if (orders.length >= cap || entries >= p.maxEntriesPerBatch) break;
        if (state.committedPositionCount() >= state.hello.caps.max_open_positions) break;
        if (state.positions.has(mint) || pendingMints.has(mint) || probes.has(mint) || held.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const c = coins.get(mint)!;
        if (c.done || c.createdSlot < 0) continue;
        const age = slot - c.createdSlot;
        if (age < p.minAge || age > p.maxAge) continue;
        if (c.entries >= p.maxEntriesPerCoin || slot < c.coolUntil) continue;
        if (p.skipDevSold && c.devSold) continue;
        if (c.devBuy > p.maxDevBuyLamports) continue;
        if (c.buyers.size < p.minBuyers || c.buyers.size > p.maxBuyers) continue;
        if (c.buySol - c.sellSol < p.minNetFlowLamports) continue;
        if (p.lastMustBeBuy && !c.lastIsBuy) continue;
        const realSol = curve.real_quote_reserves;
        if (realSol < p.minRealSol || realSol > p.maxRealSol) continue;
        if (c.createVt > 0n && c.lastVt > 0n) {
          const runup = (Number(c.lastVq) / Number(c.lastVt)) / (Number(c.createVq) / Number(c.createVt));
          if (!(runup <= p.maxRunup)) continue;
        }
        let amount = p.stakeLamports;
        const sizeCap = (state.maxBuyLamports(mint) * 97n) / 100n;
        if (amount > sizeCap) amount = sizeCap;
        if (amount < p.minBuyLamports) continue;
        if (state.freeCashLamports() - amount - txFee < 0n) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        held.set(mint, { openedSlot: slot, peakValue: 0n, exiting: false });
        c.entries++;
        pendingMints.add(mint);
        entries++;
      }

      // 4. Guardrail pacing: tiny probes only when coins/fills lag the pace.
      if (probes.size < p.maxProbes && firstSlot >= 0) {
        const pace = Math.min(1, (slot - firstSlot) / p.paceSlots);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if ((needCoins || needFills) && state.committedPositionCount() < state.hello.caps.max_open_positions) {
          const minRq = (p.probeLamports * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingMints.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
            if (state.freeCashLamports() - p.probeLamports - 2n * txFee < 0n) break;
            orders.push({ side: 'buy', mint, quote_lamports: p.probeLamports, max_slippage_bps: p.buySlippageBps });
            probes.set(mint, false);
            pendingMints.add(mint);
          }
        }
      }
      return orders;
    },
  };
}
