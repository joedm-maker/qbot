/**
 * Score Worker Lambda — async worker invoked after the user submits
 * (via Lambda.invoke InvocationType: "Event"). Handles both regular
 * multi-player games and AutoQ submissions.
 *
 * Flow:
 *   1. Validate words against MW (+cache + house rules)
 *   2. If valid → call the appropriate save function (saveScore / saveAutoQScore)
 *   3. If invalid → DM the user with the rejected words and a button
 *      to reopen the score modal pre-filled with their original input.
 *
 * Payload shape:
 *   { mode: "regular" | "autoq", userId, game_id, hand, wordsInput, chosen,
 *     buttonPressedAt?, dealtCards? }
 */
import { validateWords } from "../lib/dictionary.mjs";
import { saveScore } from "./score-entry.mjs";
import { saveAutoQScore } from "./autoq.mjs";
import { renderHome } from "../lib/home.mjs";
import { dmUser } from "../lib/slack.mjs";

export async function handler(event) {
  try {
    const {
      mode = "regular",
      userId, game_id, hand, wordsInput, chosen,
      buttonPressedAt, dealtCards, validated,
    } = event;

    // Dictionary validation — skip if already validated by the caller
    const { invalid } = validated ? { invalid: [] } : await validateWords(wordsInput || "");
    if (invalid.length) {
      const bad = invalid.map((w) => `*${w.word}*`).join(", ");
      await dmUser(userId, {
        text: `Hand ${hand} submission rejected.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hand ${hand} rejected — not in the dictionary: ${bad}.`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: `Edit Hand ${hand}`, emoji: true },
                action_id: mode === "autoq" ? "autoq_retry_hand" : "qbim_retry_hand",
                style: "primary",
                value: JSON.stringify({
                  game_id,
                  hand,
                  words: wordsInput || "",
                  ...(mode === "autoq" && dealtCards ? { dealt_cards: dealtCards } : {}),
                }),
              },
            ],
          },
        ],
      });
      return { ok: false, reason: "invalid_words" };
    }

    // Valid — save via the appropriate path
    if (mode === "autoq") {
      await saveAutoQScore(userId, game_id, hand, wordsInput || "", chosen, dealtCards);
      await renderHome(userId);
    } else {
      await saveScore(userId, game_id, hand, wordsInput || "", chosen, buttonPressedAt);
    }
    return { ok: true };
  } catch (err) {
    console.error("score-worker error:", err);
    try {
      await dmUser(event.userId, { text: `Something went wrong saving Hand ${event.hand}. Please try again.` });
    } catch { /* ignore */ }
    return { ok: false, error: err.message };
  }
}
