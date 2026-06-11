import { useEffect, useState } from 'react';

import { fetchCyclingFtp, type WorkoutSummary } from '../lib/garmin-api';
import { getStoredFtp, setStoredFtp } from '../lib/storage';
import ImportPanel from './ImportPanel';
import WorkoutDetail from './WorkoutDetail';
import WorkoutList from './WorkoutList';
import { UploadIcon } from './icons';

const Z_INDEX = 2147483646;

type View = 'list' | 'import' | 'detail';

export default function App() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<WorkoutSummary | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [ftp, setFtp] = useState('');

  // The toolbar icon opens the drawer (to the list) via a background message.
  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (message && typeof message === 'object' && (message as { type?: string }).type === 'open-importer') {
        setView('list');
        setOpen(true);
      }
    };
    chrome.runtime?.onMessage?.addListener(onMessage);
    return () => chrome.runtime?.onMessage?.removeListener(onMessage);
  }, []);

  // Prefill FTP: remembered value instantly, then refresh from Garmin. A value
  // the user has typed always wins. Shared across the import + detail views.
  useEffect(() => {
    let cancelled = false;
    const prefill = (value: number) => {
      if (!cancelled) setFtp((prev) => (prev.trim() ? prev : String(value)));
    };
    (async () => {
      const stored = await getStoredFtp();
      if (stored) prefill(stored);
      const fetched = await fetchCyclingFtp();
      if (fetched) {
        prefill(fetched);
        void setStoredFtp(fetched);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Remember the FTP the user settles on.
  useEffect(() => {
    const n = Number(ftp);
    if (Number.isFinite(n) && n > 0) void setStoredFtp(n);
  }, [ftp]);

  const ftpValue = Number(ftp);
  const ftpRounded = Number.isFinite(ftpValue) && ftpValue > 0 ? Math.round(ftpValue) : 0;

  function close() {
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ zIndex: Z_INDEX }}
        className="fixed bottom-5 right-5 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700"
      >
        <UploadIcon />
        Workouts
      </button>
    );
  }

  if (view === 'import') {
    return (
      <ImportPanel
        ftp={ftp}
        setFtp={setFtp}
        onClose={close}
        onBack={() => setView('list')}
        onImported={() => setListVersion((v) => v + 1)}
      />
    );
  }

  if (view === 'detail' && selected) {
    return (
      <WorkoutDetail
        summary={selected}
        ftp={ftpRounded}
        onClose={close}
        onBack={() => setView('list')}
        onDeleted={() => {
          setListVersion((v) => v + 1);
          setSelected(null);
          setView('list');
        }}
      />
    );
  }

  return (
    <WorkoutList
      version={listVersion}
      onClose={close}
      onImport={() => setView('import')}
      onSelect={(w) => {
        setSelected(w);
        setView('detail');
      }}
    />
  );
}
