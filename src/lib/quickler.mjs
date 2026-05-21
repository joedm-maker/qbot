import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from "@aws-sdk/client-scheduler";

const scheduler = new SchedulerClient({});

/**
 * Create a one-shot EventBridge schedule that fires 30 seconds from now.
 * Invokes the QuicklerTimerFunction Lambda with { game_id, hand }.
 */
export async function createQuicklerTimer(scheduleName, gameId, hand) {
  const fireAt = new Date(Date.now() + 30_000);
  // EventBridge Scheduler requires ISO 8601 without milliseconds
  const scheduleExpression = `at(${fireAt.toISOString().replace(/\.\d{3}Z$/, "")})`;

  await scheduler.send(new CreateScheduleCommand({
    Name: scheduleName,
    ScheduleExpression: scheduleExpression,
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: process.env.QUICKLER_TIMER_FUNCTION_ARN,
      RoleArn: process.env.QUICKLER_TIMER_ROLE_ARN,
      Input: JSON.stringify({ game_id: gameId, hand }),
    },
    ActionAfterCompletion: "DELETE",
  }));
}

/**
 * Delete a pending Quickler timer schedule (e.g. when all players submit before expiry).
 */
export async function deleteQuicklerTimer(scheduleName) {
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName }));
  } catch (err) {
    // Schedule may have already fired and auto-deleted
    if (err.name !== "ResourceNotFoundException") throw err;
  }
}
