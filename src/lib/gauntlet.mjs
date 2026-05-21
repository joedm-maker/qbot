import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from "@aws-sdk/client-scheduler";

const scheduler = new SchedulerClient({});

/**
 * Create a one-shot EventBridge schedule that fires 60 seconds from now.
 * Invokes the GauntletTimerFunction Lambda with { game_id }. Used when
 * the first player finishes all 8 hands — gives others 60s to wrap up
 * before any unsubmitted hands get auto-zeroed and the game finalizes.
 */
export async function createGauntletTimer(scheduleName, gameId) {
  const fireAt = new Date(Date.now() + 60_000);
  const scheduleExpression = `at(${fireAt.toISOString().replace(/\.\d{3}Z$/, "")})`;

  await scheduler.send(new CreateScheduleCommand({
    Name: scheduleName,
    ScheduleExpression: scheduleExpression,
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: process.env.GAUNTLET_TIMER_FUNCTION_ARN,
      RoleArn: process.env.GAUNTLET_TIMER_ROLE_ARN,
      Input: JSON.stringify({ game_id: gameId }),
    },
    ActionAfterCompletion: "DELETE",
  }));
}

export async function deleteGauntletTimer(scheduleName) {
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName }));
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }
}
