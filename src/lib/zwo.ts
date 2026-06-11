/**
 * Convert a Zwift .zwo workout into a Garmin Connect structured-workout JSON
 * payload (the body accepted by POST /workout-service/workout).
 *
 * Runs in the browser: it takes the raw XML string and an FTP (watts) and uses
 * the native DOMParser.
 *
 * Fidelity notes:
 * - Zwift Warmup / Cooldown / Ramp segments ramp power continuously. Garmin
 *   structured workouts have no intra-step power ramp, so each ramp is split
 *   into several flat sub-steps that step-approximate the slope.
 * - ZWO `Cadence` / `CadenceResting` attributes become a Garmin secondary
 *   cadence target on the step.
 * - ZWO `<textevent>` messages become the step's description (notes).
 */

const POWER_BAND = 5;

// Ramp approximation: aim for ~one sub-step per RAMP_SUBSTEP_SECS, clamped.
const RAMP_SUBSTEP_SECS = 120;
const MIN_RAMP_SUBSTEPS = 3;
const MAX_RAMP_SUBSTEPS = 8;
const RAMP_SPLIT_MIN_DURATION = 90; // ramps shorter than this stay a single step

const CYCLING_SPORT = {
  sportTypeId: 2,
  sportTypeKey: "cycling",
  displayOrder: 2,
};

function wattsRange(fraction: number, ftp: number): [number, number] {
  const target = Math.round(ftp * fraction);
  return [target - POWER_BAND, target + POWER_BAND];
}

function stepBase() {
  return {
    type: "ExecutableStepDTO",
    stepId: 0,
    stepOrder: 0,
    category: null,
    childStepId: null,
    description: null as string | null,
    equipmentType: {
      displayOrder: null,
      equipmentTypeId: null,
      equipmentTypeKey: null,
    },
    exerciseName: null,
    preferredEndConditionUnit: null,
    providerExerciseSourceId: null,
    secondaryTargetType: null as object | null,
    secondaryTargetValueOne: null as number | null,
    secondaryTargetValueTwo: null as number | null,
    secondaryTargetValueUnit: null,
    secondaryZoneNumber: null,
    stepAudioNote: null,
    strokeType: {},
    targetValueOne: null as number | null,
    targetValueTwo: null as number | null,
    targetValueUnit: null,
    weightUnit: null,
    weightValue: null,
    workoutProvider: null,
    zoneNumber: null,
  };
}

function stepTypeField(id: number, key: string) {
  return { stepType: { stepTypeId: id, stepTypeKey: key, displayOrder: id } };
}

function timeDurationField(seconds: number) {
  return {
    endCondition: {
      conditionTypeId: 2,
      conditionTypeKey: "time",
      displayable: true,
      displayOrder: 1,
    },
    endConditionCompare: null,
    endConditionValue: seconds,
    endConditionZone: null,
  };
}

function powerTargetField(low: number, high: number) {
  return {
    targetType: {
      workoutTargetTypeId: 2,
      workoutTargetTypeKey: "power.zone",
      displayOrder: 2,
    },
    targetValueOne: low,
    targetValueTwo: high,
  };
}

function noTargetField() {
  return {
    targetType: {
      workoutTargetTypeId: 1,
      workoutTargetTypeKey: "no.target",
      displayOrder: 1,
    },
  };
}

/** A Garmin secondary cadence target, or {} when there is no cadence to map. */
function cadenceFields(cadence: number) {
  if (!(cadence > 0)) return {};
  const rpm = Math.round(cadence);
  return {
    secondaryTargetType: {
      workoutTargetTypeId: 3,
      workoutTargetTypeKey: "cadence.zone",
      displayOrder: 3,
    },
    secondaryTargetValueOne: rpm,
    secondaryTargetValueTwo: rpm,
  };
}

function attr(elem: Element, name: string, fallback: string): string {
  return elem.getAttribute(name) ?? fallback;
}

function numAttr(elem: Element, name: string, fallback: number): number {
  const v = elem.getAttribute(name);
  if (v == null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

interface TextEvent {
  offset: number;
  message: string;
}

/** Collect a block's `<textevent>` messages, sorted by time offset. */
function textEvents(elem: Element): TextEvent[] {
  const events: TextEvent[] = [];
  for (let i = 0; i < elem.childNodes.length; i++) {
    const node = elem.childNodes[i];
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    if (child.tagName !== "textevent") continue;
    const message = child.getAttribute("message");
    if (message && message.trim()) {
      events.push({ offset: numAttr(child, "timeoffset", 0), message: message.trim() });
    }
  }
  return events.sort((a, b) => a.offset - b.offset);
}

function joinMessages(events: TextEvent[]): string | null {
  if (!events.length) return null;
  return events.map((e) => e.message).join("\n").slice(0, 1024);
}

/** Join all of a block's `<textevent>` messages (for single-step blocks). */
function notesFor(elem: Element): string | null {
  return joinMessages(textEvents(elem));
}

function executableStep(opts: {
  typeId: number;
  typeKey: string;
  durationSec: number;
  target: object;
  cadence?: number;
  description?: string | null;
}) {
  return {
    ...stepBase(),
    ...stepTypeField(opts.typeId, opts.typeKey),
    ...timeDurationField(opts.durationSec),
    ...opts.target,
    ...cadenceFields(opts.cadence ?? 0),
    description: opts.description ?? null,
  };
}

function convertSteadyState(elem: Element, ftp: number) {
  const [lo, hi] = wattsRange(numAttr(elem, "Power", 0.5), ftp);
  return executableStep({
    typeId: 3,
    typeKey: "interval",
    durationSec: numAttr(elem, "Duration", 0),
    target: powerTargetField(lo, hi),
    cadence: numAttr(elem, "Cadence", 0),
    description: notesFor(elem),
  });
}

function convertFreeRide(elem: Element) {
  return executableStep({
    typeId: 3,
    typeKey: "interval",
    durationSec: numAttr(elem, "Duration", 0),
    target: noTargetField(),
    cadence: numAttr(elem, "Cadence", 0),
    description: notesFor(elem),
  });
}

/**
 * Split a continuous ramp (Warmup / Cooldown / Ramp) into flat sub-steps that
 * step-approximate the slope from `startName` to `endName`. Short ramps stay a
 * single step at the midpoint power.
 */
function rampSteps(
  elem: Element,
  typeId: number,
  typeKey: string,
  ftp: number,
  startName: string,
  startDefault: number,
  endName: string,
  endDefault: number,
): object[] {
  const startFrac = numAttr(elem, startName, startDefault);
  const endFrac = numAttr(elem, endName, endDefault);
  const duration = numAttr(elem, "Duration", 0);
  const cadence = numAttr(elem, "Cadence", 0);
  const events = textEvents(elem);

  const count =
    duration < RAMP_SPLIT_MIN_DURATION
      ? 1
      : Math.min(MAX_RAMP_SUBSTEPS, Math.max(MIN_RAMP_SUBSTEPS, Math.round(duration / RAMP_SUBSTEP_SECS)));

  const steps: object[] = [];
  let remaining = duration;
  let elapsed = 0;
  for (let i = 0; i < count; i++) {
    const segDuration = i === count - 1 ? remaining : Math.round(duration / count);
    remaining -= segDuration;
    const isLast = i === count - 1;
    const windowEnd = elapsed + segDuration;
    // Attach each message to the sub-step whose time window contains its offset.
    const note = joinMessages(events.filter((e) => e.offset >= elapsed && (isLast || e.offset < windowEnd)));
    elapsed = windowEnd;
    const frac = startFrac + (endFrac - startFrac) * ((i + 0.5) / count);
    const [lo, hi] = wattsRange(frac, ftp);
    steps.push(
      executableStep({
        typeId,
        typeKey,
        durationSec: segDuration,
        target: powerTargetField(lo, hi),
        cadence,
        description: note,
      }),
    );
  }
  return steps;
}

function convertIntervalsT(elem: Element, ftp: number) {
  const repeat = parseInt(attr(elem, "Repeat", "1"), 10);
  const onDuration = numAttr(elem, "OnDuration", 0);
  const offDuration = numAttr(elem, "OffDuration", 0);
  const onPower = numAttr(elem, "OnPower", 1.0);
  const offPower = numAttr(elem, "OffPower", 0.5);
  const onCadence = numAttr(elem, "Cadence", 0);
  const offCadence = numAttr(elem, "CadenceResting", 0);
  const events = textEvents(elem);
  const onNote = joinMessages(events.filter((e) => e.offset < onDuration));
  const offNote = joinMessages(events.filter((e) => e.offset >= onDuration));

  // The "off" segment is a recovery only when it's actually easier than the
  // "on" segment. Over-unders put the harder "over" effort in the off slot, so
  // it must stay an active interval, not be mislabelled as recovery.
  const offIsRecovery = offPower < onPower;

  const [onLo, onHi] = wattsRange(onPower, ftp);
  const [offLo, offHi] = wattsRange(offPower, ftp);

  const onStep = {
    ...executableStep({
      typeId: 3,
      typeKey: "interval",
      durationSec: onDuration,
      target: powerTargetField(onLo, onHi),
      cadence: onCadence,
      description: onNote,
    }),
    stepId: 1,
    stepOrder: 1,
  };
  const offStep = {
    ...executableStep({
      typeId: offIsRecovery ? 4 : 3,
      typeKey: offIsRecovery ? "recovery" : "interval",
      durationSec: offDuration,
      target: powerTargetField(offLo, offHi),
      cadence: offCadence,
      description: offNote,
    }),
    stepId: 2,
    stepOrder: 2,
  };

  // Repeat blocks use a RepeatGroupDTO container around the on/off steps.
  return {
    type: "RepeatGroupDTO",
    stepId: 0,
    stepOrder: 0,
    ...stepTypeField(6, "repeat"),
    endCondition: {
      conditionTypeId: 7,
      conditionTypeKey: "iterations",
      displayable: false,
      displayOrder: 7,
    },
    endConditionValue: repeat,
    numberOfIterations: repeat,
    endConditionCompare: null,
    endConditionZone: null,
    childStepId: 1,
    workoutSteps: [onStep, offStep],
    category: null,
    description: null, // notes now live on the individual on/off steps
    equipmentType: {
      displayOrder: null,
      equipmentTypeId: null,
      equipmentTypeKey: null,
    },
    preferredEndConditionUnit: null,
    ...noTargetField(),
    targetValueOne: null,
    targetValueTwo: null,
  };
}

export interface GarminWorkoutPayload {
  workoutName: string;
  description: string;
  [key: string]: unknown;
}

/** Read the workout name embedded in a ZWO file (for prefilling the name field). */
export function zwoName(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return doc.getElementsByTagName("name")[0]?.textContent?.trim() ?? "Workout";
}

/** Parse a ZWO XML string and build the Garmin workout-service payload. */
export function zwoToGarminPayload(
  xml: string,
  ftp: number,
): GarminWorkoutPayload {
  const doc = new DOMParser().parseFromString(xml, "text/xml");

  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("This file is not valid ZWO XML.");
  }

  const name =
    doc.getElementsByTagName("name")[0]?.textContent?.trim() ?? "Workout";
  const description =
    doc.getElementsByTagName("description")[0]?.textContent?.trim() ?? "";

  const workoutElem = doc.getElementsByTagName("workout")[0];
  if (!workoutElem)
    throw new Error("No <workout> element found in the ZWO file.");

  const steps: Array<Record<string, unknown>> = [];

  for (let i = 0; i < workoutElem.childNodes.length; i++) {
    const node = workoutElem.childNodes[i];
    if (node.nodeType !== 1) continue;
    const elem = node as Element;

    switch (elem.tagName) {
      case "SteadyState":
        steps.push(convertSteadyState(elem, ftp));
        break;
      case "Warmup":
        steps.push(...(rampSteps(elem, 1, "warmup", ftp, "PowerLow", 0.25, "PowerHigh", 0.75) as Array<Record<string, unknown>>));
        break;
      case "Cooldown":
        steps.push(...(rampSteps(elem, 2, "cooldown", ftp, "PowerHigh", 0.6, "PowerLow", 0.4) as Array<Record<string, unknown>>));
        break;
      case "Ramp":
        steps.push(...(rampSteps(elem, 3, "interval", ftp, "PowerLow", 0.4, "PowerHigh", 0.8) as Array<Record<string, unknown>>));
        break;
      case "FreeRide":
        steps.push(convertFreeRide(elem));
        break;
      case "IntervalsT":
        steps.push(convertIntervalsT(elem, ftp));
        break;
      // SlopeRide and other non-step elements are silently skipped.
    }
  }

  if (steps.length === 0)
    throw new Error("No convertible workout steps found in the ZWO file.");

  // Assign sequential stepId / stepOrder to the top-level steps (repeat groups
  // keep their own child numbering).
  steps.forEach((step, i) => {
    step.stepId = i + 1;
    step.stepOrder = i + 1;
  });

  return {
    sportType: CYCLING_SPORT,
    subSportType: null,
    workoutName: name,
    description,
    estimatedDistanceUnit: { unitKey: null },
    avgTrainingSpeed: null,
    estimatedDurationInSecs: 0,
    estimatedDistanceInMeters: 0,
    estimateType: null,
    isWheelchair: false,
    workoutSegments: [
      { segmentOrder: 1, sportType: CYCLING_SPORT, workoutSteps: steps },
    ],
  };
}

export const APPROXIMATION_NOTE =
  "Zwift Warmup, Cooldown, and Ramp segments ramp power continuously. Garmin " +
  "structured workouts have no intra-step power ramp, so each ramp is split into " +
  "several flat sub-steps that step-approximate the slope. ZWO cadence becomes a " +
  "secondary cadence target and <textevent> messages become step notes.";
