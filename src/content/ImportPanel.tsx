import { useMemo, useState } from 'react';

import { createWorkout, workoutUrl } from '../lib/garmin-api';
import { jsonProfile, profileNeedsFtp, zwoProfile, type ProfileBlock } from '../lib/profile';
import { normalizeWorkoutJson } from '../lib/workout-json';
import { zwoName, zwoToGarminPayload, type GarminWorkoutPayload } from '../lib/zwo';
import PowerZones from './PowerZones';
import Shell from './Shell';
import WorkoutChart from './WorkoutChart';

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
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setStatus({ state: 'idle' });
    const picked = e.target.files?.[0];
    if (!picked) return;

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

  function buildPayload(): GarminWorkoutPayload {
    if (!file) throw new Error('No file selected.');
    const payload =
      file.kind === 'zwo' ? zwoToGarminPayload(file.text, ftpValue) : (normalizeWorkoutJson(JSON.parse(file.text)) as GarminWorkoutPayload);
    payload.workoutName = workoutName.trim();
    return payload;
  }

  async function onImport() {
    if (!canImport) return;
    setStatus({ state: 'importing' });
    try {
      const payload = buildPayload();
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

  const footer = (
    <button
      type="button"
      onClick={onImport}
      disabled={!canImport}
      className="block w-full rounded-lg bg-blue-600 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
    >
      {status.state === 'importing' ? 'Importing…' : 'Import to Garmin'}
    </button>
  );

  return (
    <Shell title="Import a workout" subtitle="From a .json or .zwo file" onClose={onClose} onBack={onBack} footer={footer}>
      <div className="space-y-4 px-4 py-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Workout file (.json or .zwo)</span>
          <input
            type="file"
            accept=".json,.zwo,application/json"
            onChange={onFileChange}
            className="block w-full text-sm text-gray-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />
          <span className="mt-1 block text-xs text-gray-400">{file ? `${file.name} (${file.kind.toUpperCase()})` : 'No file selected'}</span>
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

        {showChart && (
          <div className="rounded-lg border border-gray-200 p-3">
            <span className="mb-2 block text-xs font-medium text-gray-600">Preview</span>
            <WorkoutChart blocks={profile} ftp={ftpKnown ? Math.round(ftpValue) : 0} />
          </div>
        )}

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
      </div>
    </Shell>
  );
}
