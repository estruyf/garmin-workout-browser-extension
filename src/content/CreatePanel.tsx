import { useEffect, useMemo, useState } from 'react';

import { createWorkout, workoutUrl } from '../lib/garmin-api';
import { durationLabel, jsonProfile, totalDuration } from '../lib/profile';
import {
  blankWorkout,
  buildFromBlocks,
  templateDuration,
  TEMPLATES,
  type WorkoutDraft,
  type WorkoutTemplate,
} from '../lib/workout-builder';
import {
  addStepAtPath,
  applyStepEdit,
  countSteps,
  removeStepAtPath,
  renumberSteps,
  reorderStepsAtPath,
  type RawStep,
} from '../lib/workout-steps';
import PowerZones from './PowerZones';
import SchedulePicker from './SchedulePicker';
import Shell from './Shell';
import WorkoutEdit from './WorkoutEdit';

type Status =
  | { state: 'idle' }
  | { state: 'creating' }
  | { state: 'done'; workoutId: number; workoutName: string; workoutType?: string }
  | { state: 'error'; message: string };

interface Props {
  ftp: string;
  setFtp: (value: string) => void;
  onClose: () => void;
  onBack: () => void;
  onCreated: () => void;
}

export default function CreatePanel({ ftp, setFtp, onClose, onBack, onCreated }: Props) {
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<WorkoutDraft>(() => blankWorkout());
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [showTemplates, setShowTemplates] = useState(true);
  /** The template the draft still matches — cleared as soon as a step is edited. */
  const [appliedTemplate, setAppliedTemplate] = useState<WorkoutTemplate | null>(null);
  /** A template waiting on "this replaces your steps" confirmation. */
  const [pendingTemplate, setPendingTemplate] = useState<WorkoutTemplate | null>(null);

  const ftpValue = Number(ftp);
  const ftpNum = Number.isFinite(ftpValue) && ftpValue > 0 ? Math.round(ftpValue) : 0;

  const profile = useMemo(() => jsonProfile(draft), [draft]);
  const stepCount = useMemo(() => countSteps(draft), [draft]);
  const duration = durationLabel(totalDuration(profile));
  const canCreate = name.trim().length > 0 && stepCount > 0 && status.state !== 'creating';

  // A template's targets are %FTP under the hood, so re-resolve them to watts
  // when the FTP changes — as long as the steps are still the template's own.
  useEffect(() => {
    if (!appliedTemplate || ftpNum <= 0) return;
    setDraft((prev) => buildFromBlocks(prev.workoutName, prev.description, appliedTemplate.blocks, ftpNum));
  }, [appliedTemplate, ftpNum]);

  function applyTemplate(template: WorkoutTemplate) {
    setDraft(buildFromBlocks(name, description, template.blocks, ftpNum));
    setAppliedTemplate(template);
    setPendingTemplate(null);
    setStatus({ state: 'idle' });
    if (!nameTouched) setName(template.name);
  }

  function pickTemplate(template: WorkoutTemplate) {
    if (stepCount > 0 && appliedTemplate?.id !== template.id) setPendingTemplate(template);
    else applyTemplate(template);
  }

  function startEmpty() {
    setDraft(blankWorkout());
    setAppliedTemplate(null);
    setPendingTemplate(null);
    setStatus({ state: 'idle' });
  }

  /** Any hand edit means the draft is no longer the template's to rebuild. */
  function edit(next: WorkoutDraft) {
    setAppliedTemplate(null);
    setDraft(next);
  }

  function handleStepEdit(segIdx: number, path: number[], changes: Record<string, unknown>) {
    edit(applyStepEdit(draft, segIdx, path, changes));
  }

  function handleStepRemove(segIdx: number, path: number[]) {
    edit(removeStepAtPath(draft, segIdx, path));
  }

  function handleStepReorder(segIdx: number, parentPath: number[], fromIdx: number, toIdx: number) {
    edit(reorderStepsAtPath(draft, segIdx, parentPath, fromIdx, toIdx));
  }

  function handleStepAdd(segIdx: number, parentPath: number[], step: RawStep) {
    edit(addStepAtPath(draft, segIdx, parentPath, step));
  }

  function reset() {
    setName('');
    setNameTouched(false);
    setDescription('');
    setDraft(blankWorkout());
    setAppliedTemplate(null);
    setShowTemplates(true);
    setStatus({ state: 'idle' });
  }

  async function onCreate() {
    if (!canCreate) return;
    setStatus({ state: 'creating' });
    try {
      const payload = renumberSteps({
        ...draft,
        workoutName: name.trim(),
        description: description.trim(),
      });
      const created = await createWorkout(payload);
      setStatus({
        state: 'done',
        workoutId: created.workoutId,
        workoutName: payload.workoutName,
        workoutType: created.sportType?.sportTypeKey ?? 'cycling',
      });
      onCreated();
    } catch (err) {
      setStatus({ state: 'error', message: (err as Error).message });
    }
  }

  const footer = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCreate}
        disabled={!canCreate}
        className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {status.state === 'creating' ? 'Creating…' : 'Create in Garmin'}
      </button>
      {stepCount > 0 && (
        <button
          type="button"
          onClick={startEmpty}
          className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Clear steps
        </button>
      )}
    </div>
  );

  return (
    <Shell
      title="Create a workout"
      subtitle={[stepCount ? `${stepCount} step${stepCount === 1 ? '' : 's'}` : 'Cycling', duration]
        .filter(Boolean)
        .join(' · ')}
      onClose={onClose}
      onBack={onBack}
      footer={footer}
    >
      <div className="space-y-4 px-4 py-4">
        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">Workout name</span>
            <input
              type="text"
              value={name}
              placeholder="e.g. Tuesday threshold"
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="w-32">
            <span className="mb-1 block text-xs font-medium text-gray-600">FTP (watts)</span>
            <input
              type="number"
              min={1}
              value={ftp}
              placeholder="e.g. 245"
              onChange={(e) => setFtp(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Description (optional)</span>
          <textarea
            value={description}
            rows={2}
            placeholder="Notes that show up on your device"
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-y rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          />
        </label>

        {/* Templates */}
        <div className="rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="text-xs font-medium text-gray-600">Start from a template</span>
            <span className="text-xs text-gray-400">{showTemplates ? 'Hide' : 'Show'}</span>
          </button>

          {showTemplates && (
            <div className="space-y-2 border-t border-gray-100 px-3 py-3">
              {ftpNum <= 0 && (
                <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  Enter your FTP first — templates set their power targets as a percentage of it.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((template) => {
                  const isApplied = appliedTemplate?.id === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      disabled={ftpNum <= 0}
                      onClick={() => pickTemplate(template)}
                      className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        isApplied
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800">{template.name}</span>
                        <span className="shrink-0 text-xs text-gray-400">
                          {durationLabel(templateDuration(template))}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">{template.summary}</span>
                    </button>
                  );
                })}
              </div>

              {pendingTemplate && (
                <div className="space-y-2 rounded-lg bg-amber-50 px-3 py-2.5">
                  <p className="text-xs text-amber-900">
                    Replace the current steps with “{pendingTemplate.name}”?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyTemplate(pendingTemplate)}
                      className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-700"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingTemplate(null)}
                      className="rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-400">
                Templates are a starting point — tweak any step below before you create the workout.
              </p>
            </div>
          )}
        </div>

        {ftpNum > 0 && <PowerZones ftp={ftpNum} />}

        {status.state === 'error' && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{status.message}</div>
        )}

        {status.state === 'done' && (
          <div className="space-y-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">
            <p>
              Created <span className="font-semibold">{status.workoutName}</span> in your Garmin library.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={workoutUrl(status.workoutId, status.workoutType)}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                Open workout
              </a>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-800 transition hover:bg-green-100"
              >
                Create another
              </button>
              <button
                type="button"
                onClick={onBack}
                className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-800 transition hover:bg-green-100"
              >
                Back to workouts
              </button>
            </div>
          </div>
        )}

        {status.state === 'done' && (
          <div className="rounded-lg border border-gray-200 px-3 py-3">
            <SchedulePicker key={status.workoutId} workoutId={status.workoutId} label="Put it on a date" />
          </div>
        )}
      </div>

      <div className="border-t border-gray-100">
        {stepCount === 0 && (
          <p className="px-4 pt-4 text-sm text-gray-400">
            No steps yet — pick a template above, or add your first step below.
          </p>
        )}
        <WorkoutEdit
          detail={draft}
          ftp={ftpNum}
          onEdit={handleStepEdit}
          onRemove={handleStepRemove}
          onReorder={handleStepReorder}
          onAdd={handleStepAdd}
        />
      </div>
    </Shell>
  );
}
