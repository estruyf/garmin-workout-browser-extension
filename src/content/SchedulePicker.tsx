import { useState } from 'react';

import { calendarUrl, scheduleWorkout, unscheduleWorkout } from '../lib/garmin-api';
import { CalendarIcon } from './icons';

interface Props {
  workoutId: number;
  /** Heading above the picker; omit to render just the controls. */
  label?: string;
}

/** Entries added during this session, newest last, so each can be undone. */
interface Booking {
  scheduleId: number;
  date: string;
  removing?: boolean;
}

/** Today as YYYY-MM-DD in local time — what <input type="date"> speaks. */
function today(): string {
  return new Date().toLocaleDateString('sv');
}

/**
 * "Sat 8 Aug". Built from the parts rather than `new Date(iso)`, which reads a
 * bare YYYY-MM-DD as UTC midnight and rolls back a day west of Greenwich.
 */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Puts a workout on the Garmin calendar. The same workout can go on several
 * days — a plan repeats sessions — so bookings accumulate and each one keeps
 * its own remove button.
 */
export default function SchedulePicker({ workoutId, label = 'Schedule it' }: Props) {
  const [date, setDate] = useState(today);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const alreadyBooked = bookings.some((b) => b.date === date);

  async function onSchedule() {
    if (!date || busy || alreadyBooked) return;
    setBusy(true);
    setError('');
    try {
      const created = await scheduleWorkout(workoutId, date);
      setBookings((prev) => [...prev, { scheduleId: created.workoutScheduleId, date: created.date }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(scheduleId: number) {
    setError('');
    setBookings((prev) => prev.map((b) => (b.scheduleId === scheduleId ? { ...b, removing: true } : b)));
    try {
      await unscheduleWorkout(scheduleId);
      setBookings((prev) => prev.filter((b) => b.scheduleId !== scheduleId));
    } catch (err) {
      setError((err as Error).message);
      setBookings((prev) => prev.map((b) => (b.scheduleId === scheduleId ? { ...b, removing: false } : b)));
    }
  }

  return (
    <div className="space-y-2">
      {label && <span className="block text-xs font-medium text-gray-600">{label}</span>}

      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setError('');
          }}
          aria-label="Date"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={onSchedule}
          disabled={!date || busy || alreadyBooked}
          title={alreadyBooked ? 'Already on the calendar for that day.' : undefined}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          <CalendarIcon size={15} />
          {busy ? 'Adding…' : 'Add to calendar'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {bookings.map((booking) => (
        <div
          key={booking.scheduleId}
          className="flex items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-2"
        >
          <p className="min-w-0 truncate text-xs text-green-800">
            On your calendar for <span className="font-semibold">{dayLabel(booking.date)}</span>
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <a
              href={calendarUrl()}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-green-700 underline transition hover:text-green-900"
            >
              Open calendar
            </a>
            <button
              type="button"
              onClick={() => onRemove(booking.scheduleId)}
              disabled={booking.removing}
              className="text-xs font-medium text-green-700 transition hover:text-green-900 disabled:opacity-50"
            >
              {booking.removing ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
