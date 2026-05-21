# AutoQ / QBIM — Letter Count Analysis

**Status:** Sibling to `AUTOQ_POINT_VALUES.md`. This analysis holds point values at **Quiddler defaults** and tunes **card counts**, allocating the 8 spare slots between Quiddler's 118 and the 126-card target. Also ranks new-digraph candidates beyond CH.

**Headline proposal**
- +1 B, +1 P (singles where both corpus and playtest agree the deck is stretched)
- +2 CH, +2 SH, +2 CK (three new digraph cards)
- Total: 126 cards, 676 pts, avg 5.37 pts/card (Quiddler: 118, 592, 5.02)

**Treat as conservative tuning, not a redesign.** The Quiddler single-letter distribution holds up well against both the corpus and the playtest signal — only B and P show robust under-supply across both axes. The bigger story is **digraph expansion**: there are several productive English digraphs Quiddler doesn't carry, and the data supports adding at least two beyond CH.

---

## 1. Data reviewed

Same dataset as the values report (`AUTOQ_POINT_VALUES.md` §1). Re-used artifacts:
- ENABLE1 corpus (125,541 words after 2-10 letter filter)
- 903 word-bearing playtest hands, 822 cleanly parsed
- 666 rejected-word records
- Quiddler reference distribution + values

**One new analysis layer**: a survey of all 676 digraphs against the corpus, plus per-letter **effective supply** including digraph card contributions (QU contributes to both Q and U pools, etc.).

---

## 2. Methodology notes

### What "supply" means here
Each digraph card contributes 1 to each constituent letter's pool. QU at count 2 adds +2 to Q-supply and +2 to U-supply, on top of the singles. The effective per-letter supply matters because that's what determines whether a letter can be used at all in a given hand.

### Decision rules for count moves
1. **Don't move a single-letter count unless both corpus and playtest agree.** Corpus says how often a letter appears in word-forms; playtest says how often players actually want to use it. Either signal alone is suspect.
2. **Hold high-value bombs (J, Q, V, W, X, Z) at 2 copies.** Corpus says they're over-supplied; playtest says they're high-demand bombs working as designed. Subtracting would destroy the bomb mechanic; adding would dilute rarity.
3. **Hold S, M, L, P, C, D at current counts** even where corpus suggests under-supply — playtest pushes back hard on each (players don't grab them when available). Exception: P is borderline (corpus -45%, playtest +31% over supply); promoted.
4. **For new digraphs, prefer cards that either:**
   - **Unlock** word space gated by scarce singles (CH, SH, CK, PH, WH — each pairs at least one 2-card single)
   - **Compress** common clusters with strong positional flexibility (ST has the best spread of any candidate)
5. **Avoid digraph cards that are reverses of existing digraphs** (no RE because ER exists; no NI because IN exists). These would create card-vs-card ambiguity for no upside.

### Pricing of new digraph cards
Values must be set for CH, SH, CK even though "values are static" — they're new cards with no prior pricing. I used the same logic as the values report:
- **CH = 11** (4-pt discount vs C+H=15) — see values report for full rationale
- **SH = 10** (neutral; S+H=10 = same) — pricing parallels ER/IN
- **CK = 14** (2-pt discount vs C+K=16) — discount calibrated against CL (1-pt off C+L)

---

## 3. Proposed count table

| Card | Quiddler count | Proposed count | Δ | Value (held) | Confidence |
|---|---|---|---|---|---|
| A | 10 | 10 | 0 | 2 | held |
| **B** | **2** | **3** | **+1** | 8 | **moderate — convergent signal** |
| C | 2 | 2 | 0 | 8 | held (effective C-supply already up via CH+CK) |
| D | 4 | 4 | 0 | 5 | held |
| E | 12 | 12 | 0 | 2 | held |
| F | 2 | 2 | 0 | 6 | held |
| G | 4 | 4 | 0 | 6 | held |
| H | 2 | 2 | 0 | 7 | held (effective H-supply already up via CH+SH) |
| I | 8 | 8 | 0 | 2 | held |
| J | 2 | 2 | 0 | 13 | held |
| K | 2 | 2 | 0 | 8 | held (effective K-supply already up via CK) |
| L | 4 | 4 | 0 | 3 | held |
| M | 2 | 2 | 0 | 5 | held |
| N | 6 | 6 | 0 | 5 | held |
| O | 8 | 8 | 0 | 2 | held |
| **P** | **2** | **3** | **+1** | 6 | **moderate — convergent signal** |
| Q | 2 | 2 | 0 | 15 | held |
| R | 6 | 6 | 0 | 5 | held |
| S | 4 | 4 | 0 | 3 | held |
| T | 6 | 6 | 0 | 3 | held |
| U | 6 | 6 | 0 | 4 | held |
| V | 2 | 2 | 0 | 11 | held |
| W | 2 | 2 | 0 | 10 | held |
| X | 2 | 2 | 0 | 12 | held |
| Y | 4 | 4 | 0 | 4 | held |
| Z | 2 | 2 | 0 | 14 | held |
| QU | 2 | 2 | 0 | 9 | held |
| IN | 2 | 2 | 0 | 7 | held |
| ER | 2 | 2 | 0 | 7 | held |
| CL | 2 | 2 | 0 | 10 | held |
| TH | 2 | 2 | 0 | 9 | held |
| **CH** | **0** | **2** | **new** | 11 | **strong — corpus + scarcity unlock** |
| **SH** | **0** | **2** | **new** | 10 | **strong — best position spread** |
| **CK** | **0** | **2** | **new** | 14 | **moderate — scarcity unlock, terminal-heavy** |
| **Deck total** | **118 / 592 pts** | **126 / 676 pts** | **+8 cards** | avg 5.02 → 5.37 | |

### Rationale per move

**B: 2 → 3.** Of all 26 single-letter cards, B is one of only two where corpus and playtest agree on under-supply:
- Corpus length-weighted: B at 2.04%, deck supply 1.56% (−23% relative)
- Playtest play rate: 2.14% (+37% over supply share)
- Rejected-words log: 2.03% — close to corpus, no rejection bias
- All three signals push the same direction. B is a high-value letter (8 pts) at the bottom end of "scarce singles" — adding one card moves B-supply from 1.56% to 2.34%, closer to corpus demand without breaking the rarity premium.

**P: 2 → 3.** The other convergent case:
- Corpus: P at 2.86%, deck supply 1.56% (−45% relative — biggest single-letter undersupply that playtest also wants)
- Playtest: 2.05% (+31% over supply share)
- Rejected-words: 1.03% (low, but playtest demand is real)
- Similar logic to B. P is a 6-pt letter; one extra card moves supply from 1.56% → 2.34%.

**CH (new, count 2, value 11).** Same rationale as in the values report — most common English digraph absent from Quiddler (corpus 4.01% of words), both C and H are scarce 2-card singles, playtest CH-adjacency rate (0.43%) is an order of magnitude below corpus. Strongest case for any new card.

**SH (new, count 2, value 10).** SH has the **best position spread of any candidate digraph** (1.46 bits — higher than CH's 1.25, TH's 1.20, or any existing Quiddler digraph). Corpus word-share 3.24% (4,070 words). H is one of the scarce singles, so SH partially unlocks H-bearing words the same way CH does. Value 10 is neutral with S+H=10 — there's no scoring incentive, just compression, which keeps SH from over-charging plays.

**CK (new, count 2, value 14).** The third-strongest scarcity-unlock case: both C and K are 2-card singles, and CK appears in 2.51% of corpus words (3,148 words). CK is terminal-heavy (`back`, `lock`, `kick`, `duck`) and word-medial (`acknowledge`, `tickle`) — position spread 0.69, lower than CH/SH but the unlock value compensates. Value 14 is a 2-pt discount on C+K=16, parallel to CL=10 vs C+L=11 — pricing acknowledges the digraph card without making it dominant.

---

## 4. Effective supply changes

| Letter | Old effective supply | New effective supply | Δ | Comment |
|---|---|---|---|---|
| B | 2 | 3 | +1 | from +1 single |
| **C** | **4** | **8** | **+4** | from +2 CH and +2 CK digraphs |
| **H** | **4** | **8** | **+4** | from +2 CH and +2 SH digraphs |
| K | 2 | 4 | +2 | from +2 CK digraphs |
| P | 2 | 3 | +1 | from +1 single |
| S | 4 | 6 | +2 | from +2 SH digraphs |

C and H are the big winners — each effectively doubles in supply via the digraph additions. This is the right direction given their corpus demand vs playtest reach signals.

---

## 5. Sanity check results

### 5.1 Deck totals
| Metric | Quiddler | Proposed |
|---|---|---|
| Cards | 118 | 126 |
| Total points | 592 | 676 |
| Avg pts/card | 5.02 | 5.37 |

The avg-pts-per-card jump (+7%) is larger than the values report (+3%) because three of the 8 added cards are double-digit point cards (CH 11, SH 10, CK 14). Per-hand expected scoring will rise modestly — see §5.3.

### 5.2 Playtest compression sanity
Across the 903 word-bearing playtest hands, I scanned for adjacent card pairs that could have been replaced by a proposed new digraph:
- **CH adjacencies in played cards: 7**
- **SH adjacencies: 5**
- **CK adjacencies: 10**
- **22 hands** (of 903) had at least one such opportunity.

**Reading.** The retroactive impact is small — almost no hand could have scored differently under the new deck. This is *expected*: today's players don't reach for CH/SH/CK because both constituents are usually unavailable, so they don't form CH/SH/CK words. The new cards' real impact is unlocking word space that **isn't visible in current playtest**.

### 5.3 Existing-digraph compression rates (benchmark for "earning a card slot")
| Digraph | Used as digraph card | Used as adjacent split | Digraph preference |
|---|---|---|---|
| CL | 87 | 5 | 95% |
| TH | 91 | 16 | 85% |
| QU | 84 | 20 | 81% |
| ER | 114 | 63 | 64% |
| IN | 115 | 73 | 61% |

CL/TH/QU (scoring-discount digraphs) win nearly always; ER/IN (neutral digraphs) split closer to 60/40 by hand fit. **Threshold for "card slot earned": ≥60% preference.** New digraphs should be measured against this after launch:
- CH (11, 4-pt discount) — expected preference 85-95% (discount territory)
- SH (10, neutral) — expected preference 60-70% (compression territory)
- CK (14, 2-pt discount) — expected preference 80-90% (modest discount territory)

### 5.4 Deck size effect
Going from 118 to 126 cards means a slightly larger draw pool, so hand-to-hand variance drops marginally and certain specific cards (esp. the new digraphs) are less likely to appear in any given hand. This is a minor effect — at the maximum hand size of 10, players see ~8% of the deck; that drops to ~7.9% under the new deck.

---

## 6. Digraph candidate ranking

Surveyed all 676 possible digraphs against the corpus. Top candidates ranked by **word-share %** (productivity) and **position spread bits** (versatility — max 2.0 if perfectly even across initial/medial/terminal/standalone):

### Existing Quiddler digraphs (benchmark)
| Digraph | Word% | Position spread | Notes |
|---|---|---|---|
| ER | 15.83 | 0.99 | medial+terminal |
| IN | 15.56 | 0.72 | medial-dominant |
| TH | 2.69 | 1.20 | initial+medial+terminal |
| QU | 1.34 | 0.95 | initial+medial only |
| CL | 1.31 | 1.00 | initial+medial only |

### Top new candidates evaluated
| Rank | Digraph | Word% | Spread | C/H/K-scarce unlock? | Recommendation |
|---|---|---|---|---|---|
| 1 | **CH** | 4.01 | 1.25 | ✅ both scarce | **Add** |
| 2 | **SH** | 3.24 | **1.46** (best) | ✅ H scarce | **Add** |
| 3 | **CK** | 2.51 | 0.69 (terminal) | ✅ both scarce | **Add** |
| 4 | ST | 7.72 | 1.45 | ❌ both common | Defer — compression only, no unlock |
| 5 | NG | 9.29 | 0.84 | ❌ both common | Defer — terminal-only effectively |
| 6 | ED | 10.15 | 0.71 | ❌ both common | Defer — terminal suffix; would simplify play |
| 7 | RE | 9.71 | 1.22 | ❌ both common | Skip — reverse of ER; creates ambiguity |
| 8 | LE | 8.33 | 1.09 | ❌ | Defer — compression only |
| 9 | AN | 7.32 | 0.98 | ❌ | Defer — compression only |
| 10 | PH | 1.43 | 1.06 | ✅ both scarce | Skip — niche (mostly scientific words) |
| 11 | WH | 0.51 | 0.68 | ✅ both scarce | Skip — too narrow (wh-question words only) |

**Top picks rationale.** The unlock criterion is the decisive filter. ST/NG/ED/RE/LE/AN have higher productivity than CK or even SH but their constituents are already well-supplied as singles — they'd be **compression** cards, not **unlock** cards. Compression-only digraphs change game feel substantially (shorter card sequences for the same words → players form more words per hand) and are the riskier addition. The recommendation is to keep this expansion as **unlock-focused** so the new cards earn their slots through enabling new word space, not by shrinking the existing space.

### Candidates considered and rejected
- **RE.** Productive (9.71%) but is the reverse of ER — adding both creates redundant cards. Stick with ER as the canonical orientation.
- **PH/WH.** Both unlock scarce-letter words, but each is narrow: PH is mostly Greco-Latin scientific vocabulary (`photo`, `graph`, `physics`, `sphere`); WH is interrogative words plus a few derivatives (`what`, `when`, `where`, `whale`). Neither has the breadth of CH/SH/CK.
- **ED/NG/LY.** All highly productive but position-skewed to terminal — they're suffix cards. Terminal-only cards reduce game variety because they only help in *building toward* the end of a word.

---

## 7. Differentiation summary

This count proposal expands Quiddler in two directions, both data-supported:

1. **Two single-letter bumps (B, P).** The only singles where corpus undersupply and playtest demand converge. Small moves; small impact on game feel.
2. **Three new digraph cards (CH, SH, CK).** All three follow the same logic: pair at least one scarce single-letter card to unlock currently-difficult word space. CH is the strongest (best corpus signal, both letters scarce, broad positional use). SH adds the highest-spread digraph available. CK targets terminal C/K combinations that today are nearly impossible.

What's held against various directional pressures:
- **High-value bombs (J, Q, V, W, X, Z) at 2 copies each.** Corpus says over-supplied; playtest says heavily demanded. Working as designed.
- **Mid-frequency commodity letters (M, L, C, D)** where corpus suggests under-supply but playtest shows players ignore them. Adding more of these would just inflate idle stock.
- **Vowels (A, E, I, O) and N, R, T** are well-calibrated against corpus *and* playtest. No moves.
- **5 existing digraphs** all earn their card slots per playtest preference rates (61-95%). No changes to existing digraph counts.

Average pts/card: 5.02 → 5.37 (+7%). The economy stays Quiddler-shaped but tilts slightly richer because three of the added cards are double-digit values.

### How this interacts with the values proposal

This count proposal **holds Quiddler values for all existing cards** by design (per scope). New digraph values are derived from the same logic as `AUTOQ_POINT_VALUES.md`:
- CH = 11 (matches values report)
- SH = 10 (neutral — new pricing logic, parallels ER/IN)
- CK = 14 (discount — new pricing logic, parallels CL)

If both proposals are adopted together, the combined deck would have:
- Count changes from this report (+1 B, +1 P, +2 CH, +2 SH, +2 CK = 126 cards)
- Value changes from values report (U: 4→5, G: 6→5, Y: 4→5, plus the CH/SH/CK values)
- Combined deck: 126 cards, 698 pts, avg 5.54 pts/card

The two proposals are independent and additive; either can be adopted standalone.

---

## 8. Open questions and recommendations for further playtesting

1. **The Tier-2 slot allocation could differ.** I've allocated the last 2 slots to CK. Alternatives, in case CK doesn't feel right at the table:
   - **+2 ST instead of CK** — best non-unlock digraph; pure compression; lower risk than CK because S and T are both well-supplied
   - **+2 more singles** — could go to B and P (taking them to 4 each), or distribute to under-supplied mid-frequency letters
   - **Hold the 2 slots** for future playtest — ship at 124 cards
2. **Watch effective C and H supply.** With CH+CK, C's effective supply doubles (4 → 8). With CH+SH, H's effective supply doubles (4 → 8). If C or H starts appearing in *every* hand, the digraph balance is too rich and one CK or SH count could come down.
3. **Track new-digraph card preference rates after launch.** Threshold for "earning the slot" is ≥60% preference (matching ER/IN). If CK lands below 50%, it's not working; pull it. If SH lands above 90%, it might be too cheap at the neutral 10 — consider a half-point bump (though half-points don't exist; would have to round to 9 to make it actively discounted, or accept neutral pricing).
4. **The compression-only digraphs (ST, NG, ED, LE) are a separate experiment.** They would be a bigger game-feel change because they let players play more words per hand — worth their own discussion thread before adopting.
5. **Single-letter B and P moves are the weakest part of this proposal.** Both are small effects relative to the digraph additions. If the project wants minimum risk, ship the digraph additions only and leave singles at Quiddler counts. The 2 spare slots would then go to CK (or your Tier-2 alternative), arriving at 124 cards.

---

## Appendix: scripts and raw data

New scripts added for this analysis:
- `analysis/scripts/05_digraph_survey.mjs` — full 676-digraph corpus survey, ranks by word-share + position spread
- `analysis/scripts/06_supply_demand.mjs` — per-letter effective supply vs corpus + playtest demand
- `analysis/scripts/07_count_proposal.mjs` — count proposal synthesis + playtest compression sanity sim

Derived data:
- `analysis/data/digraph_survey.json` — all 676 digraphs ranked
- `analysis/data/supply_demand.json` — letter supply/demand analysis
- `analysis/data/count_proposal.json` — final proposal summary
