/**
 * Bulk operations over a selection of workouts.
 *
 * Everything runs one workout at a time on purpose: these hit the same gc-api
 * the web app uses, and firing fifty parallel deletes at it is a good way to
 * get throttled. A failure never aborts the run — each one is collected so the
 * UI can say exactly which workouts were left behind.
 */

import { downloadJson, downloadText, fileStem } from './download';
import { deleteWorkout, getWorkoutDetail, type WorkoutSummary } from './garmin-api';
import { canExportZwo, garminToZwo } from './zwo-export';

export type ExportFormat = 'json' | 'zwo';

/** A workout that did not make it through, with the reason why. */
export interface BulkNote {
  name: string;
  message: string;
}

export interface BulkResult {
  succeeded: number;
  failed: BulkNote[];
  /** Workouts deliberately not attempted — e.g. a run when exporting ZWO. */
  skipped: BulkNote[];
  /** De-duplicated fidelity warnings from the ZWO conversion. */
  warnings: string[];
}

function emptyResult(): BulkResult {
  return { succeeded: 0, failed: [], skipped: [], warnings: [] };
}

/**
 * Two workouts can share a name; give the second one a `-2` so the browser does
 * not silently rename or overwrite the first download.
 */
function uniqueStem(stem: string, used: Set<string>): string {
  let candidate = stem;
  for (let n = 2; used.has(candidate); n++) candidate = `${stem}-${n}`;
  used.add(candidate);
  return candidate;
}

/** Delete every selected workout, reporting progress after each attempt. */
export async function bulkDelete(
  items: WorkoutSummary[],
  onProgress: (done: number) => void,
): Promise<BulkResult> {
  const result = emptyResult();
  for (const [index, workout] of items.entries()) {
    try {
      await deleteWorkout(workout.workoutId);
      result.succeeded++;
    } catch (err) {
      result.failed.push({ name: workout.workoutName, message: (err as Error).message });
    }
    onProgress(index + 1);
  }
  return result;
}

/**
 * Download every selected workout as its own file. Each one needs a detail
 * fetch, since the list only carries summaries. `ftp` is only read for ZWO.
 */
export async function bulkExport(
  items: WorkoutSummary[],
  format: ExportFormat,
  ftp: number,
  onProgress: (done: number) => void,
): Promise<BulkResult> {
  const result = emptyResult();
  const usedStems = new Set<string>();
  const seenWarnings = new Set<string>();

  for (const [index, workout] of items.entries()) {
    if (format === 'zwo' && !canExportZwo(workout.sportType?.sportTypeKey)) {
      result.skipped.push({ name: workout.workoutName, message: 'not a cycling workout' });
      onProgress(index + 1);
      continue;
    }

    try {
      const detail = await getWorkoutDetail(workout.workoutId);
      const stem = uniqueStem(fileStem(workout.workoutName), usedStems);
      if (format === 'json') {
        downloadJson(detail, `${stem}.json`);
      } else {
        const { xml, warnings } = garminToZwo(detail, ftp);
        downloadText(xml, `${stem}.zwo`, 'application/xml');
        for (const warning of warnings) {
          if (seenWarnings.has(warning)) continue;
          seenWarnings.add(warning);
          result.warnings.push(warning);
        }
      }
      result.succeeded++;
    } catch (err) {
      result.failed.push({ name: workout.workoutName, message: (err as Error).message });
    }
    onProgress(index + 1);
  }

  return result;
}
