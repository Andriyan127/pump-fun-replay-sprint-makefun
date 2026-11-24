// Pump.fun Replay Sprint — Paper Bot, Real Ranking.
// Early-launch sniper with momentum confirmation; see strategy.ts.
// The grader runs `node /bot/main.ts` (Node 22 strips the types; no build,
// no install). The SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored
// byte for byte in vendor/.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
