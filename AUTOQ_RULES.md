# QBIM / Quiddler Rules — Implementation Spec

Machine-readable rules for the QBIM/Quiddler card game, covering the solo AutoQ variant. Sourced from the live `qbim-bot` and `qbim-stats-dashboard` code. Everything here is authoritative.

---

## 1. Deck

**118 cards total.** 26 single-letter cards (A–Z) plus 5 digraph cards.

Card frequencies (copies of each card in the deck):

```json
{
  "A": 10, "B": 2,  "C": 2,  "D": 4,  "E": 12, "F": 2,  "G": 4,  "H": 2,
  "I": 8,  "J": 2,  "K": 2,  "L": 4,  "M": 2,  "N": 6,  "O": 8,  "P": 2,
  "Q": 2,  "R": 6,  "S": 4,  "T": 6,  "U": 6,  "V": 2,  "W": 2,  "X": 2,
  "Y": 4,  "Z": 2,
  "QU": 2, "IN": 2, "ER": 2, "CL": 2, "TH": 2
}
```

Card point values:

```json
{
  "A": 2,  "B": 8,  "C": 8,  "D": 5,  "E": 2,  "F": 6,  "G": 6,  "H": 7,
  "I": 2,  "J": 13, "K": 8,  "L": 3,  "M": 5,  "N": 5,  "O": 2,  "P": 6,
  "Q": 15, "R": 5,  "S": 3,  "T": 3,  "U": 4,  "V": 11, "W": 10, "X": 12,
  "Y": 4,  "Z": 14,
  "ER": 7, "CL": 10, "IN": 7, "TH": 9, "QU": 9
}
```

---

## 2. Hand Structure

- A game consists of **8 hands**, numbered **3 through 10**.
- Hand N deals **N cards** to each player.
- A "complete game" for a player requires them to have played **all 8 hands**.
- Per-player stats (avg, wins, etc.) count only complete games.

---

## 3. Word Parsing

- Players submit a space-separated / `+`-separated / comma-separated list of words.
- All three separators are equivalent: `"cat+dog"`, `"cat dog"`, `"cat,dog"` parse the same.
- Hyphens assert explicit card boundaries: `qu-i-z` forces cards QU, I, Z (no alternatives offered).
- Without hyphens the parser enumerates all ways the letters can be formed from cards, including using digraphs.
- **Every played word must use at least 2 cards.** Single-card submissions are not allowed (so `"a"` or `"i"` alone is rejected — but `"aa"` passes under the same-vowel house rule; see §7).
- Empty submission is valid — player couldn't form a word, scores 0 for the hand.

### Digraph handling

- `IN` and `ER` are **neutral** — same score as their letter equivalents (I+N, E+R). Resolved automatically based on what fits the dealt hand.
- `QU`, `TH`, `CL` have **different scores** than their letter equivalents. If either reading is possible from the dealt hand, the player must pick which interpretation to use.

---

## 4. Scoring

- **Raw score** = sum of card point values across all cards used in played words.
- **Stars** = bonus awards (see §5). Each star = **+10 points**.
- **Effective score** = `raw_score + stars * 10`.
- **Hand winner** = player with the sole highest effective score. Ties = no hand winner.
- **Game winner** = player with the highest sum of effective scores across all 8 hands.

---

## 5. Star Rules

Stars are awarded per hand:

1. **Longest Word star** — awarded to the player whose single longest word (counted by **letter count**, not card count — `QU` counts as 2 letters) exceeds every other player's longest word. Ties = no star.
2. **Most Words star** — awarded to the player with the most words played this hand, exceeding every other player. Ties = no star.

Additional constraints:

- **3+ players required.** In 1- or 2-player games no stars are ever awarded.
- A single player can earn both stars on the same hand (max 2 stars / hand).
- Stars are awarded at hand completion (when all eligible players submit).

---

## 6. Mulligans

- A mulligan discards the dealt hand and redeals **one card fewer**.
- **Cards remaining after mulligans may never drop below 2** (to satisfy the 2-card word minimum). Max mulligans per hand = `hand_number - 2`.
- UIs should hide/disable the mulligan button when `cards_remaining <= 2`; the server also rejects any mulligan request that would take it below 2.
- Each mulligan counts against the player; they're tracked for stats.
- The redeal pool excludes cards currently held + previous mulligan discards for that hand.

---

## 7. Dictionary Validation (Merriam-Webster Collegiate)

Every word must resolve to at least one non-rejected MW Collegiate entry whose `meta.id` or `meta.stems` contains the submitted word (lowercased, alpha only).

### Entry rejection rules

Reject an MW entry if **any** of:

- `fl` contains `"prefix"`, `"suffix"`, or `"combining form"`
- `fl` is `"abbreviation"` or `"contraction"`
- `fl` is `"biographical name"`, `"geographical name"`, or `"trademark"`
- `meta.id` starts with an uppercase letter (proper-noun detection — e.g. `Oz`, `Luther`)
- `lbs` contains `"slang"`, `"informal"`, or `"substandard"`

A word is **valid** if at least one non-rejected entry matches. Otherwise **invalid**.

### House-rule overrides

- **Single-word repeated-vowel submissions are always accepted** — e.g. `"aa"`, `"eeee"`. Regex: `^([aeiou])\1*$`. Applied only when the submission is a single word, and still subject to the 2-card minimum from §3 (so `"a"` alone is rejected; `"aa"` and longer pass).
- A dictionary cache table can store `valid: false` records with `source: "house"` to block specific words (e.g. `"za"` is blocked despite MW's Collegiate entry because MW Unabridged labels it slang).
- The cache can also store vote-approved words (`source: "vote"`) that passed a player super-majority challenge.

### Caching

- All MW lookups and their stems are cached. Cache is first-check, MW is fallback.
- On MW API error the validator fails **open** (accepts the word) but does **not** cache.

---

## 8. AutoQ (Solo Mode) Specifics

AutoQ pits a human player against 0–7 opponents drawn from real historical game data.

### Opponent types

- **Bot** (`player_id === "__bot__"`): selects plays randomly from the aggregated history of **all** players. Gets a silly procedural name like `"Underpants"`, `"Gigglelack"`, etc.
- **Real player**: draws plays from that specific player's historical hands.
- All opponents (bots and real) get a random **adjective epithet** prefixed to their name — e.g. `"Legendary Kane"`, `"Pusillanimous Gigglelack"`.

### Game specifiers (real-player opponents only)

Optional hint for which historical game to draw plays from:

- Numeric game number (e.g. `42`) — draws from that specific game.
- `"best"` — draws from the player's highest-scoring game.
- `"worst"` — draws from the player's lowest-scoring game.
- `"latest"` — draws from the player's most recent game.
- Blank — random hand per hand.

Case insensitive.

### Flipped card pool

Unlike real Quiddler:

1. **Bot opponents pick their plays first**, claiming cards from the deck. Bots **can** conflict (pick the same cards as other bots).
2. **The human player is dealt from the remaining pool** — cards claimed by bots are removed before the human's hand is drawn.
3. Consequence: the more bots, the smaller / more constrained the human's dealt cards.

### Defaults

- Default to **3 Bot opponents** if no setup is specified.

### Stars in AutoQ

Same rules as §5 — 3+ players required, single-winner ties required.

### Mulligans in AutoQ

Same rules as §6. The mulligan redeal draws from the pool minus the player's current hand, minus previous mulligan discards for that hand, minus all cards already claimed by bots.

---

## 9. Historical-Hands Data Source

AutoQ bots draw real plays from this endpoint — public, CORS-open to any origin:

```
GET https://jqoyoafk29.execute-api.us-east-1.amazonaws.com/prod/stats/scores
```

Returns a JSON array. Each record:

```json
{
  "game_id": "e5a221eb-...",
  "player_id": "U03FRD18WJV",
  "player_slack_id": "U03FRD18WJV",
  "hand": 7,
  "raw_score": 42,
  "stars": 1,
  "words": "quest+vine",
  "word_count": 2,
  "longest_word_letters": 5,
  "breakdown": "QU-E-S-T  V-I-N-E",
  "mulligans": 0,
  "star_longest_word": true,
  "star_most_words": false,
  "submitted_at": "2026-04-15T20:31:44.123Z",
  "first_submitted_at": "2026-04-15T20:30:10.456Z"
}
```

`player_id` is an alias of `player_slack_id` added server-side. Use whichever.

Companion endpoints:

- `GET /prod/stats/players` — player roster with display names + lifetime stats.
- `GET /prod/stats/games` — completed games list with winners.
- `GET /prod/stats/dictionary` — `{ invalid: [...] }` list of dictionary-rejected words. Scrub these before displaying word stats.
- `GET /prod/stats/validatewords?words=cat+dog` — validate arbitrary words against the dictionary. Returns `{ valid: [...], invalid: [...] }` per word.
- `GET /prod/stats/live` — currently-active game state, `null` if no live game.

Full dataset scan; not huge today but cache client-side.

---

## 10. Reference Implementations

All in the QBIMBOT codebase:

- **`qbim-bot/src/lib/cards.mjs`** — Deck, card values, word parsing, `getScoreOptions` (enumerates all breakdowns for a submission).
- **`qbim-bot/src/lib/dictionary.mjs`** — MW lookup, `entryRejected` (the filter from §7), `validateWords`, house-rule vowel exception.
- **`qbim-bot/src/lib/autoq-deck.mjs`** — Deck expansion, shuffle, hand dealing.
- **`qbim-bot/src/lib/autoq-bots.mjs`** — `selectBotPlays`, `buildPool`, bot-name generation, adjective epithets.
- **`qbim-stats-dashboard/src/data/autoq-engine.js`** — Browser-side AutoQ engine (what a web port would want to clone). Exports `createGame`, `submitHand`, `takeMulligan`, `getStandings`, `CARD_VALUES`, `BOT_PLAYER_ID`.

---

## 11. Minimum viable AutoQ port

1. Embed deck + card values from §1.
2. Implement word parsing per §3 (hyphen-assert, digraph handling).
3. Implement `getScoreOptions`: enumerate card combinations that can form the submitted words, pick highest score by default (or ask the player when `QU` / `TH` / `CL` is ambiguous).
4. Dictionary-validate via `/stats/validatewords` (cheapest) or self-host the same MW + rejection logic.
5. Deal from the 118-card pool using the flipped-order rule in §8 for AutoQ.
6. Fetch `/stats/scores` once on load for bot play material; cache in memory.
7. Apply star rules per §5, mulligan rules per §6.
8. Track hand 3→10, compute game winner per §4.
