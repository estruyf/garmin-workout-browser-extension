import { useEffect, useMemo, useRef, useState } from 'react';

import { exportCoachData, listWorkouts, type WorkoutSummary } from '../lib/garmin-api';
import Shell from './Shell';
import { ChevronRightIcon, DownloadIcon, InfoIcon, PlusIcon, RefreshIcon, UploadIcon } from './icons';

interface Props {
  /** Bumped by the parent to force a refetch (after create / import / delete). */
  version: number;
  onClose: () => void;
  onCreate: () => void;
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

function dateLabel(value?: string | null): string {
  if (!value) return '';
  // Garmin sends UTC timestamps without a zone ("2025-07-19T22:12:03.0"), which
  // JS would otherwise read as local time and roll back to the previous day.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasZone || !value.includes('T') ? value : `${value}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type ExportState = 'idle' | 'loading' | 'done' | 'error';

const PAGE_SIZE = 25;

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function WorkoutList({ version, onClose, onCreate, onImport, onSelect }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportError, setExportError] = useState('');
  const [showExportInfo, setShowExportInfo] = useState(false);
  const [page, setPage] = useState(1);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // A new search or a refetch should land you back on the first page.
  useEffect(() => {
    setPage(1);
  }, [query, version]);

  // Turning a page starts you at the top of the new one.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [safePage]);

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
    <Shell
      title="Garmin workouts"
      subtitle={state.status === 'ready' ? `${state.items.length} in your library` : undefined}
      onClose={onClose}
      scroll={false}
    >
      <div className="shrink-0 border-b border-gray-100 px-4 py-4">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCreate}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <PlusIcon />
            Create a workout
          </button>
          <button
            type="button"
            onClick={onImport}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <UploadIcon />
            Import a file
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExport}
            disabled={exportState === 'loading'}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          >
            <DownloadIcon />
            {exportState === 'loading' ? 'Exporting…' : exportState === 'done' ? 'Downloaded!' : 'Export coach data'}
          </button>
          <button
            type="button"
            onClick={() => setShowExportInfo((v) => !v)}
            className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5 text-gray-400 transition hover:bg-gray-50 hover:text-gray-600"
            aria-label="About export"
          >
            <InfoIcon />
          </button>
        </div>
        {exportState === 'error' && (
          <p className="mt-1.5 text-xs text-red-600">{exportError}</p>
        )}
        {showExportInfo && (
          <div className="mt-1.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
            Downloads a snapshot of your athlete profile, readiness, training load, HRV/HR trends, and last 6 weeks of rides as a JSON file. Drop it into any AI assistant to get personalised analysis, recovery advice, or structured workout plans. For the best experience, use the{' '}
            <a
              href="https://github.com/estruyf/skill-cycling-plan-coach"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Cycling Plan Coach skill
            </a>{' '}
            for Claude.
          </div>
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

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
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
          <p className="px-2 py-6 text-center text-sm text-gray-400">No workouts yet. Create or import one to get started.</p>
        )}

        {state.status === 'ready' && state.items.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-gray-400">No workouts match “{query}”.</p>
        )}

        <ul className="space-y-1">
          {visible.map((w) => {
            const meta = [
              sportLabel(w.sportType?.sportTypeKey),
              durationLabel(w.estimatedDurationInSecs),
              dateLabel(w.createdDate ?? w.updatedDate),
            ]
              .filter(Boolean)
              .join(' · ');
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

      {state.status === 'ready' && filtered.length > PAGE_SIZE && (
        <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">
            Page {safePage} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage === pageCount}
            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </Shell>
  );
}
