import { useEffect, useMemo, useRef, useState } from 'react';

import { bulkDelete, bulkExport, type BulkResult, type ExportFormat } from '../lib/bulk-actions';
import { downloadJson } from '../lib/download';
import { exportCoachData, listWorkouts, type WorkoutSummary } from '../lib/garmin-api';
import { canExportZwo } from '../lib/zwo-export';
import Shell from './Shell';
import { ChevronRightIcon, DownloadIcon, InfoIcon, PlusIcon, RefreshIcon, TrashIcon, UploadIcon } from './icons';

interface Props {
  /** Bumped by the parent to force a refetch (after create / import / delete). */
  version: number;
  /** Shared FTP, needed to turn watt targets into ZWO's %FTP values. */
  ftp: string;
  onClose: () => void;
  onCreate: () => void;
  onImport: () => void;
  onSelect: (workout: WorkoutSummary) => void;
  /** Called after a bulk delete, so the parent can refetch the list. */
  onChanged: () => void;
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

/** What a bulk run is doing, so progress and results can be labelled. */
type BulkAction = { kind: 'delete' } | { kind: 'export'; format: ExportFormat };

type BulkState =
  | { phase: 'idle' }
  | { phase: 'confirm-delete' }
  | { phase: 'running'; action: BulkAction; done: number; total: number }
  | { phase: 'done'; action: BulkAction; result: BulkResult };

const PAGE_SIZE = 25;

const NO_ITEMS: WorkoutSummary[] = [];

function runningLabel(action: BulkAction): string {
  return action.kind === 'delete' ? 'Deleting' : 'Exporting';
}

function resultHeadline(action: BulkAction, result: BulkResult): string {
  const total = result.succeeded + result.failed.length + result.skipped.length;
  const workouts = `${result.succeeded} of ${total} workout${total === 1 ? '' : 's'}`;
  return action.kind === 'delete'
    ? `Deleted ${workouts}.`
    : `Downloaded ${workouts} as ${action.format.toUpperCase()}.`;
}

export default function WorkoutList({ version, ftp, onClose, onCreate, onImport, onSelect, onChanged }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportError, setExportError] = useState('');
  const [showExportInfo, setShowExportInfo] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [bulk, setBulk] = useState<BulkState>({ phase: 'idle' });

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

  const allItems = state.status === 'ready' ? state.items : NO_ITEMS;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allItems.filter((w) => w.workoutName?.toLowerCase().includes(q)) : allItems;
  }, [allItems, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Selection is keyed by workout id, so it survives paging and searching.
  const chosen = useMemo(() => allItems.filter((w) => selectedIds.has(w.workoutId)), [allItems, selectedIds]);

  // A refetch replaces the list, so ids selected against the old one are dropped.
  // The bulk result panel is left alone — a delete is what triggers the refetch,
  // and its report of what failed has to outlive it.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [version]);

  // A new search or a refetch should land you back on the first page.
  useEffect(() => {
    setPage(1);
  }, [query, version]);

  // Turning a page starts you at the top of the new one.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [safePage]);

  const running = bulk.phase === 'running';

  const allVisibleSelected = visible.length > 0 && visible.every((w) => selectedIds.has(w.workoutId));
  const someVisibleSelected = visible.some((w) => selectedIds.has(w.workoutId));

  // "Some but not all" is a checkbox state only the DOM can express.
  const pageBoxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pageBoxRef.current) pageBoxRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  const ftpValue = Number(ftp);
  const ftpNum = Number.isFinite(ftpValue) && ftpValue > 0 ? Math.round(ftpValue) : 0;

  // ZWO is a cycling, %FTP-based format, so it needs bike workouts and an FTP.
  const zwoBlockedReason = !chosen.some((w) => canExportZwo(w.sportType?.sportTypeKey))
    ? 'None of the selected workouts are cycling workouts.'
    : ftpNum <= 0
      ? 'Open a workout and set your FTP to export as ZWO.'
      : undefined;

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setMany(ids: number[], on: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

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

  const onBulkProgress = (done: number) =>
    setBulk((prev) => (prev.phase === 'running' ? { ...prev, done } : prev));

  async function runBulkExport(format: ExportFormat) {
    const items = chosen;
    if (!items.length) return;
    const action: BulkAction = { kind: 'export', format };
    setBulk({ phase: 'running', action, done: 0, total: items.length });
    const result = await bulkExport(items, format, ftpNum, onBulkProgress);
    setBulk({ phase: 'done', action, result });
  }

  async function runBulkDelete() {
    const items = chosen;
    if (!items.length) return;
    const action: BulkAction = { kind: 'delete' };
    setBulk({ phase: 'running', action, done: 0, total: items.length });
    const result = await bulkDelete(items, onBulkProgress);
    setBulk({ phase: 'done', action, result });
    setSelectedIds(new Set());
    // Whatever was removed is gone from Garmin — pull a fresh list.
    onChanged();
  }

  const bulkFooter =
    chosen.length > 0 || bulk.phase !== 'idle' ? (
      <div className="space-y-2">
        {bulk.phase === 'running' && (
          <div>
            <p className="text-xs font-medium text-gray-600">
              {runningLabel(bulk.action)} {Math.min(bulk.done + 1, bulk.total)} of {bulk.total}…
            </p>
            {bulk.action.kind === 'export' && bulk.total > 1 && (
              <p className="mt-1 text-xs text-gray-400">Your browser may ask to allow multiple downloads.</p>
            )}
          </div>
        )}

        {bulk.phase === 'confirm-delete' && (
          <div className="space-y-2 rounded-lg bg-red-50 px-3 py-2.5">
            <p className="text-sm text-red-700">
              Delete {chosen.length} workout{chosen.length === 1 ? '' : 's'} from Garmin? This can't be undone.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={runBulkDelete}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                Delete {chosen.length}
              </button>
              <button
                type="button"
                onClick={() => setBulk({ phase: 'idle' })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {bulk.phase === 'done' && (
          <div
            className={`space-y-1 rounded-lg px-3 py-2.5 ${
              bulk.result.failed.length || bulk.result.skipped.length ? 'bg-amber-50' : 'bg-green-50'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-xs font-medium ${
                  bulk.result.failed.length || bulk.result.skipped.length ? 'text-amber-800' : 'text-green-800'
                }`}
              >
                {resultHeadline(bulk.action, bulk.result)}
              </p>
              <button
                type="button"
                onClick={() => setBulk({ phase: 'idle' })}
                className="shrink-0 text-xs font-medium text-gray-600 transition hover:text-gray-900"
              >
                Dismiss
              </button>
            </div>
            {bulk.result.skipped.map((note) => (
              <p key={`skip-${note.name}`} className="text-xs text-amber-700">
                Skipped {note.name} — {note.message}
              </p>
            ))}
            {bulk.result.failed.map((note) => (
              <p key={`fail-${note.name}`} className="text-xs text-red-600">
                {note.name} — {note.message}
              </p>
            ))}
            {bulk.result.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-700">
                {warning}
              </p>
            ))}
          </div>
        )}

        {chosen.length > 0 && bulk.phase !== 'confirm-delete' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600">
              {chosen.length} selected
            </span>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                onClick={() => runBulkExport('json')}
                disabled={running}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <DownloadIcon size={14} /> JSON
              </button>
              <button
                type="button"
                onClick={() => runBulkExport('zwo')}
                disabled={running || !!zwoBlockedReason}
                title={zwoBlockedReason}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <DownloadIcon size={14} /> ZWO
              </button>
              <button
                type="button"
                onClick={() => setBulk({ phase: 'confirm-delete' })}
                disabled={running}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                <TrashIcon size={14} /> Delete
              </button>
            </div>
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <Shell
      title="Garmin workouts"
      subtitle={state.status === 'ready' ? `${state.items.length} in your library` : undefined}
      onClose={onClose}
      scroll={false}
      footer={bulkFooter}
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
          <>
            <input
              type="search"
              value={query}
              placeholder="Search workouts…"
              onChange={(e) => setQuery(e.target.value)}
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />

            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-2 text-gray-600">
                <input
                  ref={pageBoxRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={running || visible.length === 0}
                  onChange={(e) => setMany(visible.map((w) => w.workoutId), e.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
                Select page
              </label>
              <div className="flex items-center gap-3">
                {filtered.length > visible.length && (
                  <button
                    type="button"
                    onClick={() => setMany(filtered.map((w) => w.workoutId), true)}
                    disabled={running}
                    className="font-medium text-blue-600 transition hover:underline disabled:opacity-50"
                  >
                    Select all {filtered.length}
                    {query.trim() ? ' matching' : ''}
                  </button>
                )}
                {chosen.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    disabled={running}
                    className="font-medium text-gray-600 transition hover:underline disabled:opacity-50"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>
          </>
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
            const isSelected = selectedIds.has(w.workoutId);
            return (
              <li
                key={w.workoutId}
                className={`flex items-center gap-2 rounded-lg pl-2 transition ${
                  isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={running}
                  onChange={() => toggleOne(w.workoutId)}
                  aria-label={`Select ${w.workoutName}`}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <button
                  type="button"
                  onClick={() => onSelect(w)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-2 text-left"
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
