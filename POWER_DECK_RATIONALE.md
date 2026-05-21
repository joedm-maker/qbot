# Power Deck — Decision Defense

Companion to `POWER_DECK.md` (the spec) and the underlying analysis (`AUTOQ_POINT_VALUES.md`, `AUTOQ_LETTER_COUNTS.md`). This document defends each concrete decision in the final deck against the data and the design intent.

**Final deck**: 126 cards, 633 pts, avg **5.02 pts/card**, vowel share 37.1% (Quiddler: 39.1%, English: ~38%).

---

## 1. What was measured

Two independent inputs informed every decision:

1. **Corpus baseline** — ENABLE1 wordlist (Norvig mirror, equivalent to ENABLE2K for letter-frequency purposes), filtered to 2–10 letter alpha-only words: **125,541 words**, **~1.05M letter occurrences**. Length-weighted letter frequency was the primary anchor because longest-word stars reward length.
2. **Playtest reality** — 4,455 historical hand records from the live QBIM bot, of which **903 carried played words and 822 parsed cleanly for replay**. All 822 reproduce their reported scores bit-identically under the refactored Quiddler code path.

Two ancillary signals:

3. **Rejected-word log** — 666 words that players tried to play and dictionary-blocked. A "demand" indicator: which letters were players reaching for that didn't pan out.
4. **Card position data** — for each letter, the share of corpus occurrences at word-initial / medial / terminal. Used to evaluate digraph candidates and the bomb tier reorder.

The Google Books letter-frequency table was acquired as a planned sanity check but **repurposed** when it produced large divergences from ENABLE1 (T −34%, H −53%, Z +387%). On inspection this isn't ENABLE1 being wrong — Google Books counts running-text tokens dominated by `the`/`of`/`and`, while a word-building card game selects from word-form letter distribution. The two measure different things; only ENABLE1 is the right anchor.

---

## 2. Count decisions — what was added (8 cards, Quiddler 118 → 126)

### 2.1 +1 A (10 → 11) and +1 E (12 → 13) — vowel preservation

**The story**: When the count proposal originally added +2 CH, +2 SH, +2 CK plus +1 B, +1 P, the vowel-letter share of the deck dropped from Quiddler's 39.1% to 35.2% — about a 10% relative reduction. This was caught when the spec was being finalized.

**The fix**: dropping SH freed 2 card slots; those went to +1 A and +1 E. Vowel share recovered to 37.1%, almost exactly matching the English baseline (~38%) and the Quiddler reference (39.1%).

**Why not +1 I or +1 O?** E is the single most common letter in English (11.8% length-weighted in corpus). A is the second-most-common vowel (7.7%). I and O sit at 8.3% and 6.2%; both are reasonably supplied already (8 cards each). Adding to E and A delivers the largest accessibility boost per card.

### 2.2 +1 B (2 → 3) and +1 P (2 → 3) — convergent supply signal

These are the **only two single-letter count moves** where both the corpus and the playtest data converge on under-supply:

| Letter | Corpus % | Quiddler supply share | Playtest play % | Signal |
|---|---|---|---|---|
| B | 2.04 | 1.69 (−17% vs corpus) | 2.14 (+27% over supply share) | both say "more B" |
| P | 2.86 | 1.69 (−41% vs corpus) | 2.05 (+21% over supply share) | both say "more P" |

Every other under-supplied single (C, S, M, L, D, etc.) is *also* under-played in playtest — meaning players have access but skip them in favour of higher-value letters. Adding more would inflate idle stock. B and P are different: players *seek* them and the deck under-provisions them.

**Counter-argument to a bigger bump**: B and P at value 8 and 6 respectively are scoring-relevant mid-tier. Doubling them would dilute that. +1 each (50% supply increase) is the smallest meaningful move.

### 2.3 +2 CH — the flagship new digraph

**The data**:
- CH appears in **4.01% of 2–10 letter corpus words** (5,039 words). Most common English digraph absent from Quiddler.
- Both C and H are 2-copy singles in the base deck — the rarest pair in Quiddler. Forming a CH word currently requires both scarce singles in the same hand.
- Playtest measurement: CH adjacency in played words is **0.43%** (7 of 1,627). Order-of-magnitude below corpus — the deck makes ch-words effectively unbuildable.
- Position spread: 22.7% initial / 77.1% medial / 0.2% terminal — works everywhere except word-end. Spread score 1.25 bits, higher than every existing Quiddler digraph except TH.

**Why this is the strongest case**: corpus says it should appear in 1 of every 25 played words; playtest says it appears in 1 of every 230. That gap is the largest unrealized word-space in the existing deck. Adding CH closes it.

### 2.4 +2 CK — terminal/medial scarcity unlock

**The data**:
- CK appears in **2.51% of corpus words** (3,148). Heavily terminal-and-medial (back, lock, sick, neck, ducks, tickle).
- Both C and K are 2-copy singles — same scarcity argument as CH.
- Position spread 0.69 bits — lower than CH because CK rarely appears initially. But it dominates word-end positions for short common nouns.

**Why CK instead of another corpus-strong digraph?** Looked at six candidates with the same "scarcity unlock" property: CH, SH, CK, PH, WH, and TH (already in Quiddler).

| Digraph | Word % | Unlock words | Notes |
|---|---|---|---|
| CH | 4.01 | 5,039 | **Add** |
| SH | 3.24 | 4,070 | H is scarce; S isn't. **Initially added, then dropped — see §3** |
| CK | 2.51 | 3,148 | **Add** |
| PH | 1.43 | 1,793 | Niche scientific vocab (photo, graph) — too narrow |
| WH | 0.51 | 637 | Interrogatives only — too narrow |

CH and CK won on broad-coverage word availability. PH and WH would be cosmetic additions targeting narrow vocabulary slices.

### 2.5 Why these specific 8 added slots (and not 10, or 6)

The original target was 126 cards (the makeplayingcards.com flexible option above 118). Choices considered:

- **126 (final)**: 8 new slots = +2 CH + +2 CK + +1 A + +1 B + +1 E + +1 P. Two new digraphs, four single-letter bumps, three of which (A, E, B/P) restore vowel share or address supply gaps. Balanced.
- **128**: would have kept SH alongside CH and CK. Rejected for variance/UX reasons — see §3.
- **122**: ship only the strongest two adds (CH × 2) and nothing else. Defensible but leaves a bigger lift on the table (B/P bumps, vowel preservation).
- **120**: CH only (no second digraph). Conservative.

**126 was retained** because (a) the printable size option exists, (b) the marginal cost of each added card is low if its data signal is convergent, and (c) the vowel-restoration moves were *required* anyway once we added pure-consonant digraph cards.

---

## 3. Why SH was dropped

The initial `AUTOQ_LETTER_COUNTS.md` proposal added **SH** as the second new digraph alongside CH. The data was strong on paper:

- SH word-share 3.24% in corpus (second only to CH among new candidates)
- Position spread **1.46 bits** — the highest of any candidate, including all existing Quiddler digraphs
- S+H = 3 + 7 = 10 (neutral pricing — no scoring incentive, pure compression)

But the user's design intuition pushed back: *"I'd rather avoid getting a SH, CH and TH without other variance."*

**The defense of dropping SH**:
1. **Variance concern is real.** With CH (2 copies) + TH (2 copies) + SH (2 copies), the deck would carry **6 H-bearing digraph cards** plus 2 H singles = 8 H-card slots out of 128. That's a single letter touching every fourth card. Beyond corpus support, it's a UX concern: players seeing H-digraph stacks repeatedly feels mechanical.
2. **CK is a stronger unlock.** Dropping SH freed slots for CK (which targets *different* scarce letters — C and K, not S and H). SH would have only deepened C/H pools that CH already enriches.
3. **S is not scarce.** S has 4 singles in the base deck (more than any 2-card single). The "scarcity unlock" argument for SH was weakest of the candidates: only H is scarce, and CH already addresses that.
4. **Vowel rebalancing.** The 2 freed slots became +1 A and +1 E, restoring the vowel share that all-consonant digraph additions would have eroded.

**What we lost by dropping SH**: SH's position-spread advantage (1.46 vs CK's 0.69). SH would have been the most flexible new card. CK is terminal-heavy and won't fire as broadly. This is a real cost, accepted to address the variance concern.

---

## 4. Value decisions — what stayed put

### 4.1 Vowels held at 2 (A, E, I, O)

**The defense**: vowels are commodity glue. Their job is making words possible, not driving scores. Quiddler's choice of 2 each was carefully calibrated to:
- Match English vowel-letter frequency (37–39% of letters)
- Stay low enough not to inflate routine hands
- Stay non-zero so they're always worth playing

Playtest confirms: A, E, I, O playtest frequencies all sit within ±9% of corpus baseline. Vowels are doing exactly what they should. No move.

### 4.2 Bombs held in identity but every value distinct from Quiddler

**Quiddler values**: Q=15, Z=14, J=13, X=12, V=11, W=10.

**Power values**: Q=15, Z=13, J=12, V=11, X=10, W=9.

Reasoning:
- **Legal differentiation.** "Every value distinct from Quiddler" is a hard constraint because we are commissioning a physical deck. Five of six values move; Q stays as a heritage anchor.
- **Order changes only at V/X.** Q at top (always rarest), Z next (most playtest-driven scoring power), J after (next-rarest corpus). V and X swap.
- **Why V > X**: This is the one ordering inversion vs Quiddler. The data:

| Letter | 2-letter words | Position bias | Playtest top-hands % |
|---|---|---|---|
| V | **0** | 77% medial; 0.2% terminal | +20% over baseline |
| X | **5** (ax, ex, ox, xi, xu) | 85% medial; 11% terminal | +13% over baseline |

X has terminal flexibility *and* multiple 2-letter forms — both of which feed the "Most Words" star (which rewards stacks of short words). V has neither — zero 2-letter forms (like C; also why C is hard to capitalize on) and a 0.2% terminal rate. **V is structurally harder to play than X.** The fact that V earns +20% in top hands at value 11 says players who do place V do so well; X at value 12 over-rewards a more flexible letter. Power swaps them: V=11, X=10.

### 4.3 The four small moves (U, G, Y, P)

These are the **value changes with single-letter data convergence**:

**U: 4 → 5**
- Three signals converge:
  - Top-hand playtest over-rep: +27% (over the playtest average) — U appears in winning hands more than its play-rate share
  - Rejected-words over-rep: +30% — players reach for U-words that don't pan out (suggests demand)
  - Strategic enabler: U is the only path to Q (Q+U = 20 pts at proposed values; or QU = 9)
- Quiddler's U=4 prices it equal to a placeholder vowel. The data says U is doing strategic work that warrants a 1-pt bump.

**G: 6 → 5**
- Corpus: G appears at 2.94% (length-weighted). F appears at 1.38%.
- Quiddler prices both at 6. G is **2× more common than F** yet they're equal.
- Lowering G to 5 acknowledges the frequency asymmetry. F stays at 6 because it's actually rare enough to deserve it.

**Y: 4 → 5**
- Y is the weakest of the four moves on data alone — held intentionally as a "judgment call" in earlier rounds.
- Y is rare in corpus (1.57%) but dual-role (vowel + consonant), and appears at 2.54% in playtest (+61% over corpus). Rejected-words over-rep at +24% vs playtest.
- The move is small (1 pt × 4 cards = +4 pts deck-wide), defensible by utility-not-frequency reasoning, and falls into the "Quiddler-feel" tolerance band.

**P: 6 → 5**
- Driven by the count bump (P: 2 → 3 copies). When P becomes less scarce per card, the value-per-card should track downward.
- New value matches G=5 cleanly (both 4-card / 3-card letters at the same value).

### 4.4 The N/R cluster (with forced IN/ER follow-ons)

**N: 5 → 4** and **R: 5 → 4** — paired with **IN: 7 → 6** and **ER: 7 → 6**.

The N and R moves came up in the "land at avg 5.0" rebalancing pass. They were chosen because:

1. **Effective supply per corpus is over-supplied.** N's effective deck supply (singles + IN contributions) sits at 6.25% vs corpus 6.36% — about right. R sits at 6.25% vs corpus 7.25% — slightly under. But playtest plays both *at or above* supply share, so neither is genuinely under-supplied at the table.
2. **Both are high-count letters.** N has 6 cards, R has 6 cards. A 1-pt drop on each = 12 pts removed from deck total. This is the single biggest count-weighted move in the entire deck and was essential to bring the deck total back toward avg 5.0.
3. **IN and ER are forced to follow.** Quiddler prices IN and ER at 7 (neutral with I+N=2+5=7 and E+R=2+5=7). If N drops to 4 without IN also dropping, IN becomes a 1-pt *penalty* card (I+N=6 vs IN=7) — players would never use it. Same for ER. Lowering both digraphs to 6 keeps them neutral with their new constituent sum.

**Why N and R specifically, not other common consonants?** T and D were also candidates. T=3 in Quiddler is sub-vowel territory (alongside S=3 and L=3); dropping it further would push it below the "worth playing" floor and break the TH discount math (T+H=9, TH=9 becomes neutral with H=6, then neutral with H=7 makes TH=9 → 10 vs T+H=10 — also neutral). T was held. D was held because D=5 in Quiddler is already in the "common-but-cheap" zone and there's no constituent-digraph to break.

### 4.5 The H/TH iteration

This was the most-revised area of the value tuning. The arc:

**Round 1** (in `AUTOQ_POINT_VALUES.md`): H held at 7. No move.

**Round 2** (initial 5.0 rebalance): H: 7 → 6, TH: 9 → 8.
- Defense at the time: effective H supply doubled (4 → 8) via CH+SH+TH. H=6 reflects new abundance.
- TH: 9 → 8 was *forced* — with H=6, T+H=9, so TH=9 becomes neutral. Keeping TH discounted required TH=8 (1-pt discount, parallel to CL=10 vs C+L=11).

**Round 3** (after SH was dropped): SH removal meant H's effective supply dropped back to 4 (singles + CH + TH). The "H is now abundant" argument weakens. H restored to 7; TH restored to 9.

**Final state**: H=7, TH=9 — Quiddler values held.

**Why this is the right landing**: with SH out, H supply isn't substantially higher than Quiddler. The TH+CH digraph pair carries enough H-card weight that the singles ratio is similar. Pricing H=6 would have been premature given the SH drop. The iteration loop here was valuable — it caught a value move that was justified under one count proposal but not the next.

### 4.6 Held values that "felt" movable but stayed

- **B: held at 8** despite count bump to 3. B at 8 with 3 copies = 24 deck-pts (vs 16 in Quiddler). Considered B → 7 to track count change, but held at 8 because (a) the count bump was driven by demand signal, not over-supply, and (b) B at 8 is a Quiddler iconic that stays differentiated by count rather than by value.
- **D: held at 5** for similar reasons — early iterations dropped D to 4 to hit avg 5.0, then restored when the H/TH return-to-7/9 freed deck-points elsewhere.
- **K: held at 8** despite K's effective supply doubling via CK. K is rare in corpus (1.10%); 2 singles + 2 CK contributions still leaves K at the rare end of the deck. Held value reflects continued scarcity.
- **F: held at 6**, **M: held at 5**, **S: held at 3**, **T: held at 3**, **L: held at 3**, **C: held at 8** — none had data signals strong enough to overcome "Quiddler iconic" gravity.

---

## 5. Pricing the new digraphs

### CH = 11 (vs C+H = 15 = 4-pt discount)

**The defense**:
- CL is the precedent (10 vs C+L=11 = 1-pt discount).
- TH is the precedent (9 vs T+H=10 = 1-pt discount).
- QU is the structural outlier (9 vs Q+U=20 = 11-pt discount — entirely a Q-enabler mechanic).

CH at 11 with a 4-pt discount sits between the modest digraph discounts (CL, TH) and the QU outlier. Why steeper than CL/TH?
- CH's corpus word-share (4.01%) is **3× CL's (1.31%)** and 1.5× TH's (2.69%). It's the most-used English digraph.
- Both constituent letters (C, H) are scarce 2-copy singles. The unlock value is higher than CL (where L has 4 copies).
- A 4-pt discount makes CH attractive enough that players will prefer it over the split when both are dealt — modelling on CL/TH digraph-preference rates (~85-95% in playtest), we expect CH to land there.

10 and 12 are also defensible; 11 was the centroid choice.

### CK = 12 (vs C+K = 16 = 4-pt discount)

**The defense**:
- Both C and K are 2-copy scarce singles (same scarcity profile as CH).
- CK is terminal-heavy (less position flexibility than CH).
- 4-pt discount is identical to CH's — symmetric pricing for the two new "C-anchored scarcity-unlock" cards.
- C+K=16 → CK=12 keeps the per-card payoff (6 pts/card) above CL's per-card payoff (5 pts/card), reflecting CK's higher constituent sum.

---

## 6. Why Power requires Digital play

**Enforced at the API layer** (`createNewGame` in `game-flow.mjs`, `/games/create` validation in `web-game.mjs`): a game with `deck_variant: "Power"` must have `deck_type: "Digital"`.

**The defense**:
- Power adds two new card types (CH, CK) that don't exist in physical Quiddler decks. A Physical Power game can't be played until physical Power decks are commissioned and distributed.
- The constraint is a *safety check*, not a permanent rule. The data model keeps `deck_type` and `deck_variant` orthogonal so a future Physical Power can ship without a schema migration.
- Server-side enforcement means UI bugs or curl callers can't accidentally create un-playable games.

---

## 7. Bomb tier reorder summary

The complete bomb tier under Power (every value distinct from Quiddler, ordered by structural play difficulty):

| Card | Quiddler | Power | Reason |
|---|---|---|---|
| Q | 15 | **15** | Heritage anchor — only Quiddler-matching value. Rarest letter in corpus; structurally hardest (always needs U). |
| Z | 14 | **13** | Highest playtest scoring driver (+124% in top hands). −1 for differentiation. |
| J | 13 | **12** | Smallest corpus word pool of any bomb; positionally easy (initial-anchored). −1. |
| V | 11 | **11** | Held at heritage value but reordered above X. Medial-only; zero 2-letter words. |
| X | 12 | **10** | Five 2-letter words; "Most Words" friendly. −2. |
| W | 10 | **9** | Easiest bomb (96 three-letter words, multiple positions). −1. |

Total bomb deck-pts: Quiddler 2×(15+14+13+12+11+10) = 150; Power 2×(15+13+12+11+10+9) = 140. Net −10 pts.

---

## 8. Putting it all together — deck math

| | Quiddler | Power | Δ |
|---|---|---|---|
| Total cards | 118 | 126 | +8 |
| Total points | 592 | 633 | +41 |
| Avg pts/card | 5.017 | **5.024** | +0.007 |
| Vowel-letter share | 39.1% | 37.1% | −2.0pp |
| Distinct card types | 31 (26 singles + 5 digraphs) | 33 (26 + 7 digraphs) | +2 |

**Why the average barely moves**: the changes are deliberately economy-preserving. The 8 added cards averaging ~9.5 pts/card (3 are double-digit bombs) push avg up, but the 12 value moves (most of them −1 on mid-frequency consonants) pull it back down. Net +0.007 pts/card — within statistical noise of the Quiddler baseline.

**Why this matters**: Per-hand expected scoring is essentially unchanged. A player who plays Power for the first time will land in the same general scoring band they're used to from Quiddler. The differentiation surfaces only in hands that actually use CH, CK, or the value-shifted letters (U, G, Y, P, N, R, the bombs). That's intentional — Power doesn't ask players to relearn the game's scoring rhythm; it asks them to discover new word possibilities (CH/CK words) and slightly different strategic value tradeoffs.

---

## 9. What "Power Deck" is *not*

Decisions explicitly not made, to forestall the questions:

- **Not a "harder" or "easier" version of Quiddler.** Average per-card value is virtually identical. Total deck points scaled with card count.
- **Not a replacement for Quiddler.** The system supports both decks at the same time. Each game records its deck variant; stats segregate accordingly.
- **Not a Scrabble-tier rebalance.** We don't have Scrabble's letter pool size (100 tiles) or its scoring philosophy. Power stays Quiddler-shaped — short hands, point bombs, digraph specials.
- **Not finalized.** CH=11 vs 10 vs 12 is the most easily adjustable parameter; the V/X reorder is defensible but reversible. The 9 unallocated slots between 126 and a theoretical 135-card future expansion could absorb additional vowels, more CH/CK, or new digraph candidates that prove themselves in playtest.

---

## 10. Provenance trail

For readers who want to retrace the work:

1. **`AUTOQ_POINT_VALUES.md`** — first analysis pass. Held counts at Quiddler, tuned values only. Introduced CH=11, U=5, G=5, Y=5.
2. **`AUTOQ_LETTER_COUNTS.md`** — second pass, with values held. Tuned counts: +1 B, +1 P, +2 CH, +2 SH, +2 CK.
3. **Iterative refinement** — these two reports were combined and then iterated several rounds in conversation:
   - SH dropped on variance grounds; +1 A, +1 E added to restore vowel share.
   - Bomb tier shift: all six bomb values touched, every value distinct from Quiddler.
   - V/X reorder based on 2-letter-word data ("we still want them impactful" + "V is harder to use than X").
   - H/TH adjustments: down to 6/8 in one round (when H was effectively over-supplied via CH+SH+TH), restored to 7/9 in the final round after SH was dropped.
4. **`POWER_DECK.md`** — final spec, the canonical reference for the 126-card deck.

Analysis scripts are re-runnable from `analysis/scripts/01_corpus.mjs` through `09_phase5_integration.mjs`. Raw + derived data files live in `analysis/data/` (gitignored — regenerable from `/stats/*` snapshots and a public ENABLE1 mirror).
