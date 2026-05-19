# Power Deck — Specification

**A 126-card custom deck for QBIM / AutoQ.** Derived from corpus + playtest analysis (see *Provenance* below). Designed as a Quiddler-derivative game piece: data-tuned for the QBIM hand-3-through-10 mechanic, vowel-balanced for English word formation, with two new digraph cards (CH, CK) and a reordered bomb tier that lifts V above X in recognition of V's structural play difficulty.

---

## 1. Deck composition

**126 cards total** — 112 single-letter cards (A–Z) + 14 digraph cards (7 types).

```json
{
  "A": 11, "B": 3,  "C": 2,  "D": 4,  "E": 13, "F": 2,  "G": 4,  "H": 2,
  "I": 8,  "J": 2,  "K": 2,  "L": 4,  "M": 2,  "N": 6,  "O": 8,  "P": 3,
  "Q": 2,  "R": 6,  "S": 4,  "T": 6,  "U": 6,  "V": 2,  "W": 2,  "X": 2,
  "Y": 4,  "Z": 2,
  "QU": 2, "IN": 2, "ER": 2, "CL": 2, "TH": 2, "CH": 2, "CK": 2
}
```

## 2. Card point values

```json
{
  "A": 2,  "B": 8,  "C": 8,  "D": 5,  "E": 2,  "F": 6,  "G": 5,  "H": 7,
  "I": 2,  "J": 12, "K": 8,  "L": 3,  "M": 5,  "N": 4,  "O": 2,  "P": 5,
  "Q": 15, "R": 4,  "S": 3,  "T": 3,  "U": 5,  "V": 11, "W": 9,  "X": 10,
  "Y": 5,  "Z": 13,
  "QU": 9, "IN": 6, "ER": 6, "CL": 10, "TH": 9, "CH": 11, "CK": 12
}
```

## 3. Deck statistics

| Metric | Value |
|---|---|
| Total cards | 126 |
| Total points | 633 |
| Avg pts/card | **5.024** |
| Vowel-letter share (incl. digraph contributions) | 37.1% |
| English vowel baseline | ~38% |
| Distinct card types | 33 (26 singles + 7 digraphs) |

## 4. Digraph reference

| Digraph | Constituent sum | Card value | Discount | Reading |
|---|---|---|---|---|
| QU | Q(15) + U(5) = 20 | 9 | 11 pts | Heavy discount — structural Q-enabler |
| TH | T(3) + H(7) = 10 | 9 | 1 pt | Modest discount, standard digraph |
| CL | C(8) + L(3) = 11 | 10 | 1 pt | Modest discount, standard digraph |
| CH | C(8) + H(7) = 15 | 11 | 4 pts | New — unlocks C+H scarcity |
| CK | C(8) + K(8) = 16 | 12 | 4 pts | New — terminal/medial scarcity unlock |
| IN | I(2) + N(4) = 6 | 6 | neutral | Same-score as constituents; pick by hand fit |
| ER | E(2) + R(4) = 6 | 6 | neutral | Same as IN |

Players choose digraph card vs split-letter representation per the rules in `AUTOQ_RULES.md` §3.

## 5. Bomb tier (ordered)

| Letter | Value | Notes |
|---|---|---|
| Q | 15 | Heritage Quiddler value — the lone anchor |
| Z | 13 | |
| J | 12 | |
| V | 11 | Above X: medial-only, zero 2-letter words (Most-Words penalty) |
| X | 10 | Multiple 2-letter forms (ax, ex, ox, xi, xu) |
| W | 9 | Most positionally flexible bomb |

Every value distinct. Five of six values different from Quiddler; only Q matches.

## 6. Differences from base Quiddler (118-card deck)

### Card count adjustments (+8 cards total → 126)
| Card | Quiddler | Power | Δ |
|---|---|---|---|
| A | 10 | 11 | +1 |
| B | 2 | 3 | +1 |
| E | 12 | 13 | +1 |
| P | 2 | 3 | +1 |
| CH | 0 | 2 | +2 (new) |
| CK | 0 | 2 | +2 (new) |

### Point value changes
| Card | Quiddler | Power | Δ | Driver |
|---|---|---|---|---|
| G | 6 | 5 | −1 | G is 2× more common in corpus than F |
| N | 5 | 4 | −1 | Effective supply 8 (with IN); over-supplied |
| P | 6 | 5 | −1 | 3 copies now (less scarce); parity with G |
| R | 5 | 4 | −1 | Effective supply 8 (with ER); over-supplied |
| U | 4 | 5 | +1 | Top-hands over-rep + rejected-words demand |
| Y | 4 | 5 | +1 | Dual-role utility; rejection-rate demand |
| J | 13 | 12 | −1 | Bomb tier differentiation |
| W | 10 | 9 | −1 | Bomb tier differentiation; W also least over-rep in top hands |
| X | 12 | 10 | −2 | Bomb tier reorder — X drops below V (positional flexibility) |
| Z | 14 | 13 | −1 | Bomb tier differentiation |
| IN | 7 | 6 | −1 | Forced by N=4 to keep neutral (I+N=6) |
| ER | 7 | 6 | −1 | Forced by R=4 to keep neutral (E+R=6) |
| CH | — | 11 | new | Discount vs C+H=15 |
| CK | — | 12 | new | Discount vs C+K=16 |

### Values explicitly held at Quiddler (data didn't push hard enough to move)
A, B, C, D, E, F, H, I, K, L, M, O, **Q**, S, T, **V**, QU, CL, TH

### Deck totals
| | Quiddler | Power |
|---|---|---|
| Cards | 118 | 126 |
| Total points | 592 | 633 |
| Avg pts/card | 5.017 | **5.024** |

Average stays in the same neighborhood; per-hand expected scoring is essentially unchanged. The differentiation is in *which* letters move points around, not in deck inflation.

## 7. Design principles applied

1. **Per-letter counts data-driven where signal converges.** B and P bumped because corpus and playtest both said under-supply; A and E bumped to maintain English vowel share with the larger deck.
2. **Two new digraph cards, both "unlock" type.** CH and CK pair scarce single-letter cards (C, H, K all 2-copy singles in the base deck) to enable word space that was effectively unbuildable before. SH was considered and rejected: adding SH alongside CH and TH would crowd H-bearing digraphs without sufficient variance.
3. **Bomb tier every-value-distinct, reordered by play difficulty.** V above X because V is medial-only with zero 2-letter words; X has five 2-letter words and contributes easily to the Most-Words star. Q held at heritage 15 as a deliberate anchor — the only Quiddler-matching value in the bomb tier.
4. **Digraph integrity preserved.** Every digraph maintains its discount or neutral relationship vs constituent letters. No digraph ever costs more than its split form.
5. **Vowel share calibrated to English.** 37.1% vowel-letter share vs ~38% English baseline. Within design tolerance.

## 8. Provenance

Built across three analyses in this repo:

- **`AUTOQ_POINT_VALUES.md`** — initial point-value analysis (anchored on corpus + 822 playtest hands; introduced CH=11, U=5, G=5, Y=5)
- **`AUTOQ_LETTER_COUNTS.md`** — count tuning + digraph survey (introduced +1 B, +1 P, +2 CH, +2 CK; identified SH as candidate that was later dropped)
- **Iteration thread** — final round of value tuning to land at avg 5.0X with bomb tier reordering, vowel rebalancing, and digraph-math consistency

Source data:
- ENABLE1 wordlist (Norvig mirror), 125,541 words after 2–10 letter filter
- 903 playtest hand records (822 cleanly parsed for replay)
- 666 dictionary-rejected words

Analysis scripts in `analysis/scripts/` (01 through 08). Raw + derived data in `analysis/data/` (gitignored — regenerable from `/stats/*` snapshots).
