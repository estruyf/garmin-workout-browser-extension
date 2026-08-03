import { useMemo, useState } from 'react';

import { jsonProfile } from '../lib/profile';
import { createRepeatGroup, createStep, type StepKind } from '../lib/workout-builder';
import type { RawStep } from '../lib/workout-steps';
import WorkoutChart from './WorkoutChart';

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

// ─── Step type catalogue ─────────────────────────────────────────────────────

const STEP_TYPE_DEFS = [
  { key: 'interval', label: 'Interval' },
  { key: 'warmup', label: 'Warm-up' },
  { key: 'cooldown', label: 'Cool-down' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'rest', label: 'Rest' },
  { key: 'repeat', label: 'Repeat group' },
] as const;

function buildNewStep(
  typeKey: string,
  mins: number,
  secs: number,
  withPower: boolean,
  lo: number,
  hi: number,
  reps: number,
): RawStep {
  if (typeKey === 'repeat') return createRepeatGroup(reps);
  return createStep({
    kind: typeKey as StepKind,
    durationSec: mins * 60 + secs,
    watts: withPower ? [Math.min(lo, hi), Math.max(lo, hi)] : undefined,
  });
}

// ─── Power target input (watts, or % of FTP when the FTP is known) ────────────

interface PowerFieldsProps {
  ftp: number;
  lo: number;
  hi: number;
  onChange: (lo: number, hi: number) => void;
  /** Inputs sit on a tinted background in the add form and need to stay white. */
  white?: boolean;
}

function PowerFields({ ftp, lo, hi, onChange, white }: PowerFieldsProps) {
  const [asPct, setAsPct] = useState(false);
  const pct = ftp > 0 && asPct;
  const toField = (watts: number) => (pct ? Math.round((watts / ftp) * 100) : watts);
  const toWatts = (value: number) => (pct ? Math.round((value / 100) * ftp) : value);
  const input = `w-20 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500${white ? ' bg-white' : ''}`;

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-xs text-gray-500">Power</span>
      <input
        type="number"
        min={0}
        value={toField(lo)}
        onChange={(e) => onChange(toWatts(parseInt(e.target.value, 10) || 0), hi)}
        className={input}
      />
      <span className="text-xs text-gray-400">–</span>
      <input
        type="number"
        min={0}
        value={toField(hi)}
        onChange={(e) => onChange(lo, toWatts(parseInt(e.target.value, 10) || 0))}
        className={input}
      />
      {ftp > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setAsPct((v) => !v)}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
            title="Switch between watts and % of FTP"
          >
            {pct ? '% FTP' : 'W'}
          </button>
          <span className="text-xs text-gray-400">
            {pct ? `${lo}–${hi} W` : `${Math.round((lo / ftp) * 100)}–${Math.round((hi / ftp) * 100)}% FTP`}
          </span>
        </>
      ) : (
        <span className="text-xs text-gray-400">W</span>
      )}
    </div>
  );
}

// ─── Drag-and-drop tracker (module-level to coordinate between list instances) ─

let activeDragListId: string | null = null;

// ─── Edit form (existing step) ────────────────────────────────────────────────

interface EditFormProps {
  step: RawStep;
  ftp: number;
  onApply: (changes: Record<string, unknown>) => void;
  onRemove: () => void;
  onClose: () => void;
}

function StepEditForm({ step, ftp, onApply, onRemove, onClose }: EditFormProps) {
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
        <PowerFields
          ftp={ftp}
          lo={lo}
          hi={hi}
          onChange={(nextLo, nextHi) => {
            setLo(nextLo);
            setHi(nextHi);
          }}
        />
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

// ─── Add step form ────────────────────────────────────────────────────────────

interface AddStepFormProps {
  ftp: number;
  onAdd: (step: RawStep) => void;
  onClose: () => void;
}

function AddStepForm({ ftp, onAdd, onClose }: AddStepFormProps) {
  const [typeKey, setTypeKey] = useState('interval');
  const [mins, setMins] = useState(5);
  const [secs, setSecs] = useState(0);
  // With a known FTP a power target is the common case, so start it on and
  // prefilled with an endurance-ish band the athlete can nudge.
  const [withPower, setWithPower] = useState(ftp > 0);
  const [lo, setLo] = useState(ftp > 0 ? Math.round(ftp * 0.75) : 0);
  const [hi, setHi] = useState(ftp > 0 ? Math.round(ftp * 0.85) : 0);
  const [reps, setReps] = useState(3);

  const isRepeat = typeKey === 'repeat';

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/40 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="w-20 text-xs text-gray-500">Type</span>
        <select
          value={typeKey}
          onChange={(e) => setTypeKey(e.target.value)}
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
        >
          {STEP_TYPE_DEFS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {isRepeat ? (
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-gray-500">Repeats</span>
          <input
            type="number"
            min={1}
            value={reps}
            onChange={(e) => setReps(parseInt(e.target.value, 10) || 1)}
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-gray-500">Duration</span>
            <input
              type="number"
              min={0}
              value={mins}
              onChange={(e) => setMins(parseInt(e.target.value, 10) || 0)}
              className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-400">min</span>
            <input
              type="number"
              min={0}
              max={59}
              value={secs}
              onChange={(e) => setSecs(parseInt(e.target.value, 10) || 0)}
              className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-400">sec</span>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={withPower}
              onChange={(e) => setWithPower(e.target.checked)}
              className="rounded"
            />
            Power target
          </label>

          {withPower && (
            <PowerFields
              ftp={ftp}
              lo={lo}
              hi={hi}
              white
              onChange={(nextLo, nextHi) => {
                setLo(nextLo);
                setHi(nextHi);
              }}
            />
          )}
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onAdd(buildNewStep(typeKey, mins, secs, withPower, lo, hi, reps))}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
        >
          Add step
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Drag handle icon ─────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 16" fill="currentColor" className="size-3.5">
      <circle cx="2.5" cy="2.5" r="1.5" />
      <circle cx="7.5" cy="2.5" r="1.5" />
      <circle cx="2.5" cy="8" r="1.5" />
      <circle cx="7.5" cy="8" r="1.5" />
      <circle cx="2.5" cy="13.5" r="1.5" />
      <circle cx="7.5" cy="13.5" r="1.5" />
    </svg>
  );
}

// ─── Step list ────────────────────────────────────────────────────────────────

interface StepListProps {
  steps: RawStep[];
  segIdx: number;
  pathPrefix: number[];
  depth: number;
  ftp: number;
  selectedKey: string | null;
  addingKey: string | null;
  onSelect: (key: string | null) => void;
  onSetAddingKey: (key: string | null) => void;
  onEdit: (segIdx: number, path: number[], changes: Record<string, unknown>) => void;
  onRemove: (segIdx: number, path: number[]) => void;
  onReorder: (segIdx: number, parentPath: number[], fromIdx: number, toIdx: number) => void;
  onAdd: (segIdx: number, parentPath: number[], step: RawStep) => void;
}

function StepList({
  steps,
  segIdx,
  pathPrefix,
  depth,
  ftp,
  selectedKey,
  addingKey,
  onSelect,
  onSetAddingKey,
  onEdit,
  onRemove,
  onReorder,
  onAdd,
}: StepListProps) {
  const listId = `${segIdx}:${pathPrefix.join(',')}`;
  const addKey = `add:${listId}`;

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ idx: number; pos: 'before' | 'after' } | null>(null);

  function startDrag(e: React.DragEvent, i: number) {
    activeDragListId = listId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    setDragFrom(i);
  }

  function endDrag() {
    activeDragListId = null;
    setDragFrom(null);
    setDropTarget(null);
  }

  function onItemDragOver(e: React.DragEvent<HTMLLIElement>, i: number) {
    if (activeDragListId !== listId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTarget((prev) => (prev?.idx === i && prev.pos === pos ? prev : { idx: i, pos }));
  }

  function onItemDrop(e: React.DragEvent<HTMLLIElement>, i: number) {
    if (activeDragListId !== listId) return;
    e.preventDefault();
    e.stopPropagation();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const toIdx = pos === 'before' ? i : i + 1;
    if (toIdx !== from && toIdx !== from + 1) {
      onReorder(segIdx, pathPrefix, from, toIdx);
    }
    endDrag();
  }

  function onListDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTarget(null);
    }
  }

  return (
    <div
      className={depth > 0 ? 'ml-3 border-l border-gray-100 pl-3' : ''}
      onDragLeave={onListDragLeave}
    >
      <ul className="space-y-0">
        {steps.map((step, i) => {
          const path = [...pathPrefix, i];
          const nodeKey = `${segIdx}:${path.join(',')}`;
          const isSelected = selectedKey === nodeKey;
          const isRepeat = step.type === 'RepeatGroupDTO';
          const children = isRepeat ? ((step.workoutSteps ?? []) as RawStep[]) : null;
          const { duration, power } = stepMeta(step);
const isDragging = dragFrom === i;
          const isDropBefore = dropTarget?.idx === i && dropTarget.pos === 'before' && !isDragging;
          const isDropAfter = dropTarget?.idx === i && dropTarget.pos === 'after' && !isDragging;

          return (
            <li
              key={i}
              className="relative py-0.5"
              onDragOver={(e) => onItemDragOver(e, i)}
              onDrop={(e) => onItemDrop(e, i)}
            >
              {/* Drop-before indicator */}
              {isDropBefore && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-full bg-blue-400" />
              )}

              <div
                draggable
                onDragStart={(e) => startDrag(e, i)}
                onDragEnd={endDrag}
                className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-sm transition ${
                  isDragging
                    ? 'opacity-40 ring-1 ring-inset ring-gray-200'
                    : isSelected
                      ? 'bg-blue-50 ring-1 ring-inset ring-blue-200'
                      : 'hover:bg-gray-50'
                }`}
              >
                {/* Drag handle */}
                <span className="shrink-0 cursor-grab text-gray-300 active:cursor-grabbing">
                  <GripIcon />
                </span>

                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : nodeKey)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <span className="flex-1 font-medium text-gray-800">{stepLabel(step)}</span>
                  {!isRepeat && (
                    <>
                      <span className="shrink-0 tabular-nums text-xs text-gray-400">{duration}</span>
                      <span className="shrink-0 text-xs text-gray-400">{power}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => { onRemove(segIdx, path); onSelect(null); }}
                  aria-label="Delete step"
                  className="shrink-0 rounded p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                    <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {isSelected && (
                <StepEditForm
                  step={step}
                  ftp={ftp}
                  onApply={(ch) => { onEdit(segIdx, path, ch); onSelect(null); }}
                  onRemove={() => { onRemove(segIdx, path); onSelect(null); }}
                  onClose={() => onSelect(null)}
                />
              )}

              {/* Nested steps inside a repeat group — stop drag events bubbling to this list */}
              {children !== null && (
                <div
                  className="mt-1"
                  onDragOver={(e) => { if (activeDragListId !== listId) e.stopPropagation(); }}
                  onDrop={(e) => { if (activeDragListId !== listId) e.stopPropagation(); }}
                >
                  <StepList
                    steps={children}
                    segIdx={segIdx}
                    pathPrefix={path}
                    depth={depth + 1}
                    ftp={ftp}
                    selectedKey={selectedKey}
                    addingKey={addingKey}
                    onSelect={onSelect}
                    onSetAddingKey={onSetAddingKey}
                    onEdit={onEdit}
                    onRemove={onRemove}
                    onReorder={onReorder}
                    onAdd={onAdd}
                  />
                </div>
              )}

              {/* Drop-after indicator */}
              {isDropAfter && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-400" />
              )}
            </li>
          );
        })}
      </ul>

      {/* Add step at this level */}
      {addingKey === addKey ? (
        <AddStepForm
          ftp={ftp}
          onAdd={(s) => { onAdd(segIdx, pathPrefix, s); onSetAddingKey(null); }}
          onClose={() => onSetAddingKey(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => { onSelect(null); onSetAddingKey(addKey); }}
          className="mt-2 flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-500 transition hover:bg-blue-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
            <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
          </svg>
          Add step
        </button>
      )}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

/** Anything carrying a Garmin step tree — a saved workout or an unsaved draft. */
export interface EditableWorkout {
  workoutSegments?: unknown;
  [key: string]: unknown;
}

export interface WorkoutEditProps {
  detail: EditableWorkout;
  /** Used to colour the preview and to offer % FTP power entry; 0 when unknown. */
  ftp: number;
  onEdit: (segIdx: number, path: number[], changes: Record<string, unknown>) => void;
  onRemove: (segIdx: number, path: number[]) => void;
  onReorder: (segIdx: number, parentPath: number[], fromIdx: number, toIdx: number) => void;
  onAdd: (segIdx: number, parentPath: number[], step: RawStep) => void;
}

export default function WorkoutEdit({ detail, ftp, onEdit, onRemove, onReorder, onAdd }: WorkoutEditProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
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
              ftp={ftp}
              selectedKey={selectedKey}
              addingKey={addingKey}
              onSelect={setSelectedKey}
              onSetAddingKey={setAddingKey}
              onEdit={onEdit}
              onRemove={onRemove}
              onReorder={onReorder}
              onAdd={onAdd}
            />
          ))
        )}
      </div>
    </div>
  );
}
