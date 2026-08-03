/**
 * Build Garmin structured-workout payloads from scratch.
 *
 * Where `zwo.ts` converts an existing file, this module is the source for
 * workouts the user creates in the drawer: an empty cycling workout, the step
 * factory the editor uses when you add a step, and a small catalogue of
 * FTP-relative templates (endurance, sweet spot, threshold, VO2 max, …) that
 * give you a complete session in one click.
 *
 * Template power is expressed as a fraction of FTP so the same template yields
 * correct watts for any athlete — it is resolved to watts at build time.
 */

import type { RawStep } from './workout-steps';

const CYCLING_SPORT = {
  sportTypeId: 2,
  sportTypeKey: 'cycling',
  displayOrder: 2,
};

/** Half-width of the watt band around a single-value power target. */
const POWER_BAND = 5;

export type StepKind = 'warmup' | 'cooldown' | 'interval' | 'recovery' | 'rest';

const STEP_TYPE_IDS: Record<StepKind, number> = {
  warmup: 1,
  cooldown: 2,
  interval: 3,
  recovery: 4,
  rest: 5,
};

export interface StepSpec {
  kind: StepKind;
  durationSec: number;
  /**
   * Power as a fraction of FTP — a single value (turned into a ±5 W band) or an
   * explicit [low, high] range. Omit for a free-ride step with no target.
   */
  power?: number | [number, number];
  /** Cadence target in rpm. */
  cadence?: number;
  description?: string;
}

export interface RepeatSpec {
  repeat: number;
  steps: StepSpec[];
}

export type BlockSpec = StepSpec | RepeatSpec;

function isRepeat(block: BlockSpec): block is RepeatSpec {
  return 'repeat' in block;
}

/** The full set of fields Garmin expects on an executable step. */
function stepBase(): RawStep {
  return {
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder: 0,
    category: null,
    childStepId: null,
    description: null,
    equipmentType: { displayOrder: null, equipmentTypeId: null, equipmentTypeKey: null },
    exerciseName: null,
    preferredEndConditionUnit: null,
    providerExerciseSourceId: null,
    secondaryTargetType: null,
    secondaryTargetValueOne: null,
    secondaryTargetValueTwo: null,
    secondaryTargetValueUnit: null,
    secondaryZoneNumber: null,
    stepAudioNote: null,
    strokeType: {},
    targetValueOne: null,
    targetValueTwo: null,
    targetValueUnit: null,
    weightUnit: null,
    weightValue: null,
    workoutProvider: null,
    zoneNumber: null,
  };
}

function powerTarget(low: number, high: number): RawStep {
  return {
    targetType: { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone', displayOrder: 2 },
    targetValueOne: Math.max(0, Math.round(low)),
    targetValueTwo: Math.max(0, Math.round(high)),
  };
}

function noTarget(): RawStep {
  return {
    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 },
    targetValueOne: null,
    targetValueTwo: null,
  };
}

function cadenceTarget(rpm: number): RawStep {
  if (!(rpm > 0)) return {};
  return {
    secondaryTargetType: { workoutTargetTypeId: 3, workoutTargetTypeKey: 'cadence.zone', displayOrder: 3 },
    secondaryTargetValueOne: Math.round(rpm),
    secondaryTargetValueTwo: Math.round(rpm),
  };
}

/** Resolve a spec's fractional power to a [low, high] watt band. */
function wattBand(power: number | [number, number], ftp: number): [number, number] {
  if (Array.isArray(power)) return [power[0] * ftp, power[1] * ftp];
  const target = power * ftp;
  return [target - POWER_BAND, target + POWER_BAND];
}

/** A time-based executable step with an optional power (in watts) target. */
export function createStep(opts: {
  kind: StepKind;
  durationSec: number;
  /** Absolute watts — omit for a step with no target. */
  watts?: [number, number];
  cadence?: number;
  description?: string;
}): RawStep {
  return {
    ...stepBase(),
    stepType: {
      stepTypeId: STEP_TYPE_IDS[opts.kind],
      stepTypeKey: opts.kind,
      displayOrder: STEP_TYPE_IDS[opts.kind],
    },
    endCondition: { conditionTypeId: 2, conditionTypeKey: 'time', displayable: true, displayOrder: 1 },
    endConditionCompare: null,
    endConditionValue: Math.max(0, Math.round(opts.durationSec)),
    endConditionZone: null,
    ...(opts.watts ? powerTarget(opts.watts[0], opts.watts[1]) : noTarget()),
    ...cadenceTarget(opts.cadence ?? 0),
    description: opts.description ?? null,
  };
}

/** A repeat group containing `steps`, run `repeat` times. */
export function createRepeatGroup(repeat: number, steps: RawStep[] = []): RawStep {
  const n = Math.max(1, Math.round(repeat));
  return {
    type: 'RepeatGroupDTO',
    stepId: null,
    stepOrder: 0,
    stepType: { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 },
    endCondition: { conditionTypeId: 7, conditionTypeKey: 'iterations', displayable: false, displayOrder: 7 },
    endConditionValue: n,
    numberOfIterations: n,
    endConditionCompare: null,
    endConditionZone: null,
    childStepId: 1,
    workoutSteps: steps,
    category: null,
    description: null,
    equipmentType: { displayOrder: null, equipmentTypeId: null, equipmentTypeKey: null },
    preferredEndConditionUnit: null,
    ...noTarget(),
  };
}

function specToStep(spec: StepSpec, ftp: number): RawStep {
  return createStep({
    kind: spec.kind,
    durationSec: spec.durationSec,
    watts: spec.power !== undefined && ftp > 0 ? wattBand(spec.power, ftp) : undefined,
    cadence: spec.cadence,
    description: spec.description,
  });
}

export interface WorkoutDraft {
  workoutName: string;
  description: string;
  [key: string]: unknown;
}

/** Wrap top-level steps in the payload shape POST /workout-service/workout wants. */
export function buildWorkout(name: string, description: string, steps: RawStep[]): WorkoutDraft {
  steps.forEach((step, i) => {
    step.stepOrder = i + 1;
  });
  return {
    sportType: CYCLING_SPORT,
    subSportType: null,
    workoutName: name,
    description,
    estimatedDistanceUnit: { unitKey: null },
    avgTrainingSpeed: 0,
    estimatedDurationInSecs: 0,
    estimatedDistanceInMeters: 0,
    estimateType: null,
    isWheelchair: false,
    workoutSegments: [{ segmentOrder: 1, sportType: CYCLING_SPORT, workoutSteps: steps }],
  };
}

/** An empty cycling workout, ready for the step editor. */
export function blankWorkout(name = '', description = ''): WorkoutDraft {
  return buildWorkout(name, description, []);
}

/** Turn a template's blocks into a workout payload with watts resolved at `ftp`. */
export function buildFromBlocks(
  name: string,
  description: string,
  blocks: BlockSpec[],
  ftp: number,
): WorkoutDraft {
  const steps = blocks.map((block) =>
    isRepeat(block)
      ? createRepeatGroup(
          block.repeat,
          block.steps.map((spec, i) => {
            const step = specToStep(spec, ftp);
            step.stepOrder = i + 1;
            return step;
          }),
        )
      : specToStep(block, ftp),
  );
  return buildWorkout(name, description, steps);
}

// ─── Template catalogue ──────────────────────────────────────────────────────

export interface WorkoutTemplate {
  id: string;
  name: string;
  /** One-liner shown on the template card. */
  summary: string;
  blocks: BlockSpec[];
}

const MIN = 60;

export const TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'endurance',
    name: 'Endurance ride',
    summary: 'Steady zone 2 with an easy warm-up and cool-down',
    blocks: [
      { kind: 'warmup', durationSec: 10 * MIN, power: [0.45, 0.6] },
      { kind: 'interval', durationSec: 60 * MIN, power: [0.62, 0.72] },
      { kind: 'cooldown', durationSec: 10 * MIN, power: [0.4, 0.5] },
    ],
  },
  {
    id: 'sweetspot',
    name: 'Sweet spot 3×15',
    summary: 'Three 15-minute blocks just below threshold',
    blocks: [
      { kind: 'warmup', durationSec: 12 * MIN, power: [0.5, 0.65] },
      {
        repeat: 3,
        steps: [
          { kind: 'interval', durationSec: 15 * MIN, power: [0.88, 0.93] },
          { kind: 'recovery', durationSec: 5 * MIN, power: [0.45, 0.55] },
        ],
      },
      { kind: 'cooldown', durationSec: 8 * MIN, power: [0.4, 0.5] },
    ],
  },
  {
    id: 'threshold',
    name: 'Threshold 4×8',
    summary: 'Four 8-minute efforts right at FTP',
    blocks: [
      { kind: 'warmup', durationSec: 15 * MIN, power: [0.5, 0.65] },
      {
        repeat: 4,
        steps: [
          { kind: 'interval', durationSec: 8 * MIN, power: [0.97, 1.02] },
          { kind: 'recovery', durationSec: 4 * MIN, power: [0.45, 0.55] },
        ],
      },
      { kind: 'cooldown', durationSec: 10 * MIN, power: [0.4, 0.5] },
    ],
  },
  {
    id: 'vo2max',
    name: 'VO₂ max 5×4',
    summary: 'Five hard 4-minute intervals with equal recovery',
    blocks: [
      { kind: 'warmup', durationSec: 15 * MIN, power: [0.5, 0.68] },
      {
        repeat: 5,
        steps: [
          { kind: 'interval', durationSec: 4 * MIN, power: [1.1, 1.18], cadence: 95 },
          { kind: 'recovery', durationSec: 4 * MIN, power: [0.4, 0.5] },
        ],
      },
      { kind: 'cooldown', durationSec: 10 * MIN, power: [0.4, 0.5] },
    ],
  },
  {
    id: 'overunder',
    name: 'Over–unders 3×12',
    summary: 'Alternating 3 min under and over threshold',
    blocks: [
      { kind: 'warmup', durationSec: 15 * MIN, power: [0.5, 0.65] },
      {
        repeat: 3,
        steps: [
          { kind: 'interval', durationSec: 3 * MIN, power: [0.93, 0.97] },
          { kind: 'interval', durationSec: 3 * MIN, power: [1.03, 1.08] },
          { kind: 'interval', durationSec: 3 * MIN, power: [0.93, 0.97] },
          { kind: 'interval', durationSec: 3 * MIN, power: [1.03, 1.08] },
          { kind: 'recovery', durationSec: 5 * MIN, power: [0.45, 0.55] },
        ],
      },
      { kind: 'cooldown', durationSec: 10 * MIN, power: [0.4, 0.5] },
    ],
  },
  {
    id: 'recovery',
    name: 'Recovery spin',
    summary: 'Easy, high-cadence flush-out ride',
    blocks: [{ kind: 'recovery', durationSec: 45 * MIN, power: [0.4, 0.5], cadence: 90 }],
  },
];

/** Total time of a template in seconds, expanding repeat groups. */
export function templateDuration(template: WorkoutTemplate): number {
  return template.blocks.reduce((total, block) => {
    if (isRepeat(block)) {
      return total + block.repeat * block.steps.reduce((sum, s) => sum + s.durationSec, 0);
    }
    return total + block.durationSec;
  }, 0);
}
