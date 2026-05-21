/**
 * AutoQ Block Kit UI components.
 */
import { formatDealtCards } from "./autoq-deck.mjs";

// ── Primitives (local copies, same as blocks.mjs) ────

function text(str) {
  return { type: "plain_text", text: str, emoji: true };
}

function option(label, value) {
  return { text: text(label), value };
}

function header(txt) {
  return { type: "header", text: { type: "plain_text", text: txt, emoji: true } };
}

function section(txt) {
  return { type: "section", text: { type: "mrkdwn", text: txt } };
}

function context(texts) {
  return {
    type: "context",
    elements: texts.map((t) => ({ type: "mrkdwn", text: t })),
  };
}

function divider() {
  return { type: "divider" };
}

function actions(elements) {
  return { type: "actions", elements };
}

function button(label, actionId, value) {
  const btn = { type: "button", text: text(label), action_id: actionId };
  if (value) btn.value = value;
  return btn;
}

// ── AutoQ Modals ──────────────────────────────────────

/**
 * Modal to select opponent count (0-7).
 */
export function autoqStartModal({ deckVariant = "Quiddler" } = {}) {
  const options = [];
  for (let i = 0; i <= 7; i++) {
    const label = i === 0 ? "0 (Solo)" : String(i);
    options.push(option(label, String(i)));
  }

  const deckLabel = deckVariant === "Power" ? "Power Deck" : "Standard (Quiddler)";

  return {
    type: "modal",
    callback_id: "autoq_start_submit",
    title: text("AutoQ Setup"),
    submit: text("Start Game"),
    private_metadata: JSON.stringify({ deckVariant }),
    blocks: [
      {
        type: "input",
        block_id: "opponent_count_block",
        label: text("Number of Bot Opponents"),
        element: {
          type: "static_select",
          action_id: "opponent_count",
          initial_option: option("3", "3"),
          options,
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `*Deck:* ${deckLabel}` },
          { type: "mrkdwn", text: "Bots play using historical hand data from real games. Stars require 3+ total players." },
        ],
      },
    ],
  };
}

/**
 * Score entry modal showing dealt cards.
 *
 * `opts`:
 *   - wordsInput:  prefill for the Words Played field
 *   - testResult:  { valid, invalid } from a Test tap; rendered as a context line
 */
export function autoqHandScoreModal(gameId, hand, dealtCards, buttonPressedAt = null, opts = {}) {
  const { wordsInput = "", testResult = null, deckVariant = "Quiddler" } = opts;
  const cardsDisplay = formatDealtCards(dealtCards, deckVariant);

  const wordsField = {
    type: "plain_text_input",
    action_id: "words",
    placeholder: text("e.g. quiz or qu-i-z"),
  };
  if (wordsInput) wordsField.initial_value = wordsInput;

  const ctxJson = JSON.stringify({ game_id: gameId, hand, dealt_cards: dealtCards, button_pressed_at: buttonPressedAt });

  const modalBlocks = [
    section(`*Your cards:*  ${cardsDisplay}`),
    {
      type: "input",
      block_id: "words_block",
      label: text("Words Played (leave blank if no words)"),
      optional: true,
      element: wordsField,
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "Use hyphens to specify cards (e.g. qu-i-z). Tap *Test* to dictionary-check without submitting." },
      ],
    },
    {
      type: "actions",
      elements: [{
        type: "button",
        action_id: "autoq_check_words",
        text: text("Test"),
        value: ctxJson,
      }],
    },
  ];

  if (testResult) {
    const okLine = testResult.valid.length ? `✅ ${testResult.valid.map((v) => v.word).join(", ")}` : "";
    const badLine = testResult.invalid.length ? `❌ ${testResult.invalid.map((v) => v.word).join(", ")}` : "";
    const line = [okLine, badLine].filter(Boolean).join("    ") || "_(nothing to check)_";
    modalBlocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: line }],
    });
  }

  return {
    type: "modal",
    callback_id: "autoq_submit_score",
    private_metadata: JSON.stringify({ game_id: gameId, hand, dealt_cards: dealtCards, button_pressed_at: buttonPressedAt }),
    title: text(`AutoQ Hand ${hand}`),
    submit: text("Submit"),
    blocks: modalBlocks,
  };
}

/**
 * Score choice modal for digraph disambiguation — with dealt cards context.
 */
export function autoqScoreChoiceModal(gameId, hand, words, options, dealtCards, buttonPressedAt = null, deckVariant = "Quiddler") {
  const cardsDisplay = formatDealtCards(dealtCards, deckVariant);
  const radioOptions = options.map((opt) => ({
    text: { type: "mrkdwn", text: `*${opt.score} pts* — ${opt.breakdown} (${opt.cards} cards)` },
    value: JSON.stringify({ score: opt.score, cards: opt.cards, breakdown: opt.breakdown }),
  }));

  return {
    type: "modal",
    callback_id: "autoq_confirm_score",
    private_metadata: JSON.stringify({ game_id: gameId, hand, words, dealt_cards: dealtCards, button_pressed_at: buttonPressedAt }),
    title: text(`AutoQ H${hand} — Pick Score`),
    submit: text("Confirm"),
    blocks: [
      section(`*Your cards:*  ${cardsDisplay}`),
      section(`Your words: *${words}*\n\nWhich cards did you play?`),
      {
        type: "input",
        block_id: "score_choice_block",
        label: text("Score"),
        element: {
          type: "radio_buttons",
          action_id: "score_choice",
          initial_option: radioOptions[0],
          options: radioOptions,
        },
      },
    ],
  };
}

// ── AutoQ Home Tab Blocks ─────────────────────────────

/**
 * Build blocks for an active AutoQ game on the home tab.
 * Returns an array of Block Kit blocks to append.
 */
export function autoqHomeActive(game, currentHand, handResults, personalBests) {
  const blks = [
    divider(),
    header(`🎲 AutoQ Game`),
  ];

  // Bot roster
  const botNames = game.bot_names || [];
  if (botNames.length > 0) {
    blks.push(context([`Opponents: ${botNames.join(", ")}`]));
  } else {
    blks.push(context(["Solo mode — no opponents"]));
  }

  // Completed hand results
  if (handResults && handResults.length > 0) {
    for (const hr of handResults) {
      const pbNote = hr.is_personal_best ? " 🏆 *New PB!*" : "";
      const playerWords = hr.words ? hr.words.toLowerCase().replace(/[\s,+]+/g, " ").trim() : "(no words)";
      let line = `*Hand ${hr.hand}:* ${playerWords} — *${hr.raw_score} pts*${pbNote}`;
      if (hr.stars > 0) line += ` ${"★".repeat(hr.stars)}`;

      // Bot scores
      if (hr.bot_scores && hr.bot_scores.length > 0) {
        const botLines = hr.bot_scores.map((b) =>
          `  ${b.name}: ${b.words ? b.words.toLowerCase().replace(/[\s,+]+/g, " ").trim() : "(no words)"} — ${b.raw_score} pts${b.stars > 0 ? " " + "★".repeat(b.stars) : ""}`
        );
        line += "\n" + botLines.join("\n");
      }

      if (hr.star_summary) {
        line += `\n_${hr.star_summary}_`;
      }

      blks.push(section(line));
    }
  }

  // Current hand prompt
  if (currentHand && currentHand <= 10) {
    const dealtCards = game.dealt_hands?.[String(currentHand)]?.[0]; // player is index 0
    if (dealtCards) {
      const cardsDisplay = formatDealtCards(dealtCards, game.deck_variant || "Quiddler");
      blks.push(divider());
      blks.push(section(`*Hand ${currentHand}* — Your cards: ${cardsDisplay}`));

      const mulligans = game.mulligans?.[String(currentHand)] || 0;
      const mulliganNote = mulligans > 0
        ? `${mulligans} mulligan${mulligans > 1 ? "s" : ""} — ${dealtCards.length} cards`
        : "";

      const btns = [
        button(`Enter Hand ${currentHand} Score`, "autoq_open_hand_modal", `${game.game_id}|${currentHand}`),
      ];
      // Only show Mulligan if we'd still have ≥2 cards after dropping one
      // (words require at least 2 cards).
      if (dealtCards.length > 2) {
        btns.push(button("Mulligan", "autoq_mulligan", `${game.game_id}|${currentHand}`));
      }
      btns.push(button("Quit", "autoq_quit", game.game_id));

      blks.push(actions(btns));
      if (mulliganNote) {
        blks.push(context([mulliganNote]));
      }
    }
  }

  return blks;
}

/**
 * Build blocks for a completed AutoQ game.
 */
export function autoqGameComplete(game, standings, personalBests) {
  const blks = [
    divider(),
    header("🏆 AutoQ Complete!"),
  ];

  // Final standings
  const medals = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];
  const lines = standings.map((s, i) => {
    const prefix = i < 3 ? `${medals[i]} ` : `${i + 1}. `;
    const starStr = s.stars > 0 ? ` ${"★".repeat(s.stars)}` : "";
    return `${prefix}*${s.name}* — ${s.raw} pts${starStr}${s.stars > 0 ? ` (+${s.stars * 10} bonus = *${s.raw + s.stars * 10}*)` : ""}`;
  });
  blks.push(section(lines.join("\n")));

  // Personal bests
  if (personalBests && personalBests.length > 0) {
    const pbLines = personalBests
      .filter((pb) => pb.is_new)
      .map((pb) => `🏆 *Hand ${pb.hand}*: ${pb.score} pts`);
    if (pbLines.length > 0) {
      blks.push(divider());
      blks.push(section("*New Personal Bests!*\n" + pbLines.join("\n")));
    }
  }

  blks.push(divider());
  blks.push(actions([button("Start New Game", "qbim_start_game")]));

  return blks;
}
