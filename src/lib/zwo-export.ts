/**
 * Convert a Garmin structured workout (the JSON the workout-service returns)
 * into a Zwift `.zwo` file — the reverse of `zwo.ts`.
 *
 * Fidelity notes:
 * - Garmin power targets are absolute watts, ZWO power is a fraction of FTP, so
 *   the conversion needs the FTP the targets were written against.
 * - A Garmin warm-up / cool-down step carries a watt *band*, not a ramp. It is
 *   emitted as a ZWO `<Warmup>` / `<Cooldown>` ramping across that band, which
 *   is how `zwo.ts` reads those elements back in.
 * - A repeat group of exactly two power steps becomes an `<IntervalsT>`; any
 *   other repeat group is unrolled into its individual blocks, because ZWO has
 *   no general-purpose repeat container.
 * - Cadence targets become `Cadence` / `CadenceResting`, step notes become
 *   `<textevent>` messages.
 * - Steps ZWO cannot express (heart-rate targets, distance or lap-button end
 *   conditions) are reported as warnings instead of being silently dropped.
 */

const AUTHOR = 'Garmin Workout Importer';

export interface ZwoExport {
  xml: string;
  /** Human-readable notes about anything that could not be converted exactly. */
  warnings: string[];
}

interface RawStep {
  type?: string;
  stepType?: { stepTypeKey?: string };
  endCondition?: { conditionTypeKey?: string };
  endConditionValue?: number | null;
  numberOfIterations?: number | null;
  targetType?: { workoutTargetTypeKey?: string };
  targetValueOne?: number | null;
  targetValueTwo?: number | null;
  secondaryTargetType?: { workoutTargetTypeKey?: string } | null;
  secondaryTargetValueOne?: number | null;
  secondaryTargetValueTwo?: number | null;
  description?: string | null;
  workoutSteps?: RawStep[];
}

/** A step reduced to what ZWO can express. */
interface Block {
  kind: 'warmup' | 'cooldown' | 'interval' | 'recovery' | 'free';
  durationSec: number;
  /** Power as a fraction of FTP; absent for a free ride. */
  low?: number;
  high?: number;
  cadence?: number;
  note?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ZWO power fractions read best at three decimals ("0.885"), without trailing zeros. */
function frac(value: number): string {
  return String(Math.max(0, Math.round(value * 1000) / 1000));
}

function secs(value: number): string {
  return String(Math.max(0, Math.round(value)));
}

function isRepeat(step: RawStep): boolean {
  return step.type === 'RepeatGroupDTO' || Array.isArray(step.workoutSteps);
}

function durationOf(step: RawStep): number | null {
  if (step.endCondition?.conditionTypeKey !== 'time') return null;
  const value = step.endConditionValue;
  return typeof value === 'number' && value > 0 ? value : null;
}

function cadenceOf(step: RawStep): number | undefined {
  if (step.secondaryTargetType?.workoutTargetTypeKey !== 'cadence.zone') return undefined;
  const one = step.secondaryTargetValueOne;
  const two = step.secondaryTargetValueTwo;
  const values = [one, two].filter((v): v is number => typeof v === 'number' && v > 0);
  if (!values.length) return undefined;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function noteOf(step: RawStep): string | undefined {
  const text = typeof step.description === 'string' ? step.description.trim() : '';
  return text || undefined;
}

function kindOf(step: RawStep): Block['kind'] {
  switch (step.stepType?.stepTypeKey) {
    case 'warmup':
      return 'warmup';
    case 'cooldown':
      return 'cooldown';
    case 'recovery':
    case 'rest':
      return 'recovery';
    default:
      return 'interval';
  }
}

/**
 * Reduce one executable step to a ZWO block. Returns null when the step has no
 * usable duration (distance or lap-button end conditions have no ZWO analogue).
 */
function toBlock(step: RawStep, ftp: number, warn: (message: string) => void): Block | null {
  const durationSec = durationOf(step);
  if (durationSec === null) {
    warn('Steps that end on distance or a lap-button press were skipped — Zwift workouts are time-based.');
    return null;
  }

  const cadence = cadenceOf(step);
  const note = noteOf(step);
  const targetKey = step.targetType?.workoutTargetTypeKey;
  const one = step.targetValueOne;
  const two = step.targetValueTwo;

  if (targetKey === 'power.zone' && typeof one === 'number' && typeof two === 'number') {
    const lowWatts = Math.min(one, two);
    const highWatts = Math.max(one, two);
    return {
      kind: kindOf(step),
      durationSec,
      low: lowWatts / ftp,
      high: highWatts / ftp,
      cadence,
      note,
    };
  }

  if (targetKey && targetKey !== 'no.target') {
    const label = targetKey === 'heart.rate.zone' ? 'heart rate' : targetKey.replace(/\.zone$/, '').replace(/\./g, ' ');
    warn(`Steps with a ${label} target became free rides — Zwift steps are power-based.`);
  }
  return { kind: 'free', durationSec, cadence, note };
}

function textEvent(message: string, offsetSec: number): string {
  return `      <textevent timeoffset="${secs(offsetSec)}" message="${escapeXml(message)}"/>\n`;
}

function attr(name: string, value: string | number | undefined): string {
  return value === undefined ? '' : ` ${name}="${value}"`;
}

/** An element with a `<textevent>` child when the step carried a note. */
function element(tag: string, attrs: string, note?: string): string {
  const open = `    <${tag}${attrs}`;
  return note ? `${open}>\n${textEvent(note, 0)}    </${tag}>\n` : `${open}/>\n`;
}

/** Serialise one block as a ZWO element. */
function blockXml(block: Block): string {
  const duration = attr('Duration', secs(block.durationSec));
  const cadence = attr('Cadence', block.cadence);

  if (block.kind === 'free') {
    return element('FreeRide', `${duration} FlatRoad="1"${cadence}`, block.note);
  }

  const low = frac(block.low ?? 0);
  const high = frac(block.high ?? 0);
  const ramp = `${duration} PowerLow="${low}" PowerHigh="${high}"${cadence}`;

  switch (block.kind) {
    case 'warmup':
      return element('Warmup', ramp, block.note);
    case 'cooldown':
      // Zwift ramps a cooldown down from PowerHigh to PowerLow.
      return element('Cooldown', ramp, block.note);
    default: {
      const mid = ((block.low ?? 0) + (block.high ?? 0)) / 2;
      return element('SteadyState', `${duration} Power="${frac(mid)}"${cadence}`, block.note);
    }
  }
}

/** Serialise a two-step repeat group as a single `<IntervalsT>` element. */
function intervalsXml(on: Block, off: Block, repeat: number): string {
  const onMid = ((on.low ?? 0) + (on.high ?? 0)) / 2;
  const offMid = ((off.low ?? 0) + (off.high ?? 0)) / 2;
  const open =
    `    <IntervalsT Repeat="${repeat}"` +
    ` OnDuration="${secs(on.durationSec)}" OffDuration="${secs(off.durationSec)}"` +
    ` OnPower="${frac(onMid)}" OffPower="${frac(offMid)}"` +
    attr('Cadence', on.cadence) +
    attr('CadenceResting', off.cadence);

  // Offsets mirror how zwo.ts reads them back: before OnDuration is the "on"
  // effort's note, at or after it the "off" effort's.
  let events = '';
  if (on.note) events += textEvent(on.note, 0);
  if (off.note) events += textEvent(off.note, on.durationSec);

  return events ? `${open}>\n${events}    </IntervalsT>\n` : `${open}/>\n`;
}

/** True when a repeat group maps cleanly onto Zwift's on/off interval element. */
function isIntervalPair(children: Block[]): boolean {
  return (
    children.length === 2 &&
    children.every((b) => b.kind !== 'free' && b.durationSec > 0)
  );
}

function iterationsOf(step: RawStep): number {
  return Math.max(1, Math.round(step.numberOfIterations ?? step.endConditionValue ?? 1));
}

/**
 * Flatten a repeat group into the blocks it actually plays out as, repeating
 * each pass and recursing into nested groups.
 */
function unroll(steps: RawStep[], ftp: number, warn: (message: string) => void): Block[] {
  const blocks: Block[] = [];
  for (const step of steps) {
    if (isRepeat(step)) {
      const inner = unroll(step.workoutSteps ?? [], ftp, warn);
      for (let i = 0; i < iterationsOf(step); i++) blocks.push(...inner);
      continue;
    }
    const block = toBlock(step, ftp, warn);
    if (block) blocks.push(block);
  }
  return blocks;
}

function stepsOf(workout: unknown): RawStep[] {
  const segments = (workout as { workoutSegments?: Array<{ workoutSteps?: RawStep[] }> }).workoutSegments ?? [];
  return segments.flatMap((segment) => segment?.workoutSteps ?? []);
}

/**
 * Convert a Garmin workout payload into ZWO XML. `ftp` is the FTP in watts the
 * workout's power targets should be read against — it must be > 0.
 */
export function garminToZwo(workout: unknown, ftp: number): ZwoExport {
  if (!(ftp > 0)) throw new Error('An FTP is needed to convert watt targets into Zwift %FTP values.');

  const source = workout as { workoutName?: string; description?: string | null };
  const steps = stepsOf(workout);
  if (!steps.length) throw new Error('This workout has no steps to export.');

  const seen = new Set<string>();
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    warnings.push(message);
  };

  let body = '';
  for (const step of steps) {
    if (isRepeat(step)) {
      const repeat = iterationsOf(step);
      const children = step.workoutSteps ?? [];
      const pair = children.some(isRepeat) ? [] : children.map((c) => toBlock(c, ftp, warn)).filter((b): b is Block => b !== null);

      if (isIntervalPair(pair)) {
        body += intervalsXml(pair[0], pair[1], repeat);
        continue;
      }

      // No general repeat container in ZWO — write the block out once per rep.
      const blocks = pair.length ? pair : unroll(children, ftp, warn);
      if (!blocks.length) continue;
      warn(`A repeat group of ${blocks.length} steps was written out ${repeat}× — Zwift only repeats on/off pairs.`);
      for (let i = 0; i < repeat; i++) for (const block of blocks) body += blockXml(block);
      continue;
    }

    const block = toBlock(step, ftp, warn);
    if (block) body += blockXml(block);
  }

  if (!body) throw new Error('None of this workout’s steps could be converted to Zwift format.');

  const name = source.workoutName?.trim() || 'Workout';
  const description = source.description?.trim() ?? '';

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<workout_file>\n` +
    `  <author>${escapeXml(AUTHOR)}</author>\n` +
    `  <name>${escapeXml(name)}</name>\n` +
    `  <description>${escapeXml(description)}</description>\n` +
    `  <sportType>bike</sportType>\n` +
    `  <tags/>\n` +
    `  <workout>\n` +
    body +
    `  </workout>\n` +
    `</workout_file>\n`;

  return { xml, warnings };
}

/** ZWO is a cycling format — other Garmin sports have no power-based equivalent. */
export function canExportZwo(sportTypeKey?: string): boolean {
  return !sportTypeKey || sportTypeKey === 'cycling';
}
