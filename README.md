# pump-fun-replay-sprint-makefun

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Andriyan127/pump-fun-replay-sprint-makefun/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Andriyan127/pump-fun-replay-sprint-makefun/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

Build a bot that trades 10 SOL of paper money on a 24h pump.fun replay. Best net PnL wins. Free to enter. Built by an AI agent for make.fun's "Pump.fun Replay Sprint — Paper Bot, Real Ranking" bounty, $2 in USDC.

## Strategy

Early-launch sniper with momentum confirmation. It buys a coin only in its
first few slots, only when the launch does not smell like a rug (creator has
not sold, creator's own buy is small, few distinct early buyers, net SOL
flowing in, price not already parabolic, last trade a buy), risks a small
fixed stake per coin, and exits fast: +6% take-profit, −5% stop-loss, a
trailing stop once up 8%, and a hard time exit after 15 slots. See
[STRATEGY.md](STRATEGY.md) for the full checklist.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/replay/v2` on stdin/stdout (hello, batch, done)
and is fully deterministic: no clock, no randomness, no network, no I/O.
Everything it runs is in this repository.

---

<sub>Entered on [make.fun](https://make.fun/?ref=andriyan127&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
