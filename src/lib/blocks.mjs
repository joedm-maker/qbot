import { getHandRange } from "./cards.mjs";

// ── Block Kit helpers ───────────────────────────────────

/**
 * Home tab when no game exists today.
 */
export function homeNoGame() {
  return {
    type: "home",
    blocks: [
      header("🎴 QBIM"),
      section("No game today yet."),
      actions([button("Start Game", "qbim_start_game")]),
    ],
  };
}

/**
 * Home tab when a game is OPEN (lobby).
 */
export function homeLobby(game, playerNames, userInGame) {
  const roster = playerNames.length
    ? playerNames.map((n) => `• ${n}`).join("\n")
    : "_No players yet_";

  const blks = [
    header(`🎮 Game #${game.game_number} — ${game.game_type}`),
    context([`Started by <@${game.host_slack_id}>`]),
    divider(),
    section(`*Players:*\n${roster}`),
  ];

  if (userInGame) {
    blks.push(
      actions([button("Enter Hand 3 Score", "qbim_open_hand_modal", `${game.game_id}|3`)])
    );
  } else {
    blks.push(actions([button("Play", "qbim_join_game", game.game_id)]));
  }

  // Empty score table
  blks.push(divider());
  blks.push(header("📊 Scoreboard"));
  const hands = getHandRange(game.game_type);
  const handLabels = hands.map((h) => `H${h}`).join("  |  ");
  const emptyScores = hands.map(() => "·").join("    |    ");
  for (const name of playerNames) {
    blks.push(section(`*${name}*\n${handLabels}\n${emptyScores}`));
  }

  return { type: "home", blocks: blks };
}

/**
 * Home tab when game is ACTIVE — shows current hand prompt + full score grid.
 */
export function homeActive(game, playerNames, round, totals, rawScores, viewerId, showOwnScore, missingNames) {
  const blks = [
    header(`🎮 Game #${game.game_number} — ${game.game_type}`),
    context(["_In Progress_"]),
    divider(),
  ];

  if (round && round.hand) {
    const mulliganNote = round.mulligans > 0
      ? ` (${round.mulligans} mulligan${round.mulligans > 1 ? "s" : ""} — max ${round.maxCards} cards)`
      : "";
    if (round.canSubmit) {
      const btns = [
        button(`Enter Hand ${round.hand} Score`, "qbim_open_hand_modal", `${game.game_id}|${round.hand}`),
        button("Mulligan", "qbim_mulligan", `${game.game_id}|${round.hand}`),
      ];
      blks.push(
        section(`✏️ Enter your score for *Hand ${round.hand}*${mulliganNote}`),
        actions(btns)
      );
    } else {
      const myLine = round.myWords
        ? `✅ You submitted: *${round.myWords}* (${round.myScore} pts)${mulliganNote}`
        : `⏳ Waiting for other players to finish *Hand ${round.hand}*...`;
      blks.push(section(myLine));
      if (missingNames && missingNames.length > 0) {
        blks.push(context([`⏳ Waiting on: ${missingNames.join(", ")}`]));
      }
      blks.push(actions([button(`Edit Hand ${round.hand}`, "qbim_open_hand_modal", `${game.game_id}|${round.hand}`)]));
    }
  } else {
    blks.push(section("✅ All hands complete!"));
  }

  // Scoreboard
  if (rawScores && rawScores.length) {
    blks.push(divider());
    blks.push(header("📊 Scoreboard"));
    blks.push(...buildScoreboard(game.players, playerNames, rawScores, totals, viewerId, showOwnScore));
  }

  // Toggle + End Game buttons
  blks.push(divider());
  const toggleLabel = showOwnScore ? "Hide My Total" : "Show My Total";
  blks.push(actions([
    button(toggleLabel, "qbim_toggle_score", game.game_id),
    button("End Game", "qbim_end_game", game.game_id),
  ]));

  return { type: "home", blocks: blks };
}

/**
 * Build scoreboard blocks — one section per player with hand-by-hand detail.
 * @param {string} viewerId — the user viewing the scoreboard
 * @param {boolean} showOwnScore — whether the viewer has opted to see their total
 * Returns an array of Block Kit blocks.
 */
function buildScoreboard(playerIds, playerNames, rawScores, totals, viewerId, showOwnScore) {
  // Build lookup: byPlayer[id][hand] = score record
  const byPlayer = new Map();
  for (const s of rawScores) {
    if (!byPlayer.has(s.player_slack_id)) byPlayer.set(s.player_slack_id, new Map());
    byPlayer.get(s.player_slack_id).set(s.hand, s);
  }

  // All hands that have been played
  const allHands = [...new Set(rawScores.map((s) => s.hand))].sort((a, b) => a - b);

  const blks = [];

  // Don't sort by score (totals hidden) — show in player order
  for (const pid of playerIds) {
    const t = totals.get(pid) || { raw: 0, stars: 0 };
    const name = playerNames.get(pid) || pid;
    const starStr = t.stars > 0 ? `  ${"★".repeat(t.stars)}` : "";

    // Show total only for the viewer if they opted in
    const isViewer = pid === viewerId;
    const totalStr = (isViewer && showOwnScore) ? ` — *${t.raw + t.stars * 10} pts*` : "";

    let header = `*${name}*${totalStr}${starStr}`;

    // Hand scores as a compact line
    const handParts = allHands.map((h) => {
      const s = byPlayer.get(pid)?.get(h);
      if (!s) return `~${h}~`;
      const star = (s.stars || 0) > 0 ? "★".repeat(s.stars) : "";
      return `${s.raw_score}${star}`;
    });

    if (handParts.length) {
      const handLabels = allHands.map((h) => `H${h}`);
      header += `\n${handLabels.join("  |  ")}\n${handParts.join("  |  ")}`;
    }

    blks.push(section(header));
  }

  return blks;
}

/**
 * Home tab review screen — shown after Hand 10 before game is finalized.
 * Shows full scoreboard with all hands + Finalize button.
 */
export function homeReview(game, playerNames, allScores, totals, viewerId, showOwnScore) {
  const blks = [
    header(`🎮 Game #${game.game_number} — ${game.game_type}`),
    context(["✅ All hands complete — review scores before finalizing"]),
    divider(),
  ];

  // Full scoreboard
  blks.push(header("📊 Scoreboard"));
  blks.push(...buildScoreboard(game.players, playerNames, allScores, totals, viewerId, showOwnScore));

  // Finalize button
  blks.push(divider());
  blks.push(actions([button("Finalize Game", "qbim_finalize_game", game.game_id)]));

  return { type: "home", blocks: blks };
}

/**
 * Home tab when game is COMPLETE.
 * @param {Array} rawScores — full score records (for scoreboard display)
 */
export function homeComplete(game, totals, playerNames, rawScores) {
  const blks = [
    header(`🏆 Game #${game.game_number} — ${game.game_type} — Complete`),
    divider(),
    header("📋 Final Leaderboard"),
    leaderboardTable(totals, playerNames, true),
  ];

  // Show full score table if rawScores provided
  if (rawScores && rawScores.length) {
    blks.push(divider());
    blks.push(header("📊 Scoreboard"));
    // Show all totals since game is over — no hiding
    blks.push(...buildScoreboard(game.players, playerNames, rawScores, totals, null, false));
  }

  blks.push(divider());
  blks.push(section("Start a new game whenever you're ready!"));
  blks.push(actions([button("Start Game", "qbim_start_game")]));
  return { type: "home", blocks: blks };
}

/**
 * Start-game modal with game type selector.
 */
export function startGameModal() {
  return {
    type: "modal",
    callback_id: "qbim_start_game_submit",
    title: text("Start a Game"),
    submit: text("Confirm"),
    blocks: [
      {
        type: "input",
        block_id: "game_type_block",
        label: text("Game Type"),
        element: {
          type: "static_select",
          action_id: "game_type",
          initial_option: option("QBIM", "QBIM"),
          options: [option("QBIM", "QBIM"), option("Quickler", "Quickler")],
        },
      },
    ],
  };
}

/**
 * End game confirmation modal.
 */
export function endGameModal(gameId) {
  return {
    type: "modal",
    callback_id: "qbim_end_game_confirm",
    private_metadata: JSON.stringify({ game_id: gameId }),
    title: text("End Game"),
    submit: text("Confirm"),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Are you sure?" },
      },
      {
        type: "input",
        block_id: "end_game_choice_block",
        label: text("What would you like to do?"),
        element: {
          type: "radio_buttons",
          action_id: "end_game_choice",
          initial_option: {
            text: text("Stay — Keep playing"),
            value: "stay",
          },
          options: [
            { text: text("Stay — Keep playing"), value: "stay" },
            { text: text("Drop — Leave the game (others continue)"), value: "drop" },
            { text: text("Finish — End the game for everyone"), value: "finish" },
          ],
        },
      },
    ],
  };
}

/**
 * Hand score entry modal.
 */
export function handScoreModal(gameId, hand) {
  return {
    type: "modal",
    callback_id: "qbim_submit_score",
    private_metadata: JSON.stringify({ game_id: gameId, hand }),
    title: text(`Hand ${hand}`),
    submit: text("Submit"),
    blocks: [
      {
        type: "input",
        block_id: "words_block",
        label: text("Words Played"),
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "words",
          placeholder: text("e.g. quiz or qu-i-z (leave blank if no words)"),
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "Score is calculated automatically from your cards. Use hyphens to show individual cards (e.g. qu-i-z) or just type the word." },
        ],
      },
    ],
  };
}

/**
 * Score choice modal — shown when multiple score interpretations exist.
 * E.g. "quiz" could be QU-I-Z (25 pts) or Q-U-I-Z (35 pts).
 */
export function scoreChoiceModal(gameId, hand, words, options) {
  const radioOptions = options.map((opt) => ({
    text: { type: "mrkdwn", text: `*${opt.score} pts* — ${opt.breakdown} (${opt.cards} cards)` },
    value: JSON.stringify({ score: opt.score, cards: opt.cards, breakdown: opt.breakdown }),
  }));

  return {
    type: "modal",
    callback_id: "qbim_confirm_score",
    private_metadata: JSON.stringify({ game_id: gameId, hand, words }),
    title: text(`Hand ${hand} — Pick Score`),
    submit: text("Confirm"),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Your words: *${words}*\n\nWhich cards did you play?` },
      },
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

/**
 * Star award modal for a specific hand.
 */
export function awardStarsModal(gameId, hand, playerOptions) {
  const noneOpt = option("None", "none");
  const opts = [noneOpt, ...playerOptions];

  return {
    type: "modal",
    callback_id: "qbim_submit_stars",
    private_metadata: JSON.stringify({ game_id: gameId, hand }),
    title: text(`Stars — Hand ${hand}`),
    submit: text("Award Stars"),
    blocks: [
      {
        type: "input",
        block_id: "longest_word_block",
        label: text("Longest Word"),
        element: {
          type: "static_select",
          action_id: "longest_word_player",
          options: opts,
        },
      },
      {
        type: "input",
        block_id: "most_words_block",
        label: text("Most Words"),
        element: {
          type: "static_select",
          action_id: "most_words_player",
          options: opts,
        },
      },
    ],
  };
}

/**
 * Lobby channel message.
 */
export function lobbyMessage(game, playerNames) {
  const roster = playerNames.map((n) => `• ${n}`).join("\n");
  return [
    section(`*Game #${game.game_number}* — ${game.game_type}\n<@${game.host_slack_id}> started a game! Open the QBot Home tab to join.`),
    divider(),
    section(`*Players:*\n${roster}`),
  ];
}

/**
 * Final leaderboard channel message.
 */
export function finalLeaderboardBlocks(standings) {
  const medals = ["first_place_medal", "second_place_medal", "third_place_medal"];
  const lines = standings.map((s, i) => {
    const prefix = i < 3 ? `:${medals[i]}: ` : `${i + 1}. `;
    return `${prefix}*${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars}) | Bonus: +${s.stars * 10} | *Final: ${s.final}*`;
  });
  return [section(lines.join("\n"))];
}

// ── Leaderboard table ──────────────────────────────────

function leaderboardTable(scores, playerNames, includeFinal) {
  // scores is Map<slackId, { raw, stars }>
  const standings = [...scores.entries()]
    .map(([id, s]) => ({
      name: playerNames.get(id) || id,
      raw: s.raw,
      stars: s.stars,
      final: s.raw + s.stars * 10,
    }))
    .sort((a, b) => (includeFinal ? b.final - a.final : b.raw - a.raw));

  const lines = standings.map((s) => {
    if (includeFinal) {
      return `• *${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars}) | +${s.stars * 10} | *Final: ${s.final}*`;
    }
    return `• *${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars})`;
  });

  return section(lines.join("\n"));
}

// ── Admin Edit Modal ────────────────────────────────────

/**
 * Admin picker modal — select a player and hand to edit.
 */
export function adminPickerModal(gameId, playerOptions, handOptions) {
  return {
    type: "modal",
    callback_id: "qbim_admin_pick_edit",
    private_metadata: JSON.stringify({ game_id: gameId }),
    title: text("Edit Score"),
    submit: text("Next"),
    blocks: [
      {
        type: "input",
        block_id: "player_block",
        label: text("Player"),
        element: {
          type: "static_select",
          action_id: "player_select",
          options: playerOptions,
        },
      },
      {
        type: "input",
        block_id: "hand_block",
        label: text("Hand"),
        element: {
          type: "static_select",
          action_id: "hand_select",
          options: handOptions,
        },
      },
    ],
  };
}

export function adminEditModal(gameId, playerId, playerName, hand, currentWords, currentMulligans) {
  return {
    type: "modal",
    callback_id: "qbim_admin_save_edit",
    private_metadata: JSON.stringify({ game_id: gameId, player_id: playerId, hand }),
    title: text(`Edit ${playerName} H${hand}`),
    submit: text("Save"),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Editing *${playerName}*'s words for *Hand ${hand}*` },
      },
      {
        type: "input",
        block_id: "words_block",
        label: text("Words Played"),
        element: {
          type: "plain_text_input",
          action_id: "words",
          initial_value: currentWords || "",
          placeholder: text("e.g. quiz or qu-i-z"),
        },
      },
      {
        type: "input",
        block_id: "mulligans_block",
        label: text("Mulligans"),
        optional: true,
        element: {
          type: "number_input",
          action_id: "mulligans",
          is_decimal_allowed: false,
          min_value: "0",
          max_value: String(hand - 1),
          initial_value: String(currentMulligans || 0),
          placeholder: text("0"),
        },
      },
    ],
  };
}

// ── Player Card ─────────────────────────────────────────

/**
 * Build a player stats card from their DynamoDB player record.
 * Returns an array of Block Kit blocks.
 */
export function playerCard(player) {
  if (!player || !player.games_played) return [];

  const name = player.display_name || "Player";
  const gp = player.games_played || 0;
  const wins = player.all_time_wins || 0;
  const losses = gp - wins;
  const wpct = player.win_pct != null ? player.win_pct : (gp > 0 ? (wins / gp * 100) : 0);
  const avg = player.avg_game_total != null ? player.avg_game_total : 0;
  const high = player.highest_game_total || "—";
  const low = player.lowest_game_total || "—";
  const highHand = player.highest_hand_score || "—";
  const stars = player.all_time_stars || 0;
  const spg = player.stars_per_game != null ? player.stars_per_game : 0;
  const hw = player.hands_won || 0;
  const screwed = player.times_hand_screwed || 0;
  const screwedOthers = player.times_screwed_others || 0;
  const bh = player.best_hand;

  return [
    divider(),
    header(`📋 ${name}'s Stats`),
    section(`*${wins}W – ${losses}L* (${typeof wpct === "number" ? wpct.toFixed(1) : wpct}%)  •  ${gp} games`),
    sectionWithFields([
      `*Avg Total*\n${typeof avg === "number" ? avg.toFixed(1) : avg}`,
      `*Range*\n${low} – ${high}`,
      `*Highest Hand*\n${highHand}`,
      `*Hands Won*\n${hw}`,
      `*Stars*\n${stars} (${typeof spg === "number" ? spg.toFixed(2) : spg}/g)`,
      `*Mulligans*\n${player.all_time_mulligans || 0}`,
      `*😤 Screwed*\n${screwed}`,
      `*😈 Villain*\n${screwedOthers}`,
    ]),
    ...(bh ? [context([`🎯 Best hand: H${bh.hand} (${bh.wins} wins, avg ${bh.avg})`])] : []),
    ...(player.incomplete_games ? [context([`⚠️ ${player.incomplete_games} incomplete game${player.incomplete_games > 1 ? "s" : ""}`])] : []),
  ];
}

// ── Admin Guest Join Modal ──────────────────────────────

export function adminGuestJoinModal(gameId) {
  return {
    type: "modal",
    callback_id: "qbim_admin_guest_join_submit",
    private_metadata: JSON.stringify({ game_id: gameId }),
    title: text("Join as Guest"),
    submit: text("Join"),
    blocks: [
      {
        type: "input",
        block_id: "guest_name_block",
        label: text("Guest Name"),
        element: {
          type: "plain_text_input",
          action_id: "guest_name",
          placeholder: text("e.g. Mom, Uncle Bob"),
        },
      },
    ],
  };
}

// ── Primitives ─────────────────────────────────────────

function header(txt) {
  return { type: "header", text: { type: "plain_text", text: txt, emoji: true } };
}

function section(txt) {
  return { type: "section", text: { type: "mrkdwn", text: txt } };
}

function sectionWithFields(fieldPairs) {
  return {
    type: "section",
    fields: fieldPairs.map((f) => ({ type: "mrkdwn", text: f })),
  };
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
  const btn = {
    type: "button",
    text: text(label),
    action_id: actionId,
  };
  if (value) btn.value = value;
  return btn;
}

function text(str) {
  return { type: "plain_text", text: str, emoji: true };
}

function option(label, value) {
  return { text: text(label), value };
}
