/**
 * Immutable operations on the step tree of a Garmin workout payload.
 *
 * A workout holds `workoutSegments[].workoutSteps[]`, where a `RepeatGroupDTO`
 * step nests its children under its own `workoutSteps`. A step is therefore
 * addressed by a path of indices: `[2]` is the third top-level step, `[2, 0]`
 * the first step inside it.
 *
 * Every function returns a deep copy so callers can drop the result straight
 * into React state.
 */

export type RawStep = Record<string, unknown>;

interface WithSegments {
  workoutSegments?: unknown;
  [key: string]: unknown;
}

interface Segment {
  workoutSteps?: RawStep[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function segmentsOf(target: WithSegments): Segment[] {
  return (Array.isArray(target.workoutSegments) ? target.workoutSegments : []) as Segment[];
}

/** The step list a path points into — i.e. the list holding the addressed step. */
function listAtPath(steps: RawStep[], parentPath: number[]): RawStep[] {
  let list = steps;
  for (const idx of parentPath) list = (list[idx].workoutSteps ?? []) as RawStep[];
  return list;
}

function stepsOfSegment(target: WithSegments, segIdx: number): RawStep[] {
  return segmentsOf(target)[segIdx]?.workoutSteps ?? [];
}

/** Merge `changes` into the step at `path`. */
export function applyStepEdit<T extends WithSegments>(
  target: T,
  segIdx: number,
  path: number[],
  changes: Record<string, unknown>,
): T {
  const next = clone(target);
  const list = listAtPath(stepsOfSegment(next, segIdx), path.slice(0, -1));
  Object.assign(list[path[path.length - 1]], changes);
  return next;
}

/** Remove the step at `path` (a repeat group takes its children with it). */
export function removeStepAtPath<T extends WithSegments>(target: T, segIdx: number, path: number[]): T {
  const next = clone(target);
  const list = listAtPath(stepsOfSegment(next, segIdx), path.slice(0, -1));
  list.splice(path[path.length - 1], 1);
  return next;
}

/** Move a step within the list at `parentPath`; `toIdx` is the gap to drop into. */
export function reorderStepsAtPath<T extends WithSegments>(
  target: T,
  segIdx: number,
  parentPath: number[],
  fromIdx: number,
  toIdx: number,
): T {
  const next = clone(target);
  const list = listAtPath(stepsOfSegment(next, segIdx), parentPath);
  const [item] = list.splice(fromIdx, 1);
  list.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, item);
  return next;
}

/** Append a step to the list at `parentPath`. */
export function addStepAtPath<T extends WithSegments>(
  target: T,
  segIdx: number,
  parentPath: number[],
  newStep: RawStep,
): T {
  const next = clone(target);
  listAtPath(stepsOfSegment(next, segIdx), parentPath).push(newStep);
  return next;
}

/**
 * Renumber `stepOrder` sequentially within each nesting level — the shape the
 * create endpoint accepts (top-level steps 1..n, a repeat group's children
 * numbered from 1 again). Steps built in the editor all start at order 0, which
 * leaves Garmin guessing, so run this right before creating a workout. Step ids
 * are left alone; the create path clears them separately.
 */
export function renumberSteps<T extends WithSegments>(target: T): T {
  const next = clone(target);
  const walk = (steps: RawStep[]): void => {
    steps.forEach((step, i) => {
      step.stepOrder = i + 1;
      if (Array.isArray(step.workoutSteps)) walk(step.workoutSteps as RawStep[]);
    });
  };
  for (const seg of segmentsOf(next)) walk(seg.workoutSteps ?? []);
  return next;
}

/** Total number of executable steps, counting a repeat group's children once. */
export function countSteps(target: WithSegments): number {
  let total = 0;
  const walk = (steps: RawStep[]): void => {
    for (const step of steps) {
      if (Array.isArray(step.workoutSteps)) walk(step.workoutSteps as RawStep[]);
      else total++;
    }
  };
  for (const seg of segmentsOf(target)) walk(seg.workoutSteps ?? []);
  return total;
}
