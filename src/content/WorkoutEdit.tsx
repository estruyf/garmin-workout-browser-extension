import { useMemo, useState } from 'react';

import type { GarminWorkoutDetail } from '../lib/garmin-api';
import { jsonProfile } from '../lib/profile';
import WorkoutChart from './WorkoutChart';

type RawStep = Record<string, unknown>;

function stepLabel(step: RawStep): string {
  if (step.type === 'RepeatGroupDTO') {
    const n = Number(step.numberOfIterations ?? step.endConditionValue ?? 1);
    return `Repeat ×${n}`;
  }
  const key = (step.stepType as { stepTypeKey?: string } | undefined)?.stepTypeKey ?? '';
  const LABELS: Record<string, string> = {
    warmup: 'Warm-up',
    cooldown: 'Cool-down',
    interval: 'Interval',
    recovery: 'Recovery',
    rest: 'Rest',
  };
  return LABELS[key] ?? 'Step';
}

function fmtSecs(totalSec: number): string {
  const s = Math.round(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function stepMeta(step: RawStep): { duration: string; power: string } {
  const ec = step.endCondition as Record<string, unknown> | undefined;
  const duration = ec?.conditionTypeKey === 'time' ? fmtSecs(Number(step.endConditionValue ?? 0)) : '—';
  const t = step.targetType as Record<string, unknown> | undefined;
  const power =
    t?.workoutTargetTypeKey === 'power.zone' ? `${step.targetValueOne}–${step.targetValueTwo} W` : 'Free ride';
  return { duration, power };
}

interface EditFormProps {
  step: RawStep;
  onApply: (changes: Record<string, unknown>) => void;
  onRemove: () => void;
  onClose: () => void;
}

function StepEditForm({ step, onApply, onRemove, onClose }: EditFormProps) {
  const isRepeat = step.type === 'RepeatGroupDTO';
  const ec = step.endCondition as Record<string, unknown> | undefined;
  const isTime = !isRepeat && ec?.conditionTypeKey === 'time';
  const dSec = Number(step.endConditionValue ?? 0);
  const hasPower =
    !isRepeat && (step.targetType as Record<string, unknown> | undefined)?.workoutTargetTypeKey === 'power.zone';

  const [mins, setMins] = useState(Math.floor(dSec / 60));
  const [secs, setSecs] = useState(Math.round(dSec % 60));
  const [lo, setLo] = useState(Math.round(Number(step.targetValueOne ?? 0)));
  const [hi, setHi] = useState(Math.round(Number(step.targetValueTwo ?? 0)));
  const [reps, setReps] = useState(Number(step.numberOfIterations ?? step.endConditionValue ?? 1));

  function apply() {
    const ch: Record<string, unknown> = {};
    if (isRepeat) {
      const n = Math.max(1, Math.round(reps));
      ch.numberOfIterations = n;
      ch.endConditionValue = n;
    } else {
      if (isTime) ch.endConditionValue = Math.max(0, mins * 60 + secs);
      if (hasPower) {
        ch.targetValueOne = Math.max(0, lo);
        ch.targetValueTwo = Math.max(0, hi);
      }
    }
    onApply(ch);
  }

  return (
    <div className="mt-1 space-y-2 rounded-lg bg-gray-50 px-3 py-3">
      {isRepeat && (
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-gray-500">Repeats</span>
          <input
            type="number"
            min={1}
            value={reps}
            onChange={(e) => setReps(parseInt(e.target.value, 10) || 1)}
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
        </div>
      )}
      {isTime && (
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-gray-500">Duration</span>
          <input
            type="number"
            min={0}
            value={mins}
            onChange={(e) => setMins(parseInt(e.target.value, 10) || 0)}
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-400">min</span>
          <input
            type="number"
            min={0}
            max={59}
            value={secs}
            onChange={(e) => setSecs(parseInt(e.target.value, 10) || 0)}
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-400">sec</span>
        </div>
      )}
      {hasPower && (
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-gray-500">Power</span>
          <input
            type="number"
            min={0}
            value={lo}
            onChange={(e) => setLo(parseInt(e.target.value, 10) || 0)}
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            min={0}
            value={hi}
            onChange={(e) => setHi(parseInt(e.target.value, 10) || 0)}
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-400">W</span>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={apply}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded-md px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
        >
          Remove step
        </button>
      </div>
    </div>
  );
}

interface StepListProps {
  steps: RawStep[];
  segIdx: number;
  pathPrefix: number[];
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onEdit: (segIdx: number, path: number[], changes: Record<string, unknown>) => void;
  onRemove: (segIdx: number, path: number[]) => void;
}

function StepList({ steps, segIdx, pathPrefix, depth, selectedKey, onSelect, onEdit, onRemove }: StepListProps) {
  return (
    <ul className={depth > 0 ? 'ml-3 space-y-1 border-l border-gray-100 pl-3' : 'space-y-1'}>
      {steps.map((step, i) => {
        const path = [...pathPrefix, i];
        const nodeKey = `${segIdx}:${path.join(',')}`;
        const isSelected = selectedKey === nodeKey;
        const isRepeat = step.type === 'RepeatGroupDTO';
        const children = isRepeat ? ((step.workoutSteps ?? []) as RawStep[]) : null;
        const { duration, power } = stepMeta(step);

        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect(isSelected ? null : nodeKey)}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition ${
                isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-gray-50'
              }`}
            >
              <span className="flex-1 font-medium text-gray-800">{stepLabel(step)}</span>
              {!isRepeat && (
                <>
                  <span className="shrink-0 tabular-nums text-xs text-gray-400">{duration}</span>
                  <span className="shrink-0 text-xs text-gray-400">{power}</span>
                </>
              )}
            </button>
            {isSelected && (
              <StepEditForm
                step={step}
                onApply={(ch) => { onEdit(segIdx, path, ch); onSelect(null); }}
                onRemove={() => { onRemove(segIdx, path); onSelect(null); }}
                onClose={() => onSelect(null)}
              />
            )}
            {children && (
              <StepList
                steps={children}
                segIdx={segIdx}
                pathPrefix={path}
                depth={depth + 1}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface WorkoutEditProps {
  detail: GarminWorkoutDetail;
  ftp: number;
  onEdit: (segIdx: number, path: number[], changes: Record<string, unknown>) => void;
  onRemove: (segIdx: number, path: number[]) => void;
}

export default function WorkoutEdit({ detail, ftp, onEdit, onRemove }: WorkoutEditProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const segments = (detail.workoutSegments ?? []) as Array<{ workoutSteps?: RawStep[] }>;
  const profile = useMemo(() => jsonProfile(detail), [detail]);

  return (
    <div className="py-4">
      {profile.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 p-3 mx-4">
          <WorkoutChart blocks={profile} ftp={ftp} />
        </div>
      )}
      <div className="px-4">
        {segments.length === 0 ? (
          <p className="text-sm text-gray-400">No steps to edit.</p>
        ) : (
          segments.map((seg, si) => (
            <StepList
              key={si}
              steps={seg.workoutSteps ?? []}
              segIdx={si}
              pathPrefix={[]}
              depth={0}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}
