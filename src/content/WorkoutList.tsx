import { useEffect, useMemo, useState } from 'react';

import { exportCoachData, listWorkouts, type WorkoutSummary } from '../lib/garmin-api';
import Shell from './Shell';
import { ChevronRightIcon, DownloadIcon, RefreshIcon, UploadIcon } from './icons';

interface Props {
  /** Bumped by the parent to force a refetch (after import / delete). */
  version: number;
  onClose: () => void;
  onImport: () => void;
  onSelect: (workout: WorkoutSummary) => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: WorkoutSummary[] };

function sportLabel(key?: string): string {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

function durationLabel(secs?: number | null): string {
  if (!secs || secs <= 0) return '';
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

type ExportState = 'idle' | 'loading' | 'done' | 'error';

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function WorkoutList({ version, onClose, onImport, onSelect }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listWorkouts()
      .then((items) => {
        if (!cancelled) setState({ status: 'ready', items });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return [];
    const q = query.trim().toLowerCase();
    const items = q ? state.items.filter((w) => w.workoutName?.toLowerCase().includes(q)) : state.items;
    return items;
  }, [state, query]);

  async function handleExport() {
    setExportState('loading');
    setExportError('');
    try {
      const data = await exportCoachData();
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(data, `garmin-coach-export-${date}.json`);
      setExportState('done');
      setTimeout(() => setExportState('idle'), 3000);
    } catch (err) {
      setExportError((err as Error).message);
      setExportState('error');
    }
  }

  return (
    <Shell title="Garmin workouts" subtitle={state.status === 'ready' ? `${state.items.length} in your library` : undefined} onClose={onClose}>
      <div className="px-4 py-4">
        <button
          type="button"
          onClick={onImport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          <UploadIcon />
          Import a new workout
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={exportState === 'loading'}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
        >
          <DownloadIcon />
          {exportState === 'loading' ? 'Exporting…' : exportState === 'done' ? 'Downloaded!' : 'Export coach data'}
        </button>
        {exportState === 'error' && (
          <p className="mt-1.5 text-xs text-red-600">{exportError}</p>
        )}

        {state.status === 'ready' && state.items.length > 0 && (
          <input
            type="search"
            value={query}
            placeholder="Search workouts…"
            onChange={(e) => setQuery(e.target.value)}
            className="mt-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          />
        )}
      </div>

      <div className="px-2 pb-4">
        {state.status === 'loading' && <p className="px-2 py-6 text-center text-sm text-gray-400">Loading your workouts…</p>}

        {state.status === 'error' && (
          <div className="px-2 py-6 text-center">
            <p className="text-sm text-red-600">{state.message}</p>
            <button
              type="button"
              onClick={() => setState({ status: 'loading' })}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <RefreshIcon /> Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && state.items.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-gray-400">No workouts yet. Import one to get started.</p>
        )}

        {state.status === 'ready' && state.items.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-gray-400">No workouts match “{query}”.</p>
        )}

        <ul className="space-y-1">
          {filtered.map((w) => {
            const meta = [sportLabel(w.sportType?.sportTypeKey), durationLabel(w.estimatedDurationInSecs)].filter(Boolean).join(' · ');
            return (
              <li key={w.workoutId}>
                <button
                  type="button"
                  onClick={() => onSelect(w)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-800">{w.workoutName}</p>
                    {meta && <p className="truncate text-xs text-gray-400">{meta}</p>}
                  </div>
                  <span className="text-gray-300">
                    <ChevronRightIcon />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Shell>
  );
}
