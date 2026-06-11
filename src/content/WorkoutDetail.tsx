import { useEffect, useMemo, useState } from 'react';

import { deleteWorkout, getWorkoutDetail, workoutUrl, type GarminWorkoutDetail, type WorkoutSummary } from '../lib/garmin-api';
import { jsonProfile, totalDuration, type ProfileBlock } from '../lib/profile';
import Shell from './Shell';
import WorkoutChart from './WorkoutChart';
import { TrashIcon } from './icons';

interface Props {
  summary: WorkoutSummary;
  ftp: number; // 0 when unknown — used to colour zones
  onClose: () => void;
  onBack: () => void;
  onDeleted: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: GarminWorkoutDetail };

function sportLabel(key?: string): string {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

function durationLabel(secs: number): string {
  const m = Math.round(secs / 60);
  if (m <= 0) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export default function WorkoutDetail({ summary, ftp, onClose, onBack, onDeleted }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    getWorkoutDetail(summary.workoutId)
      .then((detail) => {
        if (!cancelled) setState({ status: 'ready', detail });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [summary.workoutId]);

  const profile = useMemo<ProfileBlock[]>(() => (state.status === 'ready' ? jsonProfile(state.detail) : []), [state]);
  const duration = useMemo(() => durationLabel(totalDuration(profile)), [profile]);

  const sportType = summary.sportType?.sportTypeKey ?? (state.status === 'ready' ? state.detail.sportType?.sportTypeKey : undefined);
  const description = (state.status === 'ready' ? state.detail.description : summary.description) ?? '';
  const meta = [sportLabel(sportType), duration].filter(Boolean).join(' · ');

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

  return (
    <Shell title={summary.workoutName} subtitle={meta || undefined} onClose={onClose} onBack={onBack}>
      <div className="space-y-4 px-4 py-4">
        {state.status === 'loading' && <p className="py-6 text-center text-sm text-gray-400">Loading workout…</p>}

        {state.status === 'error' && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</div>}

        {state.status === 'ready' && (
          <>
            {profile.length > 0 ? (
              <div className="rounded-lg border border-gray-200 p-3">
                <span className="mb-2 block text-xs font-medium text-gray-600">Power profile</span>
                <WorkoutChart blocks={profile} ftp={ftp} />
              </div>
            ) : (
              <p className="text-sm text-gray-400">This workout has no chartable power steps.</p>
            )}

            {description && <p className="whitespace-pre-line text-sm text-gray-600">{description}</p>}

            <a
              href={workoutUrl(summary.workoutId, sportType)}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Open in Garmin Connect
            </a>

            <div className="border-t border-gray-100 pt-3">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-sm font-medium text-red-600 transition hover:text-red-700"
                >
                  <TrashIcon /> Delete workout
                </button>
              ) : (
                <div className="space-y-2 rounded-lg bg-red-50 px-3 py-3">
                  <p className="text-sm text-red-700">Delete “{summary.workoutName}” from Garmin? This can’t be undone.</p>
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
    </Shell>
  );
}
