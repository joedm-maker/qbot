## v0.2.2 — 2026-05-18

### Added
- **`GET /stats/autoq-scores`** — returns AutoQ hand scores from the `qbim-autoq` table, normalized to the same shape as `/stats/scores` so the dashboard can fold them into its word-stats pool. AutoQ words are dictionary-validated server-side, so they're safe to mix in.
- **`archive-partial-games.mjs`** — one-shot cleanup script. Flips `qbim-games` rows to `status=ARCHIVED` when status was `COMPLETE` but at least one rostered player is missing an H3-H10 score. Reversible (`prev_status` + `archived_at` preserved). Already-`COMPLETE` filters drop archived rows automatically.
- **`delete-test-games.mjs`** — hard-deletes the 4 single-player abandoned test rows that were archived first.

### Changed
- **`/stats/games` filters to fully-complete games** and tags each with `complete_number` (1..N by creation order among fully-complete games). "Fully complete" = every player on the roster has a score for every hand H3-H10. `game_number` stays on the record as the storage-order id; `complete_number` is for display sequencing only. Partial games never surface in the dashboard, so the visible sequence has no gaps.

### Data ops
- 12 partial games flipped to `ARCHIVED` (`archive-partial-games.mjs --apply`).
- 4 single-player test games hard-deleted along with 3 associated score rows (`delete-test-games.mjs --apply`).

---

## v0.2.1 — 2026-05-18

### Changed
- **`POST /games/finish`** allows any player in the game to finalize once `review_started_at` is set — matches the Slack home-tab Finalize button (no host restriction during review). Mid-game early termination still requires the host. Paired with the dashboard's v0.3.2 Finalize button.

---

## v0.2.0 — 2026-05-18

### Added
- **Slack OpenID Connect sign-in** for the companion web app. `/auth/slack/login`, `/auth/slack/callback`, `/auth/me`. JWT session tokens stored client-side. `return_to` is JWT-signed into the OAuth `state` so localhost dev rounds-trip correctly.
- **Web play endpoints** (`/games/me`, `/games/create`, `/games/join`, `/games/mulligan`, `/games/drop`, `/games/finish`, `/scores`, `/votes/start`) — full feature parity with the Slack home-tab flow so players can join, mulligan, submit, vote, and finish games from the dashboard's `/play` surface.
- **Digital deck** option for live games. Cards are dealt by the bot and persisted per-player per-hand. New hands reshuffle the full 118-card deck. Pool tracking via `dealt_cards` + `hand_seen_cards`.

### Changed
- **All game types now deal `hand + 3` cards** (standard Quiddler rule). Previously QBIM/AutoQ deal counts were capped at `hand`, which was wrong; `dealSizeForHand(gameType, hand, mulligans)` is the single source of truth.
- **Session JWTs never expire** (internal tool — sign-in friction matters more than rotation). Revoke by rotating `SESSION_SECRET`.
- Score-entry modal unified — single Words field, Test + always-visible Vote.
- Web score submits parallelize Slack home re-render fanout to drop latency.
- Quickler skips per-hand DMs (in-person play).

### Fixed
- Digraph ambiguity: web `/scores` endpoint auto-picks the highest-scoring breakdown.
- Mulligan when deck can't fund the redeal: rejected without counting against the player.
- 2-card minimum per word enforced; Mulligan gated on the 2-card floor.
- Proper nouns, biographical + geographical names, trademarks rejected by the dictionary.

### Notes
- Companion repo: [`qbim-stats-dashboard`](../qbim-stats-dashboard) ships in lockstep — see its `CHANGELOG.md` for the front-end side of v0.2.0.

---

## v0.1.0 — pre-2026-05-18

Baseline before changelogs were tracked. Slack bot for QBIM/Quickler scoring, DynamoDB-backed Lambda, public read-only `/stats/*` API consumed by the dashboard.
