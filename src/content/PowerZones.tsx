import { ZONES, zoneWattRange } from '../lib/profile';

interface Props {
  ftp: number;
}

export default function PowerZones({ ftp }: Props) {
  if (!(ftp > 0)) return null;

  // The bar shows all 7 zones; the table lists the bounded training zones (Z2–Z6).
  const rows = ZONES.filter((z) => z.lowFrac > 0 && Number.isFinite(z.highFrac));

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-600">
        Power zones · {Math.round(ftp)} W
      </span>

      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {ZONES.map((z) => (
          <span key={z.id} className="flex-1" style={{ backgroundColor: z.color }} title={`Z${z.id} ${z.name}`} />
        ))}
      </div>
      <div className="mt-1 flex w-full">
        {ZONES.map((z) => (
          <span key={z.id} className="flex-1 text-center text-[10px] font-medium text-gray-400">
            Z{z.id}
          </span>
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {rows.map((z) => {
          const { low, high } = zoneWattRange(z, ftp);
          return (
            <li key={z.id} className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: z.color }} />
              <span className="font-semibold">Z{z.id}</span>
              <span className="text-gray-600">{z.name}</span>
              <span className="ml-auto tabular-nums text-gray-500">
                {low}–{high} W
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
