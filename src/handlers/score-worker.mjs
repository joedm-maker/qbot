/**
 * Score Worker Lambda — async worker invoked by score-entry.mjs after
 * the user submits (via Lambda.invoke InvocationType: "Event").
 *
 * Does the slow work off the hot path so the Slack modal can close
 * immediately:
 *   1. Validate words against MW (+cache + house rules)
 *   2. If valid → call saveScore() which does the DB write + home refresh
 *   3. If invalid → DM the user with the rejected words and a button
 *      to reopen the score modal with the original words pre-filled.
 */
import { validateWords } from "../lib/dictionary.mjs";
import { saveScore } from "./score-entry.mjs";
import { dmUser } from "../lib/slack.mjs";

export async function handler(event) {
  try {
    const { userId, game_id, hand, wordsInput, chosen, buttonPressedAt } = event;

    // Dictionary validation
    const { invalid } = await validateWords(wordsInput || "");
    if (invalid.length) {
      const bad = invalid.map((w) => `*${w.word}*`).join(", ");
      const s = invalid.length > 1 ? "s" : "";
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
                action_id: "qbim_retry_hand",
                style: "primary",
                value: JSON.stringify({ game_id, hand, words: wordsInput || "" }),
              },
            ],
          },
        ],
      });
      return { ok: false, reason: "invalid_words" };
    }

    // Valid — do the save (writes score, fires stars, refreshes home)
    await saveScore(userId, game_id, hand, wordsInput || "", chosen, buttonPressedAt);
    return { ok: true };
  } catch (err) {
    console.error("score-worker error:", err);
    try {
      await dmUser(event.userId, { text: `Something went wrong saving Hand ${event.hand}. Please try again.` });
    } catch { /* ignore */ }
    return { ok: false, error: err.message };
  }
}
