/**
 * Thin client for the Garmin Connect gc-api, called from the content script.
 *
 * Because the content script runs on connect.garmin.com, fetches are
 * same-origin: the real session cookies ride along automatically and Cloudflare
 * is never in the picture (this is exactly why the in-browser approach works
 * where the standalone CLI was blocked). Mutating calls additionally need the
 * page's CSRF token, which the web app exposes in a <meta name="csrf-token">.
 */

const BASE = 'https://connect.garmin.com/gc-api';

export interface CreatedWorkout {
  workoutId: number;
  workoutName?: string;
  sportType?: { sportTypeKey?: string };
}

/** Read the CSRF token the Garmin web app embeds in the page <head>. */
export function csrfToken(): string | null {
  return document.querySelector("meta[name='csrf-token']")?.getAttribute('content') ?? null;
}

function authHeaders(token: string, json: boolean): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'connect-csrf-token': token,
  };
  if (json) headers['Content-Type'] = 'application/json;charset=UTF-8';
  return headers;
}

/** Create a structured workout from a Garmin workout-service JSON payload. */
export async function createWorkout(payload: unknown): Promise<CreatedWorkout> {
  const token = csrfToken();
  if (!token) {
    throw new Error(
      'Could not find the Garmin CSRF token on this page. Open Garmin Connect and make sure you are signed in, then try again.',
    );
  }

  const res = await fetch(`${BASE}/workout-service/workout`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error('Garmin rejected the request — your session may have expired. Reload Garmin Connect and try again.');
    }
    throw new Error(`Garmin returned HTTP ${res.status}. ${text.slice(0, 200)}`.trim());
  }

  return (await res.json()) as CreatedWorkout;
}

function extractFtp(data: unknown): number | null {
  if (typeof data === 'number') return data > 0 ? Math.round(data) : null;
  const obj = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['functionalThresholdPower', 'ftp', 'value', 'weightedFtp']) {
    const v = obj[key];
    if (typeof v === 'number' && v > 0) return Math.round(v);
  }
  return null;
}

/**
 * Best-effort fetch of the athlete's latest cycling FTP from Garmin. Returns
 * null on any failure (not signed in, endpoint shape changed, etc.) so callers
 * can silently fall back to a remembered or manually-entered value.
 */
export async function fetchCyclingFtp(): Promise<number | null> {
  try {
    const token = csrfToken();
    const res = await fetch(`${BASE}/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING`, {
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        ...(token ? { 'connect-csrf-token': token } : {}),
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? extractFtp(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/**
 * URL of a workout in the Garmin Connect web app. The workout view needs the
 * sport as a `workoutType` query param (e.g. ?workoutType=cycling) to load.
 */
export function workoutUrl(workoutId: number, workoutType?: string): string {
  const base = `https://connect.garmin.com/app/workout/${workoutId}`;
  return workoutType ? `${base}?workoutType=${encodeURIComponent(workoutType)}` : base;
}
