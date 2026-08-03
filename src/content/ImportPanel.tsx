import { useMemo, useState } from 'react';

import { createWorkout, workoutUrl } from '../lib/garmin-api';
import { jsonProfile, profileNeedsFtp, zwoProfile, type ProfileBlock } from '../lib/profile';
import { normalizeWorkoutJson } from '../lib/workout-json';
import {
  addStepAtPath,
  applyStepEdit,
  removeStepAtPath,
  renumberSteps,
  reorderStepsAtPath,
} from '../lib/workout-steps';
import { zwoName, zwoToGarminPayload, type GarminWorkoutPayload } from '../lib/zwo';
import PowerZones from './PowerZones';
import SchedulePicker from './SchedulePicker';
import Shell from './Shell';
import WorkoutChart from './WorkoutChart';
import WorkoutEdit from './WorkoutEdit';

type FileKind = 'json' | 'zwo';

interface LoadedFile {
  kind: FileKind;
  name: string;
  text: string;
}

type Status =
  | { state: 'idle' }
  | { state: 'importing' }
  | { state: 'done'; workoutId: number; workoutName: string; workoutType?: string }
  | { state: 'error'; message: string };

interface Props {
  ftp: string;
  setFtp: (value: string) => void;
  onClose: () => void;
  onBack: () => void;
  onImported: () => void;
}

function detectKind(fileName: string): FileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.zwo')) return 'zwo';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

function payloadSportType(payload: GarminWorkoutPayload): string | undefined {
  return (payload as { sportType?: { sportTypeKey?: string } }).sportType?.sportTypeKey;
}

export default function ImportPanel({ ftp, setFtp, onClose, onBack, onImported }: Props) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [workoutName, setWorkoutName] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [subView, setSubView] = useState<'configure' | 'edit'>('configure');
  const [editedPayload, setEditedPayload] = useState<GarminWorkoutPayload | null>(null);
  const [originalPayload, setOriginalPayload] = useState<GarminWorkoutPayload | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const profile = useMemo<ProfileBlock[]>(() => {
    if (!file) return [];
    try {
      return file.kind === 'zwo' ? zwoProfile(file.text) : jsonProfile(JSON.parse(file.text));
    } catch {
      return [];
    }
  }, [file]);

  const needsFtp = useMemo(() => profileNeedsFtp(profile), [profile]);
  const ftpValue = Number(ftp);
  const ftpKnown = Number.isFinite(ftpValue) && ftpValue > 0;
  const ftpValid = !needsFtp || ftpKnown;
  const canImport = !!file && workoutName.trim().length > 0 && ftpValid && status.state !== 'importing';
  const showChart = profile.length > 0 && (!needsFtp || ftpKnown);

  function reset() {
    setFile(null);
    setWorkoutName('');
    setStatus({ state: 'idle' });
    setSubView('configure');
    setEditedPayload(null);
  }

  async function loadFile(picked: File) {
    setStatus({ state: 'idle' });
    const kind = detectKind(picked.name);
    if (!kind) {
      setFile(null);
      setStatus({ state: 'error', message: 'Please choose a .json or .zwo file.' });
      return;
    }
    try {
      const text = await picked.text();
      const defaultName = kind === 'zwo' ? zwoName(text) : (JSON.parse(text)?.workoutName ?? picked.name.replace(/\.json$/i, ''));
      setFile({ kind, name: picked.name, text });
      setWorkoutName(defaultName);
    } catch (err) {
      setFile(null);
      setStatus({ state: 'error', message: `Could not read the file: ${(err as Error).message}` });
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) loadFile(picked);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const picked = e.dataTransfer.files?.[0];
    if (picked) loadFile(picked);
  }

  function buildPayload(): GarminWorkoutPayload {
    if (!file) throw new Error('No file selected.');
    const payload =
      file.kind === 'zwo' ? zwoToGarminPayload(file.text, ftpValue) : (normalizeWorkoutJson(JSON.parse(file.text)) as GarminWorkoutPayload);
    payload.workoutName = workoutName.trim();
    return payload;
  }

  function enterEdit() {
    try {
      const payload = buildPayload();
      setOriginalPayload(payload);
      setEditedPayload(JSON.parse(JSON.stringify(payload)));
      setStatus({ state: 'idle' });
      setSubView('edit');
    } catch (err) {
      setStatus({ state: 'error', message: (err as Error).message });
    }
  }

  function exitEdit() {
    setSubView('configure');
    setEditedPayload(null);
    setOriginalPayload(null);
  }

  function resetEdit() {
    if (originalPayload) setEditedPayload(JSON.parse(JSON.stringify(originalPayload)));
  }

  function handleStepEdit(segIdx: number, path: number[], changes: Record<string, unknown>) {
    setEditedPayload((prev) => (prev ? applyStepEdit(prev, segIdx, path, changes) : prev));
  }

  function handleStepRemove(segIdx: number, path: number[]) {
    setEditedPayload((prev) => (prev ? removeStepAtPath(prev, segIdx, path) : prev));
  }

  function handleStepReorder(segIdx: number, parentPath: number[], fromIdx: number, toIdx: number) {
    setEditedPayload((prev) => (prev ? reorderStepsAtPath(prev, segIdx, parentPath, fromIdx, toIdx) : prev));
  }

  function handleStepAdd(segIdx: number, parentPath: number[], step: Record<string, unknown>) {
    setEditedPayload((prev) => (prev ? addStepAtPath(prev, segIdx, parentPath, step) : prev));
  }

  async function onImport() {
    if (!canImport) return;
    setStatus({ state: 'importing' });
    try {
      // Steps added in the editor carry no order of their own, so number them.
      const payload = editedPayload ? renumberSteps(editedPayload) : buildPayload();
      const created = await createWorkout(payload);
      setStatus({
        state: 'done',
        workoutId: created.workoutId,
        workoutName: payload.workoutName,
        workoutType: created.sportType?.sportTypeKey ?? payloadSportType(payload),
      });
      onImported();
    } catch (err) {
      setStatus({ state: 'error', message: (err as Error).message });
    }
  }

  const importButton = (
    <button
      type="button"
      onClick={onImport}
      disabled={!canImport}
      className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
    >
      {status.state === 'importing' ? 'Importing…' : 'Import to Garmin'}
    </button>
  );

  const footer =
    subView === 'edit' ? (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={exitEdit}
          className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={resetEdit}
          className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Reset
        </button>
        {importButton}
      </div>
    ) : (
      <div className="flex gap-2">
        {importButton}
      </div>
    );

  return (
    <Shell
      title={subView === 'edit' ? 'Edit steps' : 'Import a workout'}
      subtitle={subView === 'edit' ? workoutName : 'From a .json or .zwo file'}
      onClose={onClose}
      onBack={subView === 'edit' ? exitEdit : onBack}
      footer={footer}
    >
      {subView === 'edit' && editedPayload ? (
        <WorkoutEdit
          detail={editedPayload}
          ftp={ftpKnown ? Math.round(ftpValue) : 0}
          onEdit={handleStepEdit}
          onRemove={handleStepRemove}
          onReorder={handleStepReorder}
          onAdd={handleStepAdd}
        />
      ) : (
        <div className="space-y-4 px-4 py-4">
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600">Workout file (.json or .zwo)</span>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <span className="text-sm text-gray-500">
                {file ? (
                  <span className="font-medium text-blue-700">{file.name} ({file.kind.toUpperCase()})</span>
                ) : (
                  <>Drop a file here, or <span className="font-medium text-blue-600">browse</span></>
                )}
              </span>
              <span className="text-xs text-gray-400">.json or .zwo</span>
              <input
                type="file"
                accept=".json,.zwo,application/json"
                onChange={onFileChange}
                className="sr-only"
              />
            </label>
          </div>

          {
            file && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Workout name</span>
                  <input
                    type="text"
                    value={workoutName}
                    disabled={!file}
                    onChange={(e) => setWorkoutName(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">FTP (watts)</span>
                  <input
                    type="number"
                    min={1}
                    value={ftp}
                    placeholder="e.g. 245"
                    onChange={(e) => setFtp(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                  />
                  <span className="mt-1 block text-xs text-gray-400">
                    {needsFtp
                      ? 'Required — ZWO power is % of FTP. The preview and watt targets update as you change it.'
                      : 'Optional — used to colour the preview and show your power zones.'}
                  </span>
                </label>

                {ftpKnown && <PowerZones ftp={Math.round(ftpValue)} />}
              </>
            )
          }

          {showChart && (
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">Preview</span>
                <button
                  type="button"
                  onClick={enterEdit}
                  disabled={!canImport}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  Edit steps
                </button>
              </div>
              <WorkoutChart blocks={profile} ftp={ftpKnown ? Math.round(ftpValue) : 0} />
            </div>
          )}

          {status.state === 'error' && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{status.message}</div>}

          {status.state === 'done' && (
            <div className="space-y-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">
              <p>
                Imported <span className="font-semibold">{status.workoutName}</span> into your Garmin library.
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
                  Import another
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
      )}
    </Shell>
  );
}
