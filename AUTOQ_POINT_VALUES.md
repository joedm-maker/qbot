# AutoQ / QBIM — Point Value Analysis

**Status:** Proposal, derived from corpus + playtest data. Per-letter card *counts* held at Quiddler defaults per scope; this analysis tunes *point values* only and prices the new **CH** card.

**Author note:** treat the recommendations as conservative tuning, not radical redesign. The Quiddler value system is already well-calibrated against word-formation reality — most letters land where data says they should. The four moves below are the ones the data supports with multiple corroborating signals; everywhere else, holding the iconic Quiddler value is the right call.

---

## 1. Data reviewed (and gaps)

| Source | Status | Volume | Notes |
|---|---|---|---|
| ENABLE1 wordlist (Norvig mirror — equivalent to ENABLE2K for letter-frequency purposes) | ✅ Acquired | 172,820 words total; 125,541 in the 2-10 letter subset used | Primary corpus baseline. Public domain. |
| Norvig's Google Books letter table | ✅ Embedded | Static table from `norvig.com/mayzner.html` | **Repurposed** — see §2. Did not function as expected sanity check. |
| Playtest hand records (`/stats/scores`) | ✅ Snapshotted | 4,455 records total; **903 word-bearing hands**; **822 hands successfully parsed and rescored** | Heavy concentration: top 3 of 7 players = 68% of hands. Hand sizes (3-10) evenly represented (87-119 each). |
| Playtest games metadata (`/stats/games`) | ✅ Snapshotted | 124 games — 122 Physical, **2 Digital** | Digital-deck records are the only games with dealt-card data; sample is too small for discard analysis (per user direction, dropped). |
| Rejected-word log (`/stats/dictionary`) | ✅ Snapshotted | **666 words** rejected by MW Collegiate validator | Used as a soft "demand signal" — letters players reached for that didn't pan out. |
| AutoQ-mode records | ⚠️ Not analyzed | Stored in a separate `qbim-autoq` DynamoDB table not exposed via public stats API | Would require AWS profile to query; user agreed signal would be thin and anecdotal. Deferred. |
| Dealt-card / discard-pattern data | ❌ Not computable | Only 2 Digital games with `hand_seen_cards`/`dealt_cards` records | Step 3-discard from original brief was dropped. |

**Confidence caveat.** 822 hands is real signal but small. 7 players, top three dominate. The recommendations below are sized to that — small moves where data converges; held positions where it doesn't.

---

## 2. Methodology notes

### Corpus choice and what it actually measures
- **ENABLE1, filtered to 2-10 letter alpha-only words.** Each word counted *once*. This produces a "letter-per-word-form" distribution, which is what a word-building card game selects from. ~125k words after filtering, ~1.05M letter occurrences.
- **Length-weighted variant**: each letter contributes proportionally to the length of the word it appears in. Used as the primary baseline because longest-word stars reward length and a length-bias matters.

### Google Books letter table — repurposed
The brief asked for a Google Books sanity check (flag any ENABLE1 deviation >15% relative). Running it produced enormous divergences for most letters (T -34%, H -53%, S +45%, K +116%, Z +387%). On inspection this isn't ENABLE1 being wrong — **Google Books counts running-text tokens** (dominated by `the`, `of`, `and`), while we care about **word-form letter distribution**. The two measure different things; comparing them produces noise.

The table is retained in §5 for reference but **does not flag corpus problems**. A better sanity check would be ENABLE1 vs another dictionary list (TWL, SOWPODS) — those produce near-identical distributions because they all measure the same thing. The divergence we'd worry about (ENABLE1 tail-vocabulary inflation of J/Q/X/Z) is real but small relative to those letters' baseline rarity.

### Weighting decisions
- **Length-weighted corpus frequency** is the primary anchor: it captures "how often each letter shows up in playable-length words."
- **Playtest letter frequency** is treated as a *behaviour signal*, not a value oracle. Playtest is selection-biased by current point values (Q at 15 pts gets hunted; M at 5 pts gets dropped). It tells us how players *respond* to the current economy, not what values "should" be.
- **Top-10% hands signal** (which letters over-perform in star-bearing hands) used only to validate iconic high-value letters are still doing their job.
- **Rejected-words signal** is a soft "letters players are reaching for" indicator. High rejection rates on a letter mean players have it in hand and try to form words from it; some success rate would imply the letter has buildable utility.

### Decision rules for value moves
1. **Don't move** a value unless ≥2 independent signals (corpus, playtest, rejected, structural) agree.
2. **Hold the iconic Quiddler high-value letters** (Q=15, Z=14, J=13, X=12, V=11, W=10, K=8, B=8, C=8). Top-10%-hands data confirms each is doing its scoring-driver job; cosmetic moves would only churn the economy.
3. **Hold vowels at 2** (A, E, I, O). They function as glue, not scoring; over-pricing them inflates routine hands and dampens the high-value-letter mechanic.
4. **CH point value**: discounted vs C+H=15, within user's 10-12 range, calibrated against TH/CL discount profile.

---

## 3. Proposed point value table

Per-card *count* is **unchanged** vs Quiddler everywhere except the new CH card.

| Card | Count | Value (proposed) | Quiddler value | Δ | Confidence |
|---|---|---|---|---|---|
| A | 10 | 2 | 2 | 0 | held |
| B | 2 | 8 | 8 | 0 | held |
| C | 2 | 8 | 8 | 0 | held |
| D | 4 | 5 | 5 | 0 | held |
| E | 12 | 2 | 2 | 0 | held |
| F | 2 | 6 | 6 | 0 | held |
| **G** | **4** | **5** | **6** | **−1** | **moderate — corpus** |
| H | 2 | 7 | 7 | 0 | held |
| I | 8 | 2 | 2 | 0 | held |
| J | 2 | 13 | 13 | 0 | held |
| K | 2 | 8 | 8 | 0 | held |
| L | 4 | 3 | 3 | 0 | held |
| M | 2 | 5 | 5 | 0 | held |
| N | 6 | 5 | 5 | 0 | held |
| O | 8 | 2 | 2 | 0 | held |
| P | 2 | 6 | 6 | 0 | held |
| Q | 2 | 15 | 15 | 0 | held |
| R | 6 | 5 | 5 | 0 | held |
| S | 4 | 3 | 3 | 0 | held |
| T | 6 | 3 | 3 | 0 | held |
| **U** | **6** | **5** | **4** | **+1** | **moderate — playtest + rejected** |
| V | 2 | 11 | 11 | 0 | held |
| W | 2 | 10 | 10 | 0 | held |
| X | 2 | 12 | 12 | 0 | held |
| **Y** | **4** | **5** | **4** | **+1** | **judgment — modest signal, dual-role** |
| Z | 2 | 14 | 14 | 0 | held |
| QU | 2 | 9 | 9 | 0 | held |
| IN | 2 | 7 | 7 | 0 | held |
| ER | 2 | 7 | 7 | 0 | held |
| CL | 2 | 10 | 10 | 0 | held |
| TH | 2 | 9 | 9 | 0 | held |
| **CH** | **2** | **11** | **— (new)** | **new** | **moderate — corpus-derived** |

**Total proposed deck: 120 cards, 620 pts.** Quiddler baseline: 118 cards, 592 pts. Average pts/card moves from 5.02 → 5.17 — essentially unchanged.

The 126-card target is **not** met by this proposal: it leaves 6 slots unallocated. Allocation of those 6 slots is deferred — count tuning was explicitly out of scope per current direction. Options for filling those slots if reopened: more A/E/I/O (lubrication), more CH/TH/ER/IN (boost digraph play), more Q/Z/J/X (lean harder into bombs), or distribute by corpus frequency.

### Rationale per move

**CH = 11** (new). CH appears in 4.01% of corpus words (5,039 of 125,541) — the **most common English digraph absent from Quiddler's deck**. Playtest data shows CH adjacency in only 0.43% of played words (7 of 1,627), an order of magnitude below corpus, because forming CH today requires both C and H to land in the same hand (each card has only 2 copies in the deck). Adding CH unlocks meaningful word space. Value of 11 sits between TH=9 (corpus 2.69%) and CL=10 (corpus 1.31%) on the per-card score axis while reflecting CH's higher frequency: a 4-point discount vs C+H=15 (~27%), parallel to the TH discount profile (1 of 10 = 10%) but slightly steeper because CH is a more open digraph (works word-initially, internally, terminally — `chair`, `each`, `which`). 10 and 12 are both defensible; 11 is the centroid.

**U: 4 → 5.** Three signals converge:
- Top-10%-hands over-representation: +27% over playtest baseline. Players who land big hands often have U in them — U is the Q-enabler (Q+U = 20 pts at proposed values, vs QU = 9 pts).
- Rejected-words over-representation: +30% over playtest. Players are reaching for U-bearing combinations beyond what dictionary supports.
- Playtest selection: +45% over corpus baseline. U gets sought after, not avoided.
A 1-point bump prices U closer to its strategic utility without breaking its vowel role.

**G: 6 → 5.** Corpus length-weighted frequency: G is 2.94% vs F is 1.38% — G is **~2x more common** than F, but Quiddler prices both at 6. Lowering G to 5 acknowledges its frequency. Playtest doesn't push back (G appears at 3.51% played, slightly below corpus, mildly under-represented in top hands). The asymmetry F=6 / G=5 mirrors the per-letter intuition that G is easier to place. Smallest-confidence of the three moves but data is one-directional.

**Y: 4 → 5.** Y is genuinely rare in corpus (1.57% length-weighted) but appears at 2.54% in playtest (+61%) and is over-represented in the rejected-words log (+24% vs playtest). Y is dual-role (vowel and consonant) and shows up in surprisingly many short words (`my`, `by`, `sky`, `try`, `dry`, `cry`). Quiddler prices Y same as U at 4; in our data U has stronger strategic justification for a bump, but Y has the same direction of evidence. **Judgment call** — could equally hold at 4 if you prefer minimum change.

### Letters where data hinted at a move but I held position

- **S = 3.** Massively under-played (-71% vs corpus, -56% in top hands). But this is the *intent* of S=3 — pluralization is a low-value commodity. Raising S would penalize a Quiddler-fundamental mechanic. Hold.
- **L = 3, M = 5, P = 6.** All under-played vs corpus (-43%, -40%, -29%). Same logic: these are commodity letters that lose out to point-bombs in the current economy. Their pricing reflects fair frequency-vs-value; the under-play is a downstream effect of the Q/Z/J/X gravity wells, not a mispricing. Hold.
- **H = 7.** Mid-frequency in corpus (2.35% length-weighted). Could be a 6. But H=7 keeps TH=9 and (proposed) CH=11 sitting where the discount math feels right. Moving H to 6 would force compensating moves on both digraphs. Hold.
- **CL = 10, QU = 9.** Both massively preferred over their split forms in playtest (CL 95%, QU 92%). Slight undercurrent that they're underpriced (digraph is too good). But these are iconic Quiddler values and the player preference is *what we want* — digraphs should win. Hold.

---

## 4. Comparison table vs Quiddler

| Card | Q-count | Proposed count | Δ count | Q-value | Proposed value | Δ value |
|---|---|---|---|---|---|---|
| A-F, H-T, V-X, Z | unchanged | unchanged | 0 | unchanged | unchanged | 0 |
| G | 4 | 4 | 0 | 6 | 5 | −1 |
| U | 6 | 6 | 0 | 4 | 5 | +1 |
| Y | 4 | 4 | 0 | 4 | 5 | +1 |
| All 5 existing digraphs | 2 each | 2 each | 0 | unchanged | unchanged | 0 |
| CH | 0 | 2 | +2 | — | 11 | new |
| **Deck total** | **118 cards** | **120 cards** | **+2** | **592 pts** | **620 pts** | **+28** |

---

## 5. Sanity check results

### 5.1 ENABLE1 vs Google Books — methodology divergence (see §2)

Letters with >15% relative divergence between ENABLE1 length-weighted % and Google Books %:

| Letter | ENABLE1 % | Google Books % | Δ rel | Likely explanation |
|---|---|---|---|---|
| T | 6.23 | 9.28 | −34% | Google Books over-counts due to repeated `the`/`that`/`it` |
| H | 2.35 | 5.05 | −53% | Same — `he`/`have`/`his`/`the` |
| F | 1.38 | 2.40 | −41% | `of`/`for`/`from` repetition |
| W | 0.97 | 1.68 | −39% | `with`/`was`/`were` |
| O | 6.21 | 7.64 | −19% | `of`/`to`/`for` |
| N | 6.36 | 7.23 | −14% | `in`/`and`/`an` |
| S | 9.47 | 6.51 | +45% | ENABLE inflates S via plurals + `-ness`/`-less` |
| R | 7.25 | 6.28 | +15% | ENABLE inflates via `-er`/`-or` suffixes |
| L | 5.40 | 4.07 | +33% | `-ly` and `-able` |
| U | 3.43 | 2.73 | +27% | ENABLE inflates via `-ous`/`-ure` |
| P | 2.86 | 2.14 | +35% | `-tion`/prefix `pre-` |
| G | 2.94 | 1.87 | +57% | `-ing` participles in ENABLE |
| B | 2.04 | 1.48 | +41% | Less explicable — probably tail vocabulary |
| K | 1.10 | 0.54 | +116% | Tail (e.g., `-ick`, archaic `k` words) |
| X | 0.30 | 0.23 | +36% | Modest tail inflation |
| J | 0.19 | 0.16 | +31% | Modest tail inflation |
| Q | 0.18 | 0.12 | +47% | Tail (`qadi`, `qoph`, etc.) |
| Z | 0.43 | 0.09 | +387% | Heavy tail (Scrabble-only Z-words) |

**Reading.** The high-rare-letter divergence (K, Q, X, J, Z) is the kind we should care about for a card game — it suggests ENABLE1 may exaggerate how often rare letters show up in *playable* words. But the absolute frequencies stay tiny (Z is 0.43% even with the inflation), so even the magnification doesn't break our proposed values. The high-frequency mid-letter divergence (T, H, F, O — all *lower* in ENABLE) is not a corpus problem; it's the function-word effect.

### 5.2 Deck total + average pts/card

| Metric | Quiddler | Proposed |
|---|---|---|
| Card count | 118 | 120 |
| Total points in deck | 592 | 620 |
| Average pts/card | 5.02 | 5.17 |

Stays in the same shape — average pts/card up by 3%. No risk of inflating routine play.

### 5.3 Playtest replay (822 successfully parsed hands)

Re-scoring every played hand under proposed values:
- **Reported scores reconciled with old-value reconstruction: 822 of 822** (validates parser).
- **Mean delta per hand: +0.17 pts.** Nearly zero economic shift.
- **Hands shifted positive: 221; negative: 108; unchanged: 493.**
- **Top-20 hand stability: 18 of 20** — only 2 hands lose or gain a top-20 placement under the new values. Both moves are within ±5 pts of their old computed total. The change does not reshuffle the leaderboard.

### 5.4 Notional expected raw score per hand

Average letter value across the corpus length-weighted letter mix:
- Quiddler values: **4.036 pts/letter**
- Proposed values: **4.056 pts/letter** (+0.5%)

Notional best-word score for each hand size (avg-letter-value × cards used):
| Hand | Quiddler | Proposed | Δ |
|---|---|---|---|
| 3 | 12.1 | 12.2 | +0.1 |
| 4 | 16.1 | 16.2 | +0.1 |
| 5 | 20.2 | 20.3 | +0.1 |
| 6 | 24.2 | 24.3 | +0.1 |
| 7 | 28.2 | 28.4 | +0.2 |
| 8 | 32.3 | 32.5 | +0.2 |
| 9 | 36.3 | 36.5 | +0.2 |
| 10 | 40.4 | 40.6 | +0.2 |

Practical reading: a player who plays "average" words scores nearly the same as before. The proposed shifts surface only in hands that lean on U, Y, G, or CH — exactly where we want differentiation.

### 5.5 Stress test — common word coverage

Per-letter counts unchanged ⇒ buildable-word space unchanged for everything except CH-bearing words, which gain. No common 4-7 letter word becomes harder to build. CH unlocks a meaningful slice of corpus words that previously needed both C and H in the same hand (both 2-copy cards in a 118-card deck — a low-probability event).

### 5.6 Data quirks worth flagging

- **0 two-star hands in 903 word-bearing playtest records.** Either historical imports never populated star fields, or two-star hands genuinely never happened. Worth verifying against the underlying DynamoDB if this matters for any other analysis.
- **81 parse failures** out of ~1,700 word tokens. Spot-checks suggest these are historical imports with a different `breakdown` format. Excluded from the 822-hand rescore.
- **Player concentration**: top 3 of 7 players account for 562 of 822 hands (68%). Recommendations should be re-examined if future playtest broadens the contributor pool — especially the U=5 and Y=5 moves, which rest partly on selection patterns.

---

## 6. Playtest empirical findings

### Where corpus and playtest agreed
- **Vowels (A, E, I, O) line up** within ±9% of corpus — current value of 2 each is appropriate.
- **N, R, T, D** track corpus reasonably (±10-20%). Current values appropriate.
- **High-value letters (Q, Z, J, X)** are absolutely doing their job — over-represented in top-10% hands by 50-124%. Value structure is working.

### Where they diverged (and the explanation each time)
- **Z +371%, Q +1355%, X +537%, J +918%, W +128%, V +89%, K +85%, U +45%, Y +61%** vs corpus in playtest. **Caused by point-value selection** — players hunt these aggressively. Read: current values successfully shape behaviour. Not an under-supply signal.
- **S -71%, L -42%, M -40%, P -28%, C -24%** vs corpus in playtest. **Caused by opportunity cost** — these letters are commodity scoring; players prefer point-bombs even when commodity letters are available. Value structure produces this; no over-supply signal here either.

### Digraph card utilization
| Digraph | Card-form uses | Split uses (X+Y) | Card preferred % |
|---|---|---|---|
| CL | 76 | 4 | 95% |
| QU | 76 | 7 | 92% |
| TH | 80 | 10 | 89% |
| ER | 111 | 51 | 69% |
| IN | 107 | 58 | 65% |

CL/QU/TH (scoring-discount digraphs) win nearly every time. ER/IN (neutral-score digraphs) chosen based on hand-fit. **All five digraph cards earn their slots.** Strong precedent for adding CH.

### CH unrealized demand
- **Corpus**: 4.01% of words contain CH adjacency (5,039 words).
- **Playtest**: 0.43% of played words contain CH adjacency (7 of 1,627).
- **Order-of-magnitude gap** is the strongest single argument for adding CH. The current deck makes CH-bearing words effectively unbuildable (both C and H are 2-card letters); adding a dedicated CH card removes that barrier.

### Rejected-words signal
Letters over-represented in rejected words **vs playtest** (i.e., players reach for them and fail more than they succeed):
- C +91%, L +71%, V +40%, R +29%, U +30%, Y +24% — these are letters where attempted reaches outpace successful plays. C and H in particular show up disproportionately in rejected words (C +45% vs corpus, H +81% vs corpus), reinforcing that **CH is a productive but under-supplied combination**.

---

## 7. Differentiation summary

This deck is a **derivative of Quiddler with data-driven tuning**, not a copy.

Differences from Quiddler:
1. **CH added as a 6th digraph card at value 11.** Corpus-derived: CH is the most common English digraph absent from Quiddler. Playtest data shows the gap between CH-availability-in-words (4.01% of corpus) and CH-actually-played (0.43% of playtest) is the single largest unrealized word-space in the current deck. Pricing is calibrated against TH and CL — discounted relative to C+H=15 by ~27%, parallel to TH's discount.
2. **G repriced 6 → 5.** Corpus shows G is ~2× more common than F (2.94% vs 1.38% length-weighted) yet Quiddler prices both at 6. The asymmetric repricing matches asymmetric frequency.
3. **U repriced 4 → 5.** Three converging signals: top-10% playtest over-representation, rejected-words over-representation, and U's role as the gateway to Q's 15-point payoff. The bump prices the strategic enabler closer to its actual contribution.
4. **Y repriced 4 → 5.** Lowest-confidence move. Y is rare in corpus, over-played in playtest, dual-role between vowel and consonant. The bump is a small acknowledgment of utility; could equally hold at 4.

What we held and why:
- Every iconic Quiddler high-value letter (J, Q, V, W, X, Z) — playtest confirms each is doing its scoring-driver role. Moving them would churn the economy without improving balance.
- The vowel block (A, E, I, O = 2) — commodity glue; current pricing works.
- Mid-tier consonants (B, C, D, F, H, K, M, N, P, R, S, T) — held against various directional pressures because any individual move was within the noise floor and would require compensating moves elsewhere.
- All five existing digraphs (CL, ER, IN, QU, TH) — well-utilized at current values per playtest digraph-vs-split data.

Average pts/card moves from 5.02 → 5.17 (+3%). The economy stays Quiddler-shaped.

---

## 8. Open questions and recommendations for further playtesting

1. **CH = 10 vs 11 vs 12.** Empirical follow-up: once CH ships, measure CH digraph-card preference rate (vs C+H split) and compare to CL (95%), TH (89%), QU (92%). If CH preference lands ≥90%, the discount is too generous and value should rise to 12. If it lands <70%, value could drop to 10. Currently 11 is the centroid estimate; this is the most adjustable number in the proposal.
2. **Y move is the weakest.** If you want maximum data confidence, hold Y at 4 and revisit after another 500 playtest hands. The other three moves (CH, U, G) are stronger.
3. **The 6 unallocated card slots** (126 target − 120 proposed) are the natural place to explore deck-shape changes once the value tuning settles. Candidates:
   - +2 CH (total 4 CH cards) if CH digraph turns out to play heavily — reinforces the new mechanic.
   - +2 each of A/E/I/O (vowel lubrication) if playtest shows hand-bloat from rare consonants.
   - +1 each of high-value bombs (J, Q, X, V, W, Z) — but this would dilute their rarity premium and probably feels wrong.
   - Distribute by length-weighted corpus frequency (essentially: +1 N, +1 R, +1 S, +1 T, +1 L, +1 D).
4. **Restart discard analysis when Digital deck adoption grows.** The current sample is 2 games. At ~20 Digital games we'd have enough dealt-card data to do real discard-pattern analysis — and at that point, the discard signal would directly inform whether any card is over-supplied.
5. **Two-star hands seem missing.** 0 of 903 word-bearing hands have stars=2. Worth verifying against DynamoDB whether stars are correctly recorded for historical imports — if there's a data bug, it would affect any future analysis that uses star fields.
6. **Track CH play rate after launch as the primary diagnostic.** If CH gets played at <2× current C-card play rate within 200 hands, the addition isn't earning its slot and CH value should rise (or count should reduce). If CH plays at >4× current C-card rate, value should fall.

---

## Appendix: scripts and raw data

All analysis scripts live in `analysis/scripts/` and are re-runnable from a clean checkout:
- `01_corpus.mjs` — ENABLE1 letter + digraph frequencies, length-stratified and position-flexible
- `02_playtest.mjs` — Playtest letter frequencies, digraph utilization, top-10%-hands analysis
- `03_rejected.mjs` — Rejected-words letter analysis
- `04_proposal_and_sanity.mjs` — Proposal synthesis, deck totals, playtest replay, expected-score simulation

Raw data files in `analysis/data/` (gitignored — snapshot any time from `/stats/*` endpoints):
- `enable1.txt` — corpus
- `scores.json`, `games.json`, `dictionary.json` — playtest snapshots
- `corpus_summary.json`, `playtest_summary.json`, `rejected_summary.json`, `proposal_summary.json` — derived outputs
