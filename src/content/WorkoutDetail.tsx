import { useEffect, useMemo, useState } from 'react';

import {
  createWorkout,
  deleteWorkout,
  getWorkoutDetail,
  updateWorkout,
  workoutUrl,
  type GarminWorkoutDetail,
  type WorkoutSummary,
} from '../lib/garmin-api';
import { downloadJson, downloadText, fileStem } from '../lib/download';
import { durationLabel, jsonProfile, totalDuration, type ProfileBlock } from '../lib/profile';
import { addStepAtPath, applyStepEdit, removeStepAtPath, reorderStepsAtPath } from '../lib/workout-steps';
import { canExportZwo, garminToZwo } from '../lib/zwo-export';
import PowerZones from './PowerZones';
import SchedulePicker from './SchedulePicker';
import Shell from './Shell';
import WorkoutChart from './WorkoutChart';
import WorkoutEdit from './WorkoutEdit';
import { CopyIcon, DownloadIcon, EditIcon, TrashIcon } from './icons';

interface Props {
  summary: WorkoutSummary;
  ftp: string;
  setFtp: (value: string) => void;
  onClose: () => void;
  onBack: () => void;
  onDeleted: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: GarminWorkoutDetail };

type UpdateStatus = { state: 'idle' } | { state: 'updating' } | { state: 'done' } | { state: 'error'; message: string };

type EditSaveStatus = { state: 'idle' } | { state: 'saving' } | { state: 'error'; message: string };

type DownloadStatus =
  | { state: 'idle' }
  | { state: 'done'; filename: string; warnings: string[] }
  | { state: 'error'; message: string };

type ClonePhase =
  | { phase: 'idle' }
  | { phase: 'naming'; name: string }
  | { phase: 'cloning'; name: string }
  | { phase: 'done'; workoutId: number; workoutName: string; sportType?: string }
  | { phase: 'error'; name: string; message: string };

function sportLabel(key?: string): string {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

function scaleSteps(steps: unknown[], scale: number): void {
  for (const step of steps as Array<Record<string, unknown>>) {
    if ((step.targetType as Record<string, unknown> | undefined)?.workoutTargetTypeKey === 'power.zone') {
      if (typeof step.targetValueOne === 'number') step.targetValueOne = Math.round(step.targetValueOne * scale);
      if (typeof step.targetValueTwo === 'number') step.targetValueTwo = Math.round(step.targetValueTwo * scale);
    }
    if (Array.isArray(step.workoutSteps)) scaleSteps(step.workoutSteps, scale);
  }
}

function buildClonePayload(detail: GarminWorkoutDetail, name: string): Record<string, unknown> {
  const p = JSON.parse(JSON.stringify(detail)) as Record<string, unknown>;
  for (const k of [
    'workoutId', 'ownerId', 'updatedDate', 'createdDate', 'author',
    'workoutProvider', 'workoutSourceId', 'consumer', 'consumerName',
    'consumerImageURL', 'consumerWebsiteURL',
  ]) delete p[k];
  p.workoutName = name;
  p.estimatedDurationInSecs = 0;
  p.estimatedDistanceInMeters = 0;
  p.estimatedDistanceUnit = { unitKey: null };
  p.avgTrainingSpeed = 0;
  p.estimateType = null;
  const clearIds = (steps: unknown[]): void => {
    for (const s of steps) {
      if (s && typeof s === 'object') {
        const step = s as Record<string, unknown>;
        step.stepId = null;
        if (Array.isArray(step.workoutSteps)) clearIds(step.workoutSteps);
      }
    }
  };
  for (const seg of (Array.isArray(p.workoutSegments) ? p.workoutSegments : []) as Array<{ workoutSteps?: unknown[] }>) {
    if (Array.isArray(seg.workoutSteps)) clearIds(seg.workoutSteps);
  }
  return p;
}

export default function WorkoutDetail({ summary, ftp, setFtp, onClose, onBack, onDeleted }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [baseFtp, setBaseFtp] = useState<number>(() => {
    const n = Number(ftp);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  });

  // Edit sub-view
  const [subView, setSubView] = useState<'show' | 'edit'>('show');
  const [editedDetail, setEditedDetail] = useState<GarminWorkoutDetail | null>(null);
  const [editSaveStatus, setEditSaveStatus] = useState<EditSaveStatus>({ state: 'idle' });

  // Clone
  const [cloneState, setCloneState] = useState<ClonePhase>({ phase: 'idle' });

  // Download
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({ state: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setDownloadStatus({ state: 'idle' });
    getWorkoutDetail(summary.workoutId)
      .then((detail) => { if (!cancelled) setState({ status: 'ready', detail }); })
      .catch((err: unknown) => { if (!cancelled) setState({ status: 'error', message: (err as Error).message }); });
    return () => { cancelled = true; };
  }, [summary.workoutId]);

  const ftpValue = Number(ftp);
  const ftpNum = Number.isFinite(ftpValue) && ftpValue > 0 ? Math.round(ftpValue) : 0;
  const ftpChanged = ftpNum > 0 && baseFtp > 0 && ftpNum !== baseFtp;

  const profile = useMemo<ProfileBlock[]>(() => (state.status === 'ready' ? jsonProfile(state.detail) : []), [state]);
  const duration = useMemo(() => durationLabel(totalDuration(profile)), [profile]);

  const sportType =
    summary.sportType?.sportTypeKey ??
    (state.status === 'ready' ? state.detail.sportType?.sportTypeKey : undefined);
  const description = (state.status === 'ready' ? state.detail.description : summary.description) ?? '';
  const meta = [sportLabel(sportType), duration].filter(Boolean).join(' · ');

  // ZWO power is a fraction of FTP, so the watt targets have to be divided by the
  // FTP they were written against — an FTP typed but not yet applied is not that.
  const zwoFtp = baseFtp > 0 ? baseFtp : ftpNum;

  // ZWO is a cycling, %FTP-based format, so it needs both a bike workout and an FTP.
  const zwoBlockedReason = !canExportZwo(sportType)
    ? 'ZWO export is only available for cycling workouts.'
    : zwoFtp <= 0
      ? 'Set your FTP above to export this workout as ZWO.'
      : undefined;
  const zwoAvailable = !zwoBlockedReason;

  async function onUpdateFtp() {
    if (state.status !== 'ready' || !ftpChanged) return;
    setUpdateStatus({ state: 'updating' });
    try {
      const scale = ftpNum / baseFtp;
      const payload = JSON.parse(JSON.stringify(state.detail)) as Record<string, unknown>;
      for (const seg of (Array.isArray(payload.workoutSegments) ? payload.workoutSegments : []) as Array<{
        workoutSteps?: unknown[];
      }>) {
        if (Array.isArray(seg.workoutSteps)) scaleSteps(seg.workoutSteps, scale);
      }
      await updateWorkout(summary.workoutId, payload);
      setBaseFtp(ftpNum);
      setState({ status: 'ready', detail: payload as GarminWorkoutDetail });
      setUpdateStatus({ state: 'done' });
    } catch (err) {
      setUpdateStatus({ state: 'error', message: (err as Error).message });
    }
  }

  function enterEdit() {
    if (state.status !== 'ready') return;
    setEditedDetail(JSON.parse(JSON.stringify(state.detail)) as GarminWorkoutDetail);
    setEditSaveStatus({ state: 'idle' });
    setSubView('edit');
  }

  function cancelEdit() {
    setSubView('show');
    setEditedDetail(null);
    setEditSaveStatus({ state: 'idle' });
  }

  function handleStepEdit(segIdx: number, path: number[], changes: Record<string, unknown>) {
    setEditedDetail((prev) => (prev ? applyStepEdit(prev, segIdx, path, changes) : prev));
  }

  function handleStepRemove(segIdx: number, path: number[]) {
    setEditedDetail((prev) => (prev ? removeStepAtPath(prev, segIdx, path) : prev));
  }

  function handleStepReorder(segIdx: number, parentPath: number[], fromIdx: number, toIdx: number) {
    setEditedDetail((prev) => (prev ? reorderStepsAtPath(prev, segIdx, parentPath, fromIdx, toIdx) : prev));
  }

  function handleStepAdd(segIdx: number, parentPath: number[], step: Record<string, unknown>) {
    setEditedDetail((prev) => (prev ? addStepAtPath(prev, segIdx, parentPath, step) : prev));
  }

  async function handleEditSave() {
    if (!editedDetail) return;
    setEditSaveStatus({ state: 'saving' });
    try {
      await updateWorkout(summary.workoutId, editedDetail);
      setState({ status: 'ready', detail: editedDetail });
      setSubView('show');
      setEditedDetail(null);
      setEditSaveStatus({ state: 'idle' });
    } catch (err) {
      setEditSaveStatus({ state: 'error', message: (err as Error).message });
    }
  }

  function onDownloadJson() {
    if (state.status !== 'ready') return;
    const filename = `${fileStem(summary.workoutName)}.json`;
    downloadJson(state.detail, filename);
    setDownloadStatus({ state: 'done', filename, warnings: [] });
  }

  function onDownloadZwo() {
    if (state.status !== 'ready') return;
    try {
      const { xml, warnings } = garminToZwo(state.detail, zwoFtp);
      const filename = `${fileStem(summary.workoutName)}.zwo`;
      downloadText(xml, filename, 'application/xml');
      setDownloadStatus({ state: 'done', filename, warnings });
    } catch (err) {
      setDownloadStatus({ state: 'error', message: (err as Error).message });
    }
  }

  async function onClone() {
    if (state.status !== 'ready') return;
    const name =
      cloneState.phase === 'naming' || cloneState.phase === 'error' ? cloneState.name.trim() : '';
    if (!name) return;
    setCloneState({ phase: 'cloning', name });
    try {
      const payload = buildClonePayload(state.detail, name);
      const created = await createWorkout(payload);
      setCloneState({
        phase: 'done',
        workoutId: created.workoutId,
        workoutName: name,
        sportType: created.sportType?.sportTypeKey ?? sportType,
      });
    } catch (err) {
      setCloneState({ phase: 'error', name, message: (err as Error).message });
    }
  }

  async function onDelete() {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteWorkout(summary.workoutId);
      onDeleted();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

  const editFooter = subView === 'edit' ? (
    <div className="space-y-2">
      {editSaveStatus.state === 'error' && (
        <p className="text-xs text-red-600">{editSaveStatus.message}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleEditSave}
          disabled={editSaveStatus.state === 'saving'}
          className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-gray-300"
        >
          {editSaveStatus.state === 'saving' ? 'Saving…' : 'Save workout'}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : undefined;

  const editButton = subView === 'show' && state.status === 'ready' ? (
    <button
      type="button"
      onClick={enterEdit}
      aria-label="Edit workout steps"
      className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
    >
      <EditIcon />
    </button>
  ) : undefined;

  return (
    <Shell
      title={subView === 'edit' ? 'Edit workout' : summary.workoutName}
      subtitle={subView === 'edit' ? summary.workoutName : (meta || undefined)}
      onClose={onClose}
      onBack={subView === 'edit' ? cancelEdit : onBack}
      headerRight={editButton}
      footer={editFooter}
    >
      {subView === 'edit' && editedDetail ? (
        <WorkoutEdit detail={editedDetail} ftp={ftpNum} onEdit={handleStepEdit} onRemove={handleStepRemove} onReorder={handleStepReorder} onAdd={handleStepAdd} />
      ) : (
        <div className="space-y-4 px-4 py-4">
          {state.status === 'loading' && (
            <p className="py-6 text-center text-sm text-gray-400">Loading workout…</p>
          )}

          {state.status === 'error' && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</div>
          )}

          {state.status === 'ready' && (
            <>
              {profile.length > 0 ? (
                <div className="rounded-lg border border-gray-200 p-3">
                  <span className="mb-2 block text-xs font-medium text-gray-600">Power profile</span>
                  <WorkoutChart blocks={profile} ftp={ftpNum} />
                </div>
              ) : (
                <p className="text-sm text-gray-400">This workout has no chartable power steps.</p>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">FTP (watts)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={ftp}
                    placeholder="e.g. 245"
                    onChange={(e) => {
                      setFtp(e.target.value);
                      setUpdateStatus({ state: 'idle' });
                    }}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={onUpdateFtp}
                    disabled={!ftpChanged || updateStatus.state === 'updating'}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    {updateStatus.state === 'updating' ? 'Updating…' : 'Update'}
                  </button>
                </div>
                {updateStatus.state === 'error' && (
                  <p className="mt-1 text-xs text-red-600">{updateStatus.message}</p>
                )}
                {updateStatus.state === 'done' && (
                  <p className="mt-1 text-xs text-green-600">Workout power targets updated.</p>
                )}
              </label>

              {ftpNum > 0 && <PowerZones ftp={ftpNum} />}

              {description && <p className="whitespace-pre-line text-sm text-gray-600">{description}</p>}

              <a
                href={workoutUrl(summary.workoutId, sportType)}
                target="_blank"
                rel="noreferrer"
                className="block w-full rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Open in Garmin Connect
              </a>

              {/* Schedule */}
              <div className="border-t border-gray-100 pt-3">
                <SchedulePicker key={summary.workoutId} workoutId={summary.workoutId} label="Add to your calendar" />
              </div>

              {/* Download */}
              <div className="space-y-2 border-t border-gray-100 pt-3">
                <span className="block text-xs font-medium text-gray-600">Download a copy</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onDownloadJson}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-800"
                  >
                    <DownloadIcon /> JSON
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadZwo}
                    disabled={!zwoAvailable}
                    title={zwoBlockedReason}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <DownloadIcon /> ZWO
                  </button>
                </div>
                {zwoBlockedReason && <p className="text-xs text-gray-500">{zwoBlockedReason}</p>}
                {downloadStatus.state === 'done' && (
                  <div className="space-y-1">
                    <p className="text-xs text-green-600">Saved {downloadStatus.filename}</p>
                    {downloadStatus.warnings.map((warning) => (
                      <p key={warning} className="text-xs text-amber-600">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
                {downloadStatus.state === 'error' && (
                  <p className="text-xs text-red-600">{downloadStatus.message}</p>
                )}
              </div>

              {/* Clone + Delete action area */}
              <div className="space-y-3 border-t border-gray-100 pt-3">
                {/* Idle: both buttons side by side */}
                {cloneState.phase === 'idle' && !confirmDelete && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCloneState({ phase: 'naming', name: `${summary.workoutName} (copy)` })
                      }
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-800"
                    >
                      <CopyIcon /> Clone
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      <TrashIcon /> Delete
                    </button>
                  </div>
                )}

                {/* Clone: naming / cloning / error */}
                {(cloneState.phase === 'naming' ||
                  cloneState.phase === 'cloning' ||
                  cloneState.phase === 'error') && (
                  <div className="space-y-2 rounded-lg border border-gray-200 px-3 py-3">
                    <span className="block text-xs font-medium text-gray-600">Clone as</span>
                    <input
                      type="text"
                      value={cloneState.name}
                      disabled={cloneState.phase === 'cloning'}
                      onChange={(e) =>
                        setCloneState((prev) =>
                          prev.phase === 'naming' || prev.phase === 'error'
                            ? { ...prev, name: e.target.value }
                            : prev,
                        )
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                    />
                    {cloneState.phase === 'error' && (
                      <p className="text-xs text-red-600">{cloneState.message}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={onClone}
                        disabled={cloneState.phase === 'cloning' || !cloneState.name.trim()}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:bg-gray-300"
                      >
                        {cloneState.phase === 'cloning' ? 'Cloning…' : 'Create clone'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCloneState({ phase: 'idle' })}
                        disabled={cloneState.phase === 'cloning'}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Clone: done */}
                {cloneState.phase === 'done' && (
                  <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2.5">
                    <p className="text-sm text-green-800">
                      Cloned to{' '}
                      <a
                        href={workoutUrl(cloneState.workoutId, cloneState.sportType)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline"
                      >
                        {cloneState.workoutName}
                      </a>
                    </p>
                    <button
                      type="button"
                      onClick={() => setCloneState({ phase: 'idle' })}
                      className="ml-3 shrink-0 text-xs font-medium text-green-700 transition hover:text-green-900"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Delete: confirmation */}
                {confirmDelete && (
                  <div className="space-y-2 rounded-lg bg-red-50 px-3 py-3">
                    <p className="text-sm text-red-700">
                      Delete "{summary.workoutName}" from Garmin? This can't be undone.
                    </p>
                    {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={onDelete}
                        disabled={deleting}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:bg-red-300"
                      >
                        {deleting ? 'Deleting…' : 'Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
