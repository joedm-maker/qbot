# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Slack bot for tracking QBIM/Quickler (Quiddler variant) scores at Design Master. Node.js 20 ESM on AWS Lambda, API Gateway, DynamoDB, deployed with AWS SAM. Companion React dashboard lives in the sibling `qbim-stats-dashboard/` repo and consumes the `/stats/*` endpoints from this Lambda.

See `ARCHITECTURE.md` for the full component breakdown, data models, and flow diagrams — it is kept current and should be the first stop for "how does X work?" questions.

## Commands

```bash
# Build + deploy (interactive first time, uses samconfig.toml after)
sam build && sam deploy

# Deploy both bot and dashboard together (from this dir)
bash deploy-all.sh

# Integration tests — require env vars preloaded
node --import ./test-env.mjs test-harness.mjs --auto        # Full 2-player auto game
node --import ./test-env.mjs test-harness.mjs               # Interactive menu
node --import ./test-env.mjs test-replay.mjs                # Replays real 7-player game
```

**Windows/SAM path:** `/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd` (deploy-all.sh uses this explicitly).

**AWS profile:** The QBIMBOT account is `420536191993`. Use `AWS_PROFILE=qbim` for any CLI calls — the default profile is TavernBIM and will hit the wrong account.

**MSYS path conversion:** Prefix AWS CLI calls with `MSYS_NO_PATHCONV=1` when an arg begins with `/` (e.g. CloudWatch log group paths) — git-bash otherwise mangles them into Windows paths.

## Architecture in Brief

Single Lambda, internal router (`src/handlers/router.mjs`) dispatches by:
1. `GET /stats/*` → `stats-api.mjs` (no auth — public read-only)
2. `GET /auth/*` → `auth.mjs` (Slack OpenID Connect sign-in for the web app)
3. `/games/*`, `POST /scores`, `POST /votes/start` → `web-game.mjs` (Bearer JWT auth; mirrors Slack home-tab flows for `/play`)
4. Slack signature verified via `verify.mjs` (headers must be lowercased — API Gateway preserves original casing)
5. `event_callback` → `game-flow.mjs`
6. `block_actions` → routed by `action_id` to game-flow / score-entry / leaderboard
7. `view_submission` → routed by `callback_id`
8. `qbim_admin_*` → `score-entry.mjs`

All state is in DynamoDB (`qbim-games`, `qbim-scores`, `qbim-players`). The Slack Home tab is re-rendered from DB on every interaction — there is no in-memory state between invocations.

Web-app session tokens are HS256 JWTs signed by `jwt.mjs` with `SESSION_SECRET`. The token rides in `Authorization: Bearer` on every `/games/*` and `/scores` call; `verifyJwt` returns the player's Slack ID via `claims.sub`.

## Gotchas (not derivable from reading code)

- **Test env must be preloaded via `--import`.** DynamoDB table names are captured at module import time, so `test-env.mjs` has to run before any handler is imported. Running `node test-harness.mjs` without `--import ./test-env.mjs` will hit undefined tables.
- **Circular imports via `await import()`.** `home.mjs` dynamically imports `score-entry.mjs` for the 10-minute auto-finalize. `game-flow.mjs` dynamically imports `score-entry.mjs` for `autoAwardStars` on player drop. Don't convert these to static imports.
- **`ScanIndexForward: false`** on the `date-index` GSI returns games in *descending* `game_number` order. Take `[0]` for latest, not `[length-1]`.
- **`samconfig.toml` contains secrets** (Slack bot token, signing secret) and is gitignored. Don't commit it.
- **Messages go to DMs only.** `CHANNEL()` still exists for reference but nothing posts to `#qbim` anymore — use `dmUser` / `dmAllPlayers`.

## Domain rules (encoded in code but easy to break)

- **Complete game = all 8 hands (H3–H10) played.** Enforced in `updatePlayerStats`, `stats-api.getPlayers`, and the dashboard's `filterData.js`. `incomplete_games` exists specifically so this is visible. Never conflate with `games_played`.
- **Stars require 3+ players.** Any tie on longest word or most words = no star awarded.
- **Dealer = highest raw on the last completed hand**, tiebreak by least-recent in `game.dealers`. Not cumulative.
- **Edit locking is server-side.** Players can't edit a hand after all eligible players submitted (`saveScore` returns a validation error). Admin can only edit *completed* hands (`adminPickEdit` returns a validation error mid-hand).
- **`autoAwardStars(game, hand, handScores, announce)` — `announce` matters.** `true` on first completion (DMs + state transition), `false` on admin edits (recompute stars only, no DMs).
- **Word parsing:** `+`, space, comma all equivalent separators. Hyphens assert explicit card boundaries (no alternatives offered). QU/TH/CL have distinct scores; the Slack score-entry modal prompts via radio when both readings are possible, while the web `/scores` endpoint auto-picks the highest-scoring breakdown (digraphs are never worth more than individual letters, so this is always score-optimal).
- **All games deal hand+3 cards.** `dealSizeForHand(gameType, hand, mulligans)` in `cards.mjs` is the source of truth — every game type deals `hand + 3 - mulligans` (standard Quiddler rule). Max usable cards in words equals the deal size; the extra 3 are the natural "discards" players don't have to score with.
- **Digital deck pool tracking is per-hand.** `game.dealt_cards[user#hand]` holds what they currently hold; `game.hand_seen_cards[user#hand]` accumulates the full hand the player has been shown (initial deal + every mulligan discard). Mulligan re-deals draw from `118 - hand_seen_cards`, so the pool can deplete within a hand. New hands reshuffle the full 118.
- **Superlatives are tabled.** `postSuperlatives()` exists in `score-entry.mjs` but is commented out of `finalizeGame()` — waiting for a larger pool before re-enabling. Don't "fix" the commented call without checking.

## Related repo

Dashboard consumes this Lambda's `/stats/*` endpoints. When changing the stats API shape (`stats-api.mjs`), check `qbim-stats-dashboard/server.mjs` (local Express mirror) and the dashboard components for field-name assumptions — especially `player_slack_id` vs the `player_id` alias the dashboard expects.
