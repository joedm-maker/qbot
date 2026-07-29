# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Slack bot for tracking QBIM/Quickler/Hot Swap/Qlander/Gauntlet (Quiddler variants) scores at Design Master, plus the AutoQ solo mode. Node.js 20 ESM on AWS Lambda, API Gateway, DynamoDB, deployed with AWS SAM. Companion React dashboard lives in the sibling `qbim-stats-dashboard/` repo and consumes the `/stats/*` endpoints from this Lambda.

See `ARCHITECTURE.md` for the full component breakdown, data models, and flow diagrams — it is kept current and should be the first stop for "how does X work?" questions.

## Commands

```bash
# Build + deploy (interactive first time, uses samconfig.toml after)
sam build && sam deploy

# Deploy both bot and dashboard together (from this dir)
bash deploy-all.sh
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
- **Word parsing:** `+`, space, comma all equivalent separators. Hyphens assert explicit card boundaries (no alternatives offered). QU/TH/CL/CH/CK have distinct scores; when multiple readings exist, both the Slack score-entry modal and the web `/scores` endpoint return `choice_required` and prompt the player to pick. The web client renders the picker via `ChoicePicker` in the dashboard's `LiveGamePlay.jsx`. Same-score digraphs (IN/ER) are pre-collapsed by `getScoreOptions`, so only truly ambiguous breakdowns trigger the picker.
- **Dealing vs. scoring cap are two different numbers.** `dealSizeForHand(gameType, hand, mulligans)` = `hand + 3 - mulligans` is the **deal** size — how many cards a *Digital* game deals. But the **max scorable cards in a word is the hand number itself** (`Math.max(2, hand - mulligans)`), the standard Quiddler rule: the extra 3 dealt cards are non-scorable "discards." The scoring cap lives at the `maxCards` call sites in `score-entry.mjs` (submit + admin edit), `web-game.mjs`, and `autoq.mjs` — all use `hand - mulligans`, **not** `dealSizeForHand`. (Historical note: the QBIM/Quickler paths mistakenly used `dealSizeForHand` as the cap, so over-length words slipped through in physical games until this was corrected.)
- **Digital deck pool tracking is per-hand.** `game.dealt_cards[user#hand]` holds what they currently hold; `game.hand_seen_cards[user#hand]` accumulates the full hand the player has been shown (initial deal + every mulligan discard). Mulligan re-deals draw from `getDeckSize(game.deck_variant) - hand_seen_cards`, so the pool can deplete within a hand. New hands reshuffle the full deck. Deck size is variant-dependent: **118 for Quiddler, 126 for Power** — see `POWER_DECK.md`.
- **Superlatives are tabled.** `postSuperlatives()` exists in `score-entry.mjs` but is commented out of `finalizeGame()` — waiting for a larger pool before re-enabling. Don't "fix" the commented call without checking.

## Related repo

Dashboard consumes this Lambda's `/stats/*` endpoints. When changing the stats API shape (`stats-api.mjs`), check `qbim-stats-dashboard/server.mjs` (local Express mirror) and the dashboard components for field-name assumptions — especially `player_slack_id` vs the `player_id` alias the dashboard expects.
