# QBIM Bot — Architecture Document

## 1. Project Overview

QBIM Bot is a Slack bot for tracking lunchtime Quiddler card game scores at Design Master Software. Players interact entirely through the Slack Home tab — starting games, entering words, viewing scoreboards, and managing game state. The bot auto-calculates scores from card values, awards stars for longest word and most words, enforces round-by-round play, and tracks lifetime player statistics.

**Target platform:** Slack (Home tab + DMs), with a separate React stats dashboard
**Tech stack:** Node.js 20 ESM on AWS Lambda, API Gateway, DynamoDB, deployed via AWS SAM CLI

## 2. Tech Stack & Dependencies

### Runtime
- **Node.js 20.x** (ESM modules — all files use `.mjs` extension)
- **AWS Lambda** (single function, 10s timeout, 256MB)
- **AWS API Gateway** (REST API, stage: `prod`)
- **AWS DynamoDB** (3 tables, PAY_PER_REQUEST billing)

### Dependencies (package.json)
- `@aws-sdk/client-dynamodb` ^3.700.0 — DynamoDB client
- `@aws-sdk/lib-dynamodb` ^3.700.0 — DynamoDB Document client (higher-level API)
- `@slack/web-api` ^7.8.0 — Slack API client

### Dev Dependencies
- `@aws-sdk/client-secrets-manager` ^3.700.0 (unused, from initial setup)

### Infrastructure
- **AWS SAM CLI** v1.157.1 — build and deploy
- **SAM CLI path (Windows):** `/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd`
- **samconfig.toml** — deployment config (gitignored, contains secrets)

### Third-party Services
- **Slack API** — Bot interactions (Home tab, modals, DMs)
- **AWS DynamoDB** — Game state, scores, player records
- **AWS API Gateway** — Slack webhook endpoints + stats API

## 3. Directory & File Structure

```
qbim-bot/
├── .aws-sam/                    # SAM build artifacts (gitignored)
├── .gitignore
├── events/                      # Sample event payloads (unused)
├── node_modules/
├── package.json
├── package-lock.json
├── samconfig.toml               # SAM deploy config with secrets (gitignored)
├── template.yaml                # SAM/CloudFormation template — Lambda, API Gateway, DynamoDB tables
├── import-history.mjs           # Imports player stats from \\BIRD\Shared\QBIM\qbim_data.json
├── import-all-history.mjs       # Imports full game+score history from same JSON
├── test-env.mjs                 # Preloads env vars (table names, secrets) for test scripts
├── test-harness.mjs             # Auto/interactive test runner with mock Slack client
├── test-replay.mjs              # Replays real game from 2026-03-31 with all 7 players
└── src/
    ├── handlers/
    │   ├── router.mjs           # Lambda entry point — routes by httpMethod, action_id, callback_id
    │   ├── game-flow.mjs        # Start/join/end game, mulligan, score toggle, app_home_opened
    │   ├── score-entry.mjs      # Score submission, auto stars, admin edits, game finalization
    │   ├── leaderboard.mjs      # Game history queries (capped at 7 days, 10 games)
    │   ├── stats-api.mjs        # Read-only GET endpoints for dashboard (/stats/players,games,scores,live)
    │   ├── auth.mjs             # Slack OpenID Connect sign-in for the web app (/auth/slack/login, /callback, /me)
    │   ├── web-game.mjs         # Web-app game endpoints (/games/me|create|join|mulligan|drop|finish, /scores, /votes/start) — Bearer JWT auth
    │   ├── score-worker.mjs     # Async Lambda for save + Slack fanout (fire-and-forget from Slack and web)
    │   └── quickler-timer.mjs   # EventBridge-scheduled handler that auto-zeros missing Quickler submitters at 30s
    └── lib/
        ├── blocks.mjs           # All Slack Block Kit views — home states, modals, scoreboard, player card
        ├── cards.mjs            # Card deck, point values, word parsing, breakdowns, getHandRange, dealSizeForHand
        ├── db.mjs               # DynamoDB CRUD — games, scores, players, mulligans, preferences, dealers, recordDeal
        ├── home.mjs             # Shared renderHome (player + admin views), resolveNames, findCurrentRound, etc.
        ├── slack.mjs            # Slack WebClient wrapper, mock support, dmUser, dmAllPlayers
        ├── verify.mjs           # Slack request signature verification (normalizes header casing)
        ├── jwt.mjs              # HS256 JWT sign/verify for web-app session tokens (no external deps)
        ├── vote.mjs             # Dictionary-rejection vote system — startWordVote, timer, resolveVote
        ├── quickler.mjs         # EventBridge Scheduler helpers for the 30s Quickler timer
        ├── autoq-deck.mjs       # 118-card Quiddler deck, shuffleDeck, dealFromPool, filterOptionsAgainstDealt
        ├── autoq-bots.mjs       # AutoQ bot play selection from historical scores
        ├── autoq-db.mjs         # AutoQ-specific persistence
        └── dictionary.mjs       # Merriam-Webster validation + house-rule overrides
```

## 4. Architecture Patterns

### Overall Style
Single Lambda function with an internal router pattern. The router (`router.mjs`) dispatches to handler modules based on payload type (Slack events, block actions, view submissions, GET requests).

### Request Flow
```
Slack/Browser → API Gateway → Lambda (router.mjs) → handler → db.mjs/slack.mjs → DynamoDB/Slack API
```

### State Management
All state is in DynamoDB. No in-memory state between Lambda invocations. The Slack Home tab is re-rendered from DB on every interaction.

### Auth Strategy
- **Slack requests:** Signature verification via HMAC-SHA256 (`verify.mjs`). Headers normalized to lowercase for API Gateway compatibility.
- **Stats API (GET):** No auth — public read-only endpoints. Bypasses Slack signature check.
- **Web-app endpoints (`/games/*`, `/scores`, `/votes/start`):** HS256 JWT in `Authorization: Bearer`. Tokens are issued by `/auth/slack/callback` after a successful Slack OpenID Connect exchange and signed with `SESSION_SECRET` (`jwt.mjs`).
- **OAuth state is JWT-signed too** — the post-login redirect target is encoded into the OAuth `state` parameter so a localhost dev origin can roundtrip back to itself; allowed origins are `DASHBOARD_URL` and any `localhost`/`127.0.0.1` host.
- **Admin actions:** Server-side check `payload.user.id === ADMIN_USER` on all admin handlers.

### Routing
`router.mjs` checks in order:
1. `GET /stats/*` → `stats-api.mjs` (no signature check)
2. `GET /auth/*` → `auth.mjs` (Slack OIDC sign-in flow, browser-driven)
3. `/games/*`, `POST /scores`, `POST /votes/start` → `web-game.mjs` (Bearer JWT auth)
4. `url_verification` → challenge response
5. Slack signature verification
6. `event_callback` → `game-flow.mjs`
7. `block_actions` → routed by `action_id` to game-flow, score-entry, or leaderboard
8. `view_submission` → routed by `callback_id`
9. `qbim_admin_*` actions → `score-entry.mjs`

### Digital deck
All three game types (QBIM, Quickler, AutoQ) deal `hand + 3` cards per round (6 for Hand 3, 7 for Hand 4, etc.) — standard Quiddler rule. The extra 3 are the "discards" players don't have to score with. The single source of truth is `cards.dealSizeForHand(gameType, hand, mulligans)`.

Games opt into in-app dealing via `game.deck_type = "Digital"` (default: `"Physical"`, scores only). Digital games persist:
- `game.dealt_cards[playerId#hand]` — what the player currently holds
- `game.hand_seen_cards[playerId#hand]` — accumulates the full set of cards shown that hand (initial + every mulligan discard); mulligan re-deals draw from `118 - hand_seen_cards`, so the pool depletes within a hand
- New hands re-shuffle the full 118-card deck — `hand_seen_cards` is per-hand, not per-game
- `db.recordDeal()` updates both maps atomically

## 5. Data Models & Schema

### qbim-games
| Field | Type | Description |
|-------|------|-------------|
| `game_id` | String (PK) | UUID or `hist-NNN` for imports |
| `game_date` | String (GSI PK) | ISO date `YYYY-MM-DD` |
| `game_number` | Number (GSI SK) | Sequential per day |
| `game_type` | String | "QBIM" or "Quickler" |
| `status` | String | "OPEN" → "ACTIVE" → "COMPLETE" |
| `players` | List<String> | Current player Slack IDs (drops removed) |
| `player_start_hands` | Map<String, Number> | Player ID → hand they joined at (3 for originals) |
| `mulligans` | Map<String, Number> | "playerId#hand" → count |
| `dealers` | List<String> | History of dealer assignments per round |
| `host_slack_id` | String | Who started the game |
| `winner` | String | Player ID of winner (set on import or finalize) |
| `review_started_at` | String | ISO timestamp when Hand 10 completed |
| `completed_at` | String | ISO timestamp when game finalized |
| `created_at` | String | ISO timestamp |

**GSI: date-index** — PK: `game_date`, SK: `game_number`

### qbim-scores
| Field | Type | Description |
|-------|------|-------------|
| `game_id` | String (PK) | References qbim-games |
| `player_hand_key` | String (SK) | Format: `{playerId}#{hand}` |
| `player_slack_id` | String | Player's Slack ID |
| `hand` | Number | 3–10 |
| `raw_score` | Number | Points from cards |
| `words` | String | Raw input ("fox+quiz" or "qu-i-z") |
| `word_count` | Number | Number of words played |
| `longest_word_letters` | Number | Letter count of longest word |
| `mulligans` | Number | Mulligans taken for this hand |
| `breakdown` | String | Card breakdown ("F-O-X QU-I-Z") |
| `stars` | Number | 0, 1, or 2 |
| `star_longest_word` | Boolean | Won longest word star |
| `star_most_words` | Boolean | Won most words star |
| `submitted_at` | String | ISO timestamp |

### qbim-players
| Field | Type | Description |
|-------|------|-------------|
| `slack_id` | String (PK) | Slack user ID |
| `display_name` | String | Cached from Slack API |
| `games_played` | Number | Complete games only (all 8 hands) |
| `incomplete_games` | Number | Games where player didn't play all hands |
| `all_time_wins` | Number | Total wins |
| `all_time_stars` | Number | Total stars earned |
| `all_time_mulligans` | Number | Total mulligans taken |
| `win_pct` | Number | Win percentage (historical import) |
| `avg_game_total` | Number | Average game score (historical) |
| `highest_game_total` | Number | Best game (historical) |
| `lowest_game_total` | Number | Worst game (historical) |
| `highest_hand_score` | Number | Best single hand (historical) |
| `avg_hand_score` | Number | Average hand (historical) |
| `hands_won` | Number | Hands won (historical) |
| `total_hands_played` | Number | Total hands (historical) |
| `stars_per_game` | Number | Stars/game ratio (historical) |
| `times_hand_screwed` | Number | Had highest raw, lost to stars (historical) |
| `times_screwed_others` | Number | Won via stars over higher raw (historical) |
| `best_hand` | Map | `{hand, wins, avg}` (historical) |
| `preferences` | Map | `{show_own_score: Boolean}` |

## 6. Component / Module Breakdown

### Handlers

**router.mjs** — Lambda entry point. Parses Slack payloads, routes GET stats requests without auth, verifies Slack signatures, dispatches to handlers by action_id/callback_id.

**game-flow.mjs** — Handles: `app_home_opened`, `qbim_start_game`, `qbim_join_game`, `qbim_end_game`, `qbim_mulligan`, `qbim_toggle_score`, `qbim_start_game_submit`, `qbim_end_game_confirm`. Creates games, manages joins (including mid-game with `player_start_hands`), handles drops with round-completion checks, posts lobby DMs.

**score-entry.mjs** — Handles: `qbim_open_hand_modal`, `qbim_finalize_game`, `qbim_submit_score`, `qbim_confirm_score`, `qbim_admin_*`. Core scoring logic: `saveScore()` validates cards, checks mulligans, writes to DB, and blocks player edits on completed hands (all eligible players submitted) — returns validation error: "Whoops, sorry that hand is complete. Please wait while we refresh." `autoAwardStars(game, hand, handScores, announce)` computes longest word/most words, awards stars, announces dealer with card count (`(${3 + hand + 1} cards each)`), DMs round summary; `announce=true` on first completion (DMs + game state transitions), `announce=false` on edits (recalculate stars only, no DMs). `adminPickEdit()` restricts admin edits to completed hands only — returns validation error if hand is still in progress. `adminSaveEdit()` overwrites the score record and recalculates stars for the edited hand via `autoAwardStars(…, false)`. `postSuperlatives()` builds a pool of game superlatives (Best Hand, Star Player, Biggest Villain, Most Improved, Strong Finish >62, Strong Start >20), picks up to 4 rotating by game_number — currently commented out in `finalizeGame()`, tabled until the pool is larger. `finalizeGame()` completes game, posts standings, updates player stats. Exports: `autoAwardStars`, `finalizeGame`.

**stats-api.mjs** — GET endpoints: `/stats/players` (enriched with computed stats), `/stats/games` (COMPLETE only, with winners), `/stats/scores` (normalized player_id), `/stats/live` (active game with scores and player names). Full table scans with pagination. CORS enabled.

**leaderboard.mjs** — Game history display (7-day window, 10-game cap). Uses shared helpers from home.mjs.

### Libraries

**home.mjs** — `renderHome(userId)` — the core home tab renderer. Detects admin user, checks for active/complete games, applies 30-minute visibility window for completed games, 10-minute auto-finalize for review mode. Also: `renderAdminHome()` with compact score table and edit/recalc/republish buttons. Exports: `renderHome`, `resolveNames`, `findCurrentRound`, `aggregateScores`, `filterCompletedHands`, `ADMIN_USER`.

**blocks.mjs** — All Slack Block Kit JSON builders: `homeNoGame`, `homeLobby` (with empty score table), `homeActive` (scoreboard, mulligan, score toggle, end game), `homeReview` (finalize button), `homeComplete`, `startGameModal`, `handScoreModal`, `scoreChoiceModal`, `endGameModal`, `adminPickerModal`, `adminEditModal`, `awardStarsModal`, `playerCard`, `lobbyMessage`, `buildScoreboard` (respects show_own_score preference).

**cards.mjs** — Card deck definition (A-Z + QU/IN/ER/TH/CL digraphs with point values). `getScoreOptions(input, maxCards)` — enumerates all possible card breakdowns, handles `+`/space/comma separators, hyphen-asserted boundaries, digraph ambiguity. Groups by score, resolves IN/ER by hand fit. Returns options array for single-select or radio choice.

**db.mjs** — DynamoDB operations: `getGame`, `getGamesByDate`, `getRecentGames`, `getMaxGameNumber`, `createGame`, `updateGameStatus`, `addPlayerToGame`, `setPlayerStartHand`, `removePlayerFromGame`, `addDealer`, `addMulligan`, `setMulliganCount`, `getMulliganCount`, `initMulligansMap`, `putScore`, `getAllScores` (full table scan with pagination — used by `postSuperlatives()` for historical averages), `getScoresForGame`, `getScoresForGameHand`, `updateScoreStars`, `getPlayer`, `upsertPlayer`, `setPlayerPreference`, `initPreferences`, `incrementPlayerStats`, `getRegularPlayers`, `updateGameAttr`, `deleteAllScoresForGame`, `deleteGame`.

**slack.mjs** — `slack()` returns cached WebClient. `setMockClient(mock)` for testing. `dmUser(userId, {text, blocks})` opens conversation + posts. `dmAllPlayers(playerIds, {text, blocks})` DMs everyone. `CHANNEL()` returns channel ID (unused now — all messages via DM).

**verify.mjs** — `verifySlackSignature(secret, headers, body)` — HMAC-SHA256 with timestamp replay protection. Normalizes header keys to lowercase (API Gateway passes original casing). `parseSlackBody(body, isBase64)` — handles both JSON and URL-encoded payloads.

## 7. Key Flows

### Flow 1: Start Game
1. User opens Home tab → `app_home_opened` → `game-flow.mjs:handleEvent` → `renderHome()` → shows "Start Game" button
2. User clicks "Start Game" → `qbim_start_game` → `openStartGameModal()` → Slack modal with game type selector
3. User submits modal → `qbim_start_game_submit` → `createNewGame()` writes to qbim-games with `player_start_hands`, `mulligans: {}`, `dealers: []` → `postLobbyMessage()` DMs host → `renderHome()` shows lobby with empty score table

### Flow 2: Score Submission
1. User clicks "Enter Hand N Score" → `qbim_open_hand_modal` → `handScoreModal()` with words input
2. User submits → `qbim_submit_score` → `submitScore()` → `getScoreOptions()` parses words, checks mulligans
3. If multiple breakdowns: returns `scoreChoiceModal()` → user picks → `qbim_confirm_score` → `confirmScore()`
4. `saveScore()` checks if this is an edit — if so, verifies the hand is not yet complete (all eligible players submitted). If the hand is complete, returns a validation error and blocks the edit. Otherwise writes to qbim-scores → checks OPEN→ACTIVE transition → checks round completion
5. If round complete: `autoAwardStars()` → determines longest word/most words → updates star fields → computes next dealer → DMs round summary (with card count) to all → refreshes all home tabs

### Flow 3: Auto Star Award + Dealer
1. `autoAwardStars(game, hand, handScores, announce)` in score-entry.mjs
2. Skips stars if ≤2 players. Finds longest word by letter count, most words by word count
3. Only awards if single clear winner (any tie = no star)
4. Dealer: highest raw score on THIS hand (not cumulative), tiebreak by least recent in `dealers` array
5. DMs all players: per-player words + scores + star summary + dealer announcement
6. After Hand 10: sets `review_started_at` on game (enters review mode)

### Flow 4: Admin Edit
1. Office account opens Home tab → `renderAdminHome()` shows compact admin panel
2. Admin clicks "Edit Score" → `qbim_admin_edit_picker` → `adminPickerModal()` with player + hand dropdowns
3. Admin selects and submits → `qbim_admin_pick_edit` → validates hand is complete (not in-progress) — returns validation error if players are still submitting. Looks up current words → returns `adminEditModal()` pre-filled
4. Admin saves → `qbim_admin_save_edit` → recalculates score from words → overwrites score record → explicitly recalculates stars for that hand via `autoAwardStars(…, false)` → refreshes admin home

### Flow 5: Game Finalization
1. After Hand 10, review mode: Home tab shows full scoreboard + "Finalize Game" button
2. Any player clicks Finalize → `qbim_finalize_game` → `finalizeGame()` → sets status COMPLETE → `postFinalLeaderboard()` DMs all players → `updatePlayerStats()` increments games_played/wins/stars/mulligans/incomplete_games
3. Or: 10-minute timeout — next Home tab visit auto-finalizes via dynamic import in `home.mjs`
4. Completed game visible on Home tab for 30 minutes, then reverts to "No game today"

## 8. Configuration & Environment

### Environment Variables (set in template.yaml)
| Variable | Description |
|----------|-------------|
| `GAMES_TABLE` | DynamoDB table name for games (from CloudFormation ref) |
| `SCORES_TABLE` | DynamoDB table name for scores |
| `PLAYERS_TABLE` | DynamoDB table name for players |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Slack app Signing Secret |
| `SLACK_CHANNEL_ID` | Channel ID for #qbim (unused now, kept for reference) |
| `SLACK_ADMIN_USER_ID` | Admin Slack user ID (default: U09MS4ZGBHN) |

### Config Files
| File | Purpose |
|------|---------|
| `template.yaml` | SAM/CloudFormation — Lambda, API Gateway, DynamoDB tables, parameters |
| `samconfig.toml` | SAM deploy settings — stack name, region, S3 bucket, parameter overrides (gitignored) |
| `.gitignore` | Ignores node_modules, .aws-sam, samconfig.toml, .env |
| `test-env.mjs` | Preloads env vars for local test scripts |

### SAM Template Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `SlackBotToken` | String (NoEcho) | Bot OAuth token |
| `SlackSigningSecret` | String (NoEcho) | Signing secret |
| `SlackChannelId` | String | Channel ID |
| `SlackAdminUserId` | String (Default: U09MS4ZGBHN) | Admin user |

### API Gateway Routes
| Method | Path | Handler |
|--------|------|---------|
| POST | /slack/events | router → game-flow |
| POST | /slack/interactivity | router → score-entry |
| GET | /stats/players | router → stats-api |
| GET | /stats/games | router → stats-api |
| GET | /stats/scores | router → stats-api |
| GET | /stats/live | router → stats-api |

## 9. Testing Strategy

### Test Files
- **test-harness.mjs** — Full auto-test (2-player game, all hands) or interactive menu. Uses mock Slack client (`setMockClient`). Runs against real DynamoDB tables. `node --import ./test-env.mjs test-harness.mjs --auto`
- **test-replay.mjs** — Replays a real 7-player game from 2026-03-31 with exact words. Tests + separator, star logic, player drops.
- **test-env.mjs** — Sets env vars before module loading (required because DynamoDB table names are captured at import time).

### Mock Approach
Both test files replace the Slack client with a mock that:
- `conversations.open()` → returns fake DM channel ID
- `chat.postMessage()` → logs to console with `[DM→name]` prefix
- `views.publish()` → logs home tab blocks
- `views.open()` → logs modal opens
- `users.info()` → returns hardcoded display names

### Test Data
Tests use mock player IDs (`U_ALICE`, `U_BOB`) and write to the real DynamoDB tables. Cleanup functions scan and delete test data before each run.

### No Unit Tests
There are no isolated unit tests. Testing is done through integration tests that exercise the full handler chain with mock Slack and real DynamoDB.

## 10. Known Patterns, Conventions & Gotchas

### Code Style
- All files are ESM (`.mjs`). `import`/`export` throughout.
- `respond(statusCode, body)` helper in each handler for consistent HTTP responses.
- Slack Block Kit views are built with primitive helpers: `section()`, `divider()`, `actions()`, `button()`, `text()`, `option()`.

### Gotchas
- **Git bash on Windows:** `MSYS_NO_PATHCONV=1` required for AWS CLI paths starting with `/` (e.g., `/aws/lambda/...`).
- **API Gateway header casing:** Headers arrive with original casing (`X-Slack-Signature`), not lowercase. `verify.mjs` normalizes them.
- **Express 5 path-to-regexp:** The `*` wildcard doesn't work. Use middleware fallback instead of `app.get("*", ...)`.
- **`samconfig.toml`** contains Slack secrets — always gitignored.
- **DynamoDB table names captured at import time:** `test-env.mjs` must be loaded via `--import` flag before any handler modules.
- **Circular dependencies:** `home.mjs` dynamically imports `score-entry.mjs` for `finalizeGame()` (10-minute timeout). `game-flow.mjs` dynamically imports `score-entry.mjs` for `autoAwardStars()` (player drop). Both use `await import()`.
- **`ScanIndexForward: false`** on the date-index GSI returns games in descending `game_number` order. Take `[0]` for latest, not `[length-1]`.

### Incomplete Game Rule (Critical)
A game counts as "complete" for a player ONLY if they played all 8 hands (H3-H10). Enforced in `updatePlayerStats`, stats-api `getPlayers`, dashboard `filterData.js`, and Score Trend chart. The `incomplete_games` field exists specifically for data transparency.

### Edit Locking
- Players cannot edit scores after a hand is complete (all eligible players submitted). Server-side check in `saveScore()`.
- Admin can only edit completed hands (not in-progress). Server-side check in `adminPickEdit()`.
- Both return Slack modal validation errors to the user.

### Star Rules
- 3+ players required
- No stars on ANY tie (longest or most words)
- Longest word = letter count, not card count
- Dealer = highest raw on last completed hand (not cumulative)

### Word Parsing
- Separators: `+`, space, comma (all equivalent)
- Hyphens assert explicit card boundaries (no alternatives offered)
- Empty submission = 0 points (valid — player couldn't form a word)
- Cards: A-Z single letters + QU, IN, ER, TH, CL digraphs
- IN/ER have same score as individual cards → auto-resolved by hand fit
- QU/TH/CL have different scores → player picks via radio buttons

### Messaging
- All messages go to bot DMs via `dmUser`/`dmAllPlayers`, NOT to #qbim channel
- Message types: game started (DM host), round complete (DM all), final standings (DM all), game ended early (DM all)

### Admin
- Office account (U09MS4ZGBHN) gets special Home tab with admin panel
- Auth guards on all admin handlers check `payload.user.id === ADMIN_USER`
- Admin can edit any player's score, recalculate all stars, republish standings
- Finds current or most recent game (today → yesterday fallback)

### Player Slack IDs
| Name | Slack ID |
|------|----------|
| Joe | U03KBK8EA1W |
| Beau | U05UEDYBPPF |
| Jason | U03F65324NS |
| Kane | U03FRD18WJV |
| David | U03F9E9EEA1 |
| Scott | U093FPM6DFD |
| Sean | U0A2G784MGA |
| Office (admin) | U09MS4ZGBHN |
