/**
 * Normalize a workout JSON file into a payload Garmin's
 * POST /workout-service/workout endpoint will accept as a brand-new workout.
 *
 * Files exported from Garmin (or produced by other tools) carry server-managed
 * fields — workoutId, ownerId, timestamps, author, estimates — that must be
 * stripped, and every step keeps a real stepId that has to be cleared so Garmin
 * assigns fresh ones. This mirrors the approach used by D43.GarminConnect.Scheduler.
 */

export interface GarminWorkoutPayload {
  workoutName: string;
  [key: string]: unknown;
}

// Top-level, server-managed fields that must not be sent when creating a workout.
const STRIP_PROPS = [
  'workoutId',
  'ownerId',
  'updatedDate',
  'createdDate',
  'author',
  'estimatedDurationInSecs',
  'estimatedDistanceInMeters',
  'workoutProvider',
  'workoutSourceId',
  'consumer',
  'consumerName',
  'consumerImageURL',
  'consumerWebsiteURL',
  'estimateType',
  'estimatedDistanceUnit',
];

/** Recursively null out every `stepId` so Garmin assigns fresh ones on create. */
function clearStepIds(steps: unknown): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (step && typeof step === 'object') {
      const s = step as Record<string, unknown>;
      s.stepId = null;
      // RepeatGroupDTO steps nest their children under workoutSteps.
      if (Array.isArray(s.workoutSteps)) clearStepIds(s.workoutSteps);
    }
  }
}

/** Validate and normalize parsed workout JSON into a create-ready payload. */
export function normalizeWorkoutJson(parsed: unknown): GarminWorkoutPayload {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The JSON file does not contain a workout object.');
  }
  const workout = { ...(parsed as Record<string, unknown>) };

  if (!Array.isArray(workout.workoutSegments)) {
    throw new Error('Not a Garmin workout JSON file (missing workoutSegments).');
  }

  for (const prop of STRIP_PROPS) delete workout[prop];

  for (const segment of workout.workoutSegments as Array<Record<string, unknown>>) {
    if (segment && Array.isArray(segment.workoutSteps)) clearStepIds(segment.workoutSteps);
  }

  if (typeof workout.workoutName !== 'string' || !workout.workoutName.trim()) {
    workout.workoutName = 'Imported workout';
  }

  return workout as GarminWorkoutPayload;
}
