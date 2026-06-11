import { useMemo, useRef, useState } from 'react';

import { blockFrac, blockWatts, totalDuration, zoneForFrac, ZONES, type BlockKind, type ProfileBlock } from '../lib/profile';

interface Props {
  blocks: ProfileBlock[];
  ftp: number; // 0 when unknown
}

const KIND_LABEL: Record<BlockKind, string> = {
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  interval: 'Interval',
  recovery: 'Recovery',
  steady: 'Steady',
  free: 'Free ride',
};

function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const W = 1000;
const H = 240;
const PAD = { left: 46, right: 12, top: 14, bottom: 24 };
const TOOLTIP_W = 220;

interface Bar {
  key: number;
  points: string;
  color: string;
  kind: BlockKind;
  wattsLabel: string;
  pctLabel: string;
  durationLabel: string;
  note?: string;
}

interface Hover {
  bar: Bar;
  x: number;
  y: number;
  wrapW: number;
}

export default function WorkoutChart({ blocks, ftp }: Props) {
  const total = totalDuration(blocks);
  const ftpKnown = ftp > 0;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const { bars, yMax } = useMemo(() => {
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const baseY = PAD.top + plotH;

    let maxWatts = ftpKnown ? ftp * 1.2 : 0;
    for (const b of blocks) {
      const [s, e] = blockWatts(b, ftp);
      maxWatts = Math.max(maxWatts, s, e);
    }
    if (maxWatts <= 0) maxWatts = 100;
    const yMax = Math.max(20, Math.ceil(maxWatts / 20) * 20);

    const xFor = (t: number) => PAD.left + (total > 0 ? (t / total) * plotW : 0);
    const yFor = (w: number) => baseY - (w / yMax) * plotH;

    let cum = 0;
    const bars: Bar[] = blocks.map((b, i) => {
      const x0 = xFor(cum);
      const x1 = xFor(cum + b.durationSec);
      cum += b.durationSec;
      const [sW, eW] = blockWatts(b, ftp);
      const [sF, eF] = blockFrac(b, ftp);
      const midFrac = (sF + eF) / 2;
      const color = ftpKnown ? zoneForFrac(midFrac).color : '#94a3b8';
      const points = `${x0},${baseY} ${x0},${yFor(sW)} ${x1},${yFor(eW)} ${x1},${baseY}`;
      const ramp = Math.round(sW) !== Math.round(eW);
      const wattsLabel = ramp ? `${Math.round(sW)}–${Math.round(eW)} W` : `${Math.round(sW)} W`;
      const pctLabel = ftpKnown ? `${Math.round(midFrac * 100)}% FTP` : '';
      return { key: i, points, color, kind: b.kind, wattsLabel, pctLabel, durationLabel: formatDuration(b.durationSec), note: b.note };
    });

    return { bars, yMax };
  }, [blocks, ftp, ftpKnown, total]);

  const plotH = H - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;
  const yForFtp = baseY - (ftp / yMax) * plotH;

  const usedZones = useMemo(() => {
    if (!ftpKnown) return [];
    const ids = new Set<number>();
    for (const b of blocks) {
      const [sF, eF] = blockFrac(b, ftp);
      ids.add(zoneForFrac((sF + eF) / 2).id);
    }
    return ZONES.filter((z) => ids.has(z.id));
  }, [blocks, ftp, ftpKnown]);

  if (!blocks.length) return null;

  function onBarMove(e: React.MouseEvent, bar: Bar) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ bar, x: e.clientX - rect.left, y: e.clientY - rect.top, wrapW: rect.width });
  }

  const tooltipLeft = hover ? Math.max(4, Math.min(hover.x + 12, hover.wrapW - TOOLTIP_W - 4)) : 0;

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="none" role="img" aria-label="Workout power profile">
        <line x1={PAD.left} y1={baseY} x2={W - PAD.right} y2={baseY} stroke="#e5e7eb" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        <text x={PAD.left - 6} y={baseY} textAnchor="end" dominantBaseline="middle" className="fill-gray-400 text-[20px]">
          0
        </text>
        <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end" className="fill-gray-400 text-[20px]">
          {yMax}W
        </text>

        {ftpKnown && yForFtp > PAD.top && (
          <>
            <line x1={PAD.left} y1={yForFtp} x2={W - PAD.right} y2={yForFtp} stroke="#1d4ed8" strokeWidth={1} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
            <text x={W - PAD.right} y={yForFtp - 4} textAnchor="end" className="fill-blue-700 text-[20px]">
              FTP {ftp}W
            </text>
          </>
        )}

        {bars.map((bar) => (
          <polygon
            key={bar.key}
            points={bar.points}
            fill={bar.color}
            fillOpacity={hover && hover.bar.key === bar.key ? 1 : 0.92}
            stroke="#ffffff"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
            onMouseMove={(e) => onBarMove(e, bar)}
          />
        ))}

        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-gray-400 text-[20px]">
          {formatDuration(total)}
        </text>
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-gray-200 bg-white p-2 shadow-lg"
          style={{ left: tooltipLeft, top: hover.y, width: TOOLTIP_W, transform: 'translateY(calc(-100% - 12px))' }}
        >
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: hover.bar.color }} />
            <span className="text-xs font-semibold text-gray-800">{KIND_LABEL[hover.bar.kind]}</span>
            {hover.bar.pctLabel && <span className="ml-auto text-[11px] text-gray-500">{hover.bar.pctLabel}</span>}
          </div>
          <div className="text-[11px] text-gray-500">
            {hover.bar.wattsLabel} · {hover.bar.durationLabel}
          </div>
          {hover.bar.note && <div className="mt-1 whitespace-pre-line border-t border-gray-100 pt-1 text-[11px] text-gray-600">{hover.bar.note}</div>}
        </div>
      )}

      {usedZones.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {usedZones.map((z) => (
            <span key={z.id} className="flex items-center gap-1 text-[11px] text-gray-500">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: z.color }} />
              Z{z.id} {z.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
