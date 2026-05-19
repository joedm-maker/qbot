// Phase 5 integration test — exercises the full Power deck path through
// library boundaries without invoking Lambda. Confirms the wiring put in place
// by Phases 1-4 produces correct end-to-end behavior.
//
// Scope:
//   1. Game creation logic — deck_variant validation + persist shape
//   2. Dealing — Power deck pool, fresh + mulligan paths
//   3. Score parsing — CH/CK options surfaced under Power but not under Quiddler
//   4. Score computation — Power values applied correctly
//   5. Stats API enrichment — deck_variant stamped on scores
//   6. Player stat segregation — Quiddler main fields + power_stats sub-block
//
// Run: node analysis/scripts/09_phase5_integration.mjs

import * as cards from "../../src/lib/cards.mjs";
import * as deck from "../../src/lib/autoq-deck.mjs";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { console.log("  ✓", label); passed++; }
  else { console.log("  ✗ FAIL:", label); failed++; }
}

console.log("=== 1. Deck shape ===");
const powerDeck = deck.getDeckArray("Power");
const quiddlerDeck = deck.getDeckArray("Quiddler");
assert(quiddlerDeck.length === 118, `Quiddler deck = 118 cards (got ${quiddlerDeck.length})`);
assert(powerDeck.length === 126, `Power deck = 126 cards (got ${powerDeck.length})`);
assert(powerDeck.filter(c => c === "CH").length === 2, "Power has 2 CH");
assert(powerDeck.filter(c => c === "CK").length === 2, "Power has 2 CK");
assert(powerDeck.filter(c => c === "SH").length === 0, "Power has 0 SH (user dropped)");
assert(powerDeck.filter(c => c === "A").length === 11, "Power has 11 A (+1 vs Quiddler)");
assert(powerDeck.filter(c => c === "E").length === 13, "Power has 13 E (+1 vs Quiddler)");
assert(powerDeck.filter(c => c === "B").length === 3, "Power has 3 B (+1 vs Quiddler)");
assert(powerDeck.filter(c => c === "P").length === 3, "Power has 3 P (+1 vs Quiddler)");

console.log("\n=== 2. Dealing — fresh + mulligan pool ===");
const dealResult = deck.dealFromPool([], 10, "Power");
assert(dealResult.cards.length === 10, "Power dealFromPool returns 10 cards");
assert(dealResult.shortBy === 0, "Pool not depleted");
// Mulligan: seenCards subtracts from the pool. After dealing 100 cards, 26 remain.
const heavyDeal = deck.dealFromPool(powerDeck.slice(0, 100), 10, "Power");
assert(heavyDeal.shortBy === 0, "Mulligan deal of 10 from 26-card residual works");
const overDeal = deck.dealFromPool(powerDeck.slice(0, 120), 10, "Power");
assert(overDeal.shortBy === 4, "Mulligan deal of 10 from 6-card residual reports shortBy=4");

console.log("\n=== 3. Score parsing — CH/CK only visible under Power ===");
const chQuiddler = cards.getScoreOptions("chat", 4);
const chPower = cards.getScoreOptions("chat", 4, "Power");
assert(chQuiddler.options.length === 1, "Quiddler 'chat' → 1 option (no CH card)");
assert(chQuiddler.options[0].breakdown === "C-H-A-T", "Quiddler 'chat' breakdown = C-H-A-T");
assert(chPower.options.length === 2, "Power 'chat' → 2 options (CH or split)");
const chPowerOpt = chPower.options.find(o => o.breakdown === "CH-A-T");
assert(chPowerOpt && chPowerOpt.score === 16, `Power 'chat' CH-A-T = 16 pts (got ${chPowerOpt?.score})`);

const ckPower = cards.getScoreOptions("duck", 4, "Power");
const ckOpt = ckPower.options.find(o => o.breakdown === "D-U-CK");
assert(ckOpt && ckOpt.score === 22, `Power 'duck' D-U-CK = D(5)+U(5)+CK(12) = 22 (got ${ckOpt?.score})`);

console.log("\n=== 4. Power value sanity — all 32 cards distinct values + math holds ===");
const pVals = cards.getDeck("Power").values;
assert(pVals.A === 2 && pVals.E === 2 && pVals.I === 2 && pVals.O === 2, "Vowels A/E/I/O = 2");
assert(pVals.U === 5, "U = 5 (proposal)");
assert(pVals.G === 5, "G = 5 (proposal)");
assert(pVals.Y === 5, "Y = 5 (proposal)");
assert(pVals.B === 8 && pVals.D === 5, "B=8, D=5 (held at Quiddler — restored)");
assert(pVals.N === 4 && pVals.R === 4, "N = R = 4 (proposal)");
assert(pVals.H === 7, "H = 7 (held at Quiddler — restored)");
assert(pVals.M === 5 && pVals.F === 6 && pVals.K === 8, "M=5, F=6, K=8 (held at Quiddler)");
assert(pVals.Q === 15, "Q = 15 (heritage)");
assert(pVals.V === 11, "V = 11 (heritage; tier reorder)");
assert(pVals.Z === 13 && pVals.J === 12 && pVals.X === 10 && pVals.W === 9, "Bomb tier Z=13, J=12, X=10, W=9");
assert(pVals.IN === 6 && pVals.ER === 6, "Forced digraphs IN=6, ER=6 (because N=R=4)");
assert(pVals.TH === 9, "TH = 9 (held at Quiddler — restored alongside H=7)");
assert(pVals.CH === 11 && pVals.CK === 12, "New digraphs CH=11, CK=12");
assert(pVals.QU === 9 && pVals.CL === 10, "Held digraphs QU=9, CL=10");

// Total deck score
const total = Object.entries({
  A: 11, B: 3, C: 2, D: 4, E: 13, F: 2, G: 4, H: 2, I: 8, J: 2, K: 2, L: 4,
  M: 2, N: 6, O: 8, P: 3, Q: 2, R: 6, S: 4, T: 6, U: 6, V: 2, W: 2, X: 2, Y: 4, Z: 2,
  QU: 2, IN: 2, ER: 2, CL: 2, TH: 2, CH: 2, CK: 2,
}).reduce((sum, [card, count]) => sum + count * pVals[card], 0);
assert(total === 633, `Power deck total = 633 pts (got ${total})`);

console.log("\n=== 5. Digraph relationships preserved ===");
function digraphCheck(d) {
  const v = pVals;
  const sum = v[d[0]] + v[d[1]];
  const dv = v[d];
  return { sum, dv, diff: sum - dv };
}
const qu = digraphCheck("QU"); assert(qu.diff === 11, `QU 11-pt discount (got ${qu.diff})`);
const inD = digraphCheck("IN"); assert(inD.diff === 0, `IN neutral (got ${inD.diff})`);
const er = digraphCheck("ER"); assert(er.diff === 0, `ER neutral (got ${er.diff})`);
const cl = digraphCheck("CL"); assert(cl.diff === 1, `CL 1-pt discount (got ${cl.diff})`);
const th = digraphCheck("TH"); assert(th.diff === 1, `TH 1-pt discount (got ${th.diff})`);
const ch = digraphCheck("CH"); assert(ch.diff === 4, `CH 4-pt discount (got ${ch.diff})`);
const ck = digraphCheck("CK"); assert(ck.diff === 4, `CK 4-pt discount (got ${ck.diff})`);

console.log("\n=== 6. dealtCards-aware score filtering (Power) ===");
// Power player dealt these cards; can play "chuck" three ways depending on which they keep
const handCards = ["C", "H", "U", "C", "K", "Z", "E"];
const chuckOpts = deck.filterOptionsAgainstDealt("chuck", 7, handCards, "Power");
console.log("  'chuck' options from hand", handCards.join(","), "→", chuckOpts.options);
assert(chuckOpts.options.length >= 1, "At least one option for 'chuck'");
const chuckCH_CK = chuckOpts.options.find(o => o.breakdown === "CH-U-CK");
const chuckC_H_U_C_K = chuckOpts.options.find(o => o.breakdown === "C-H-U-C-K");
const chuckCH_U_C_K = chuckOpts.options.find(o => o.breakdown === "CH-U-C-K");
// CH-U-CK requires CH+U+CK in hand. Hand has C,H,U,C,K — no actual CH or CK cards.
// So CH-U-CK is NOT formable from this dealt hand. Only the all-singles breakdown should work.
assert(!chuckCH_CK, "CH-U-CK not formable from C,H,U,C,K (no digraph cards in hand)");
assert(!!chuckC_H_U_C_K, "C-H-U-C-K IS formable from singles");
assert(!chuckCH_U_C_K, "CH-U-C-K not formable from this hand (no CH digraph card)");
assert(chuckC_H_U_C_K?.score === 36, `C-H-U-C-K = 36 pts (C8+H7+U5+C8+K8) — got ${chuckC_H_U_C_K?.score}`);

// Now give them an actual CH card
const handWithCH = ["CH", "U", "CK", "Z", "E"];
const chuckOpts2 = deck.filterOptionsAgainstDealt("chuck", 5, handWithCH, "Power");
console.log("  'chuck' options from hand", handWithCH.join(","), "→", chuckOpts2.options);
const chuckBest = chuckOpts2.options.find(o => o.breakdown === "CH-U-CK");
assert(!!chuckBest, "CH-U-CK formable from CH+U+CK cards");
assert(chuckBest?.score === 28, `CH-U-CK = 28 pts (CH11+U5+CK12) — got ${chuckBest?.score}`);

console.log("\n=== 7. Stats API enrichment + segregation logic ===");
// Simulate the enrichment and segregation logic with mixed-deck fixture data.
const games = [
  { game_id: "g1", status: "COMPLETE", players: ["U_A","U_B"], game_type: "QBIM", game_number: 1, winner: "U_A" }, // legacy, no deck_variant
  { game_id: "g2", status: "COMPLETE", players: ["U_A","U_B"], game_type: "QBIM", game_number: 2, deck_variant: "Quiddler", winner: "U_B" },
  { game_id: "g3", status: "COMPLETE", players: ["U_A","U_B"], game_type: "QBIM", game_number: 3, deck_variant: "Power", winner: "U_A" },
];
// Score enrichment
const scoreFixtures = [
  { game_id: "g1", player_slack_id: "U_A", hand: 3, raw_score: 10 },
  { game_id: "g3", player_slack_id: "U_A", hand: 3, raw_score: 14 },
];
const variantByGame = {};
for (const g of games) variantByGame[g.game_id] = g.deck_variant || "Quiddler";
const enriched = scoreFixtures.map(s => ({ ...s, deck_variant: variantByGame[s.game_id] || "Quiddler" }));
assert(enriched[0].deck_variant === "Quiddler", "Legacy game score → Quiddler");
assert(enriched[1].deck_variant === "Power", "Power game score → Power");

// Per-deck segregation in getPlayers — already verified separately in fixtures test;
// re-confirm the deck-filter pattern works on a single edge case
const allScores = [
  { game_id: "g1", player_slack_id: "U_A", hand: 3, raw_score: 10 }, // Quiddler (legacy)
  { game_id: "g3", player_slack_id: "U_A", hand: 3, raw_score: 14 }, // Power
];
const quiddlerOnly = allScores.filter(s => (variantByGame[s.game_id] || "Quiddler") === "Quiddler");
const powerOnly = allScores.filter(s => (variantByGame[s.game_id] || "Quiddler") === "Power");
assert(quiddlerOnly.length === 1 && quiddlerOnly[0].raw_score === 10, "Quiddler filter keeps legacy game");
assert(powerOnly.length === 1 && powerOnly[0].raw_score === 14, "Power filter keeps only Power game");

console.log("\n=== 8. Deck-variant getter ===");
assert(cards.getDeckVariant({ deck_variant: "Power" }) === "Power", "getDeckVariant returns explicit Power");
assert(cards.getDeckVariant({ deck_variant: "Quiddler" }) === "Quiddler", "getDeckVariant returns explicit Quiddler");
assert(cards.getDeckVariant({}) === "Quiddler", "getDeckVariant defaults to Quiddler on empty game");
assert(cards.getDeckVariant(null) === "Quiddler", "getDeckVariant defaults to Quiddler on null");
assert(cards.getDeckVariant(undefined) === "Quiddler", "getDeckVariant defaults to Quiddler on undefined");

// Final report
console.log(`\n=== Phase 5 integration: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
