import { WebClient } from "@slack/web-api";

let _client;
export function slack() {
  if (!_client) _client = new WebClient(process.env.SLACK_BOT_TOKEN);
  return _client;
}

/** Replace the Slack client with a mock (for testing). */
export function setMockClient(mock) {
  _client = mock;
}

export const CHANNEL = () => process.env.SLACK_CHANNEL_ID;

/**
 * Send a DM to a user via the bot's Messages tab.
 * Opens a conversation if needed, then posts the message.
 */
export async function dmUser(userId, { text, blocks }) {
  const client = slack();
  const { channel } = await client.conversations.open({ users: userId });
  return client.chat.postMessage({ channel: channel.id, text, blocks });
}

/**
 * Send a DM to every player in a game.
 */
export async function dmAllPlayers(playerIds, { text, blocks }) {
  for (const pid of playerIds) {
    await dmUser(pid, { text, blocks });
  }
}
