/**
 * A flat, FTP-independent description of a workout's power profile, used to draw
 * the preview chart. Each block carries power either as a fraction of FTP (ZWO
 * source — the watts adapt as the user changes FTP) or as absolute watts (a
 * Garmin JSON workout, where the targets are already fixed).
 */

export type PowerUnit = 'frac' | 'watts';
export type BlockKind = 'warmup' | 'cooldown' | 'interval' | 'recovery' | 'steady' | 'free';

export interface ProfileBlock {
  durationSec: number;
  kind: BlockKind;
  unit: PowerUnit;
  /** Power at the block start (ramps go start → end). */
  start: number;
  /** Power at the block end. */
  end: number;
  /** ZWO text-event messages / step notes for this block, if any. */
  note?: string;
}

export interface Zone {
  id: number;
  name: string;
  /** Lower bound as a fraction of FTP. */
  lowFrac: number;
  /** Upper bound as a fraction of FTP (Infinity for the open-ended top zone). */
  highFrac: number;
  color: string;
}

// Coggan 7-zone model (fractions of FTP).
export const ZONES: Zone[] = [
  { id: 1, name: 'Active recovery', lowFrac: 0, highFrac: 0.55, color: '#9ca3af' },
  { id: 2, name: 'Endurance', lowFrac: 0.56, highFrac: 0.75, color: '#46a35e' },
  { id: 3, name: 'Tempo', lowFrac: 0.76, highFrac: 0.9, color: '#94a531' },
  { id: 4, name: 'Threshold', lowFrac: 0.91, highFrac: 1.05, color: '#e0a93b' },
  { id: 5, name: 'VO2 max', lowFrac: 1.06, highFrac: 1.2, color: '#e7702d' },
  { id: 6, name: 'Anaerobic', lowFrac: 1.21, highFrac: 1.5, color: '#d23f31' },
  { id: 7, name: 'Neuromuscular', lowFrac: 1.51, highFrac: Infinity, color: '#7c5cd6' },
];

export function zoneForFrac(frac: number): Zone {
  let zone = ZONES[0];
  for (const z of ZONES) if (frac >= z.lowFrac) zone = z;
  return zone;
}

/** Watt range for a zone at the given FTP; `high` is null for the open-ended top zone. */
export function zoneWattRange(zone: Zone, ftp: number): { low: number; high: number | null } {
  return {
    low: Math.round(zone.lowFrac * ftp),
    high: Number.isFinite(zone.highFrac) ? Math.round(zone.highFrac * ftp) : null,
  };
}

/** Resolve a block's [start, end] watts at the given FTP. */
export function blockWatts(block: ProfileBlock, ftp: number): [number, number] {
  return block.unit === 'frac' ? [block.start * ftp, block.end * ftp] : [block.start, block.end];
}

/** Resolve a block's [start, end] as fractions of FTP at the given FTP. */
export function blockFrac(block: ProfileBlock, ftp: number): [number, number] {
  if (block.unit === 'frac') return [block.start, block.end];
  return ftp > 0 ? [block.start / ftp, block.end / ftp] : [0, 0];
}

function num(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  return v == null ? fallback : parseFloat(v);
}

function eventsOf(el: Element): { offset: number; message: string }[] {
  const out: { offset: number; message: string }[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    if (child.tagName !== 'textevent') continue;
    const message = child.getAttribute('message');
    if (message && message.trim()) out.push({ offset: num(child, 'timeoffset', 0), message: message.trim() });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

function joinMsgs(events: { message: string }[]): string | undefined {
  return events.length ? events.map((e) => e.message).join('\n') : undefined;
}

/** Build the power profile from ZWO XML, expanding interval repeats into blocks. */
export function zwoProfile(xml: string): ProfileBlock[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const workout = doc.getElementsByTagName('workout')[0];
  if (!workout) return [];

  const blocks: ProfileBlock[] = [];
  for (let i = 0; i < workout.childNodes.length; i++) {
    const node = workout.childNodes[i];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const dur = num(el, 'Duration', 0);

    const note = joinMsgs(eventsOf(el));
    switch (el.tagName) {
      case 'Warmup':
        blocks.push({ durationSec: dur, kind: 'warmup', unit: 'frac', start: num(el, 'PowerLow', 0.4), end: num(el, 'PowerHigh', 0.75), note });
        break;
      case 'Cooldown':
        // Cooldowns ramp down: start near PowerHigh, finish near PowerLow.
        blocks.push({ durationSec: dur, kind: 'cooldown', unit: 'frac', start: num(el, 'PowerHigh', 0.6), end: num(el, 'PowerLow', 0.4), note });
        break;
      case 'Ramp':
        blocks.push({ durationSec: dur, kind: 'interval', unit: 'frac', start: num(el, 'PowerLow', 0.4), end: num(el, 'PowerHigh', 0.8), note });
        break;
      case 'SteadyState': {
        const p = num(el, 'Power', 0.5);
        blocks.push({ durationSec: dur, kind: 'steady', unit: 'frac', start: p, end: p, note });
        break;
      }
      case 'FreeRide':
        blocks.push({ durationSec: dur, kind: 'free', unit: 'frac', start: 0.5, end: 0.5, note });
        break;
      case 'IntervalsT': {
        const repeat = Math.max(1, Math.round(num(el, 'Repeat', 1)));
        const onD = num(el, 'OnDuration', 0);
        const offD = num(el, 'OffDuration', 0);
        const onP = num(el, 'OnPower', 1);
        const offP = num(el, 'OffPower', 0.5);
        const events = eventsOf(el);
        const onNote = joinMsgs(events.filter((e) => e.offset < onD));
        const offNote = joinMsgs(events.filter((e) => e.offset >= onD));
        // Over-unders put the harder effort in the "off" slot — only call it a
        // recovery when it's genuinely easier than the "on" effort.
        const offKind: BlockKind = offP < onP ? 'recovery' : 'interval';
        for (let r = 0; r < repeat; r++) {
          blocks.push({ durationSec: onD, kind: 'interval', unit: 'frac', start: onP, end: onP, note: onNote });
          blocks.push({ durationSec: offD, kind: offKind, unit: 'frac', start: offP, end: offP, note: offNote });
        }
        break;
      }
    }
  }
  return blocks;
}

function mapKind(stepTypeKey: string | undefined): BlockKind {
  switch (stepTypeKey) {
    case 'warmup':
      return 'warmup';
    case 'cooldown':
      return 'cooldown';
    case 'recovery':
    case 'rest':
      return 'recovery';
    case 'interval':
      return 'interval';
    default:
      return 'steady';
  }
}

interface RawStep {
  type?: string;
  stepType?: { stepTypeKey?: string };
  endCondition?: { conditionTypeKey?: string };
  endConditionValue?: number;
  numberOfIterations?: number;
  targetValueOne?: number | null;
  targetValueTwo?: number | null;
  description?: string | null;
  workoutSteps?: RawStep[];
}

function walkSteps(steps: RawStep[], out: ProfileBlock[]): void {
  for (const step of steps) {
    if (step.type === 'RepeatGroupDTO') {
      const iters = Math.max(1, Math.round(step.numberOfIterations ?? step.endConditionValue ?? 1));
      for (let i = 0; i < iters; i++) walkSteps(step.workoutSteps ?? [], out);
      continue;
    }
    const durationSec = step.endCondition?.conditionTypeKey === 'time' ? (step.endConditionValue ?? 0) : 0;
    const kind = mapKind(step.stepType?.stepTypeKey);
    const note = typeof step.description === 'string' && step.description.trim() ? step.description : undefined;
    const low = step.targetValueOne;
    const high = step.targetValueTwo;
    if (typeof low === 'number' && typeof high === 'number') {
      const mid = (low + high) / 2;
      out.push({ durationSec, kind, unit: 'watts', start: mid, end: mid, note });
    } else {
      out.push({ durationSec, kind: 'free', unit: 'watts', start: 0, end: 0, note });
    }
  }
}

/** Build the power profile from a Garmin workout JSON payload. */
export function jsonProfile(payload: unknown): ProfileBlock[] {
  const segments = (payload as { workoutSegments?: { workoutSteps?: RawStep[] }[] }).workoutSegments ?? [];
  const blocks: ProfileBlock[] = [];
  for (const seg of segments) walkSteps(seg.workoutSteps ?? [], blocks);
  return blocks;
}

/** True if any block needs an FTP to resolve to watts (i.e. a ZWO %FTP source). */
export function profileNeedsFtp(blocks: ProfileBlock[]): boolean {
  return blocks.some((b) => b.unit === 'frac');
}

export function totalDuration(blocks: ProfileBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.durationSec, 0);
}
