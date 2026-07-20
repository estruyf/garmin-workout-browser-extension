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

export interface WorkoutSummary {
  workoutId: number;
  workoutName: string;
  description?: string | null;
  sportType?: { sportTypeKey?: string };
  estimatedDurationInSecs?: number | null;
  createdDate?: string | null;
  updatedDate?: string | null;
}

export interface GarminWorkoutDetail {
  workoutId: number;
  workoutName: string;
  description?: string | null;
  sportType?: { sportTypeKey?: string };
  estimatedDurationInSecs?: number | null;
  workoutSegments?: unknown[];
  [key: string]: unknown;
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

/** Authenticated GET against the gc-api (same-origin cookies + CSRF). */
async function apiGet(path: string): Promise<unknown> {
  const token = csrfToken();
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      ...(token ? { 'connect-csrf-token': token } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Garmin rejected the request — reload Garmin Connect and try again.');
    }
    throw new Error(`Garmin returned HTTP ${res.status}.`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** List the user's own workouts (summaries — no step detail). */
export async function listWorkouts(limit = 999): Promise<WorkoutSummary[]> {
  const data = await apiGet(
    `/workout-service/workouts?start=1&limit=${limit}&myWorkoutsOnly=true&sharedWorkoutsOnly=false`,
  );
  return Array.isArray(data) ? (data as WorkoutSummary[]) : [];
}

/** Fetch a single workout with its full step structure. */
export async function getWorkoutDetail(workoutId: number): Promise<GarminWorkoutDetail> {
  return (await apiGet(`/workout-service/workout/${workoutId}?includeAudioNotes=true`)) as GarminWorkoutDetail;
}

/** Update an existing workout in the user's library. */
export async function updateWorkout(workoutId: number, payload: unknown): Promise<void> {
  const token = csrfToken();
  if (!token) throw new Error('Could not find the Garmin CSRF token — reload Garmin Connect and try again.');
  const res = await fetch(`${BASE}/workout-service/workout/${workoutId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: authHeaders(token, true),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403)
      throw new Error('Garmin rejected the request — your session may have expired. Reload Garmin Connect and try again.');
    throw new Error(`Garmin returned HTTP ${res.status}. ${text.slice(0, 200)}`.trim());
  }
}

/** Delete a workout from the user's library. */
export async function deleteWorkout(workoutId: number): Promise<void> {
  const token = csrfToken();
  const res = await fetch(`${BASE}/workout-service/workout/${workoutId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      ...(token ? { 'connect-csrf-token': token } : {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Garmin returned HTTP ${res.status} while deleting.`);
  }
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

// ---------------------------------------------------------------------------
// Coach data export
// ---------------------------------------------------------------------------

export interface CoachExport {
  exported_at: string;
  athlete: {
    ftp: number | null;
    vo2max: number | null;
    weight_kg: number | null;
    lthr: number | null;
    zones: {
      power: Array<{ zone: number; floor_w: number | null }>;
      hr: Array<{ zone: number; floor_bpm: number | null }>;
    };
  };
  readiness: {
    hrv_status: string | null;
    hrv_last_night_avg: number | null;
    hrv_7day_avg: number | null;
    training_readiness_score: number | null;
    training_readiness_level: string | null;
    body_battery_high: number | null;
    resting_hr: number | null;
    resting_hr_7day_avg: number | null;
    avg_stress_level: number | null;
    sleep_score: number | null;
    sleep_total_hours: number | null;
    sleep_deep_pct: number | null;
    sleep_rem_pct: number | null;
    sleep_light_pct: number | null;
    sleep_feedback: string | null;
  };
  load: {
    atl: number | null;
    ctl: number | null;
    acwr: number | null;
    training_status: string | null;
    recovery_time_hours: number | null;
  };
  trends: {
    hrv_7d: Array<{ date: string; hrv: number | null }>;
    resting_hr_7d: Array<{ date: string; resting_hr: number | null }>;
    vo2max_weekly: Array<{ date: string; vo2max: number | null }>;
  };
  recent_activities: Array<{
    date: string;
    type: string;
    tss: number | null;
    normalized_power: number | null;
    duration_min: number | null;
    avg_cadence: number | null;
  }>;
}

function localDateStr(d = new Date()): string {
  // Returns YYYY-MM-DD in local time
  return d.toLocaleDateString('sv');
}

function parseTrainingStatus(phrase: string | null | undefined): string | null {
  if (!phrase) return null;
  return phrase.replace(/_\d+$/, '').toLowerCase().replace(/_/g, ' ');
}

function powerZonesFromFtp(ftp: number | null): Array<{ zone: number; floor_w: number | null }> {
  const floors = [0, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51];
  return floors.map((frac, i) => ({
    zone: i + 1,
    floor_w: ftp ? Math.round(frac * ftp) : null,
  }));
}

/**
 * Fetch a multi-source snapshot of the athlete's current state for use by an
 * AI cycling coach. All requests run in parallel after a single profile lookup
 * to obtain the display name. Missing data is represented as null rather than
 * omitted so the consumer can distinguish "not available" from "zero".
 */
export async function exportCoachData(): Promise<CoachExport> {
  const today = localDateStr();
  const sevenDaysAgo = localDateStr(new Date(Date.now() - 7 * 86_400_000));
  const sixWeeksAgo = localDateStr(new Date(Date.now() - 42 * 86_400_000));

  const profileBase = (await apiGet('/userprofile-service/userprofile/userProfileBase')) as Record<string, unknown>;
  const displayName = (profileBase.displayName as string | undefined) ?? '';

  const [
    ftpResult,
    personalInfoResult,
    hrZonesResult,
    hrvResult,
    readinessResult,
    bodyBatteryResult,
    sleepStatsResult,
    sleepDetailResult,
    dailySummaryResult,
    trainingStatusResult,
    heartRateTrendResult,
    vo2maxWeeklyResult,
    activitiesResult,
  ] = await Promise.allSettled([
    apiGet('/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING'),
    apiGet(`/userprofile-service/userprofile/personal-information/${displayName}`),
    apiGet('/biometric-service/heartRateZones/'),
    // 7-day range so we can extract both today's snapshot and the full trend
    apiGet(`/hrv-service/hrv/daily/${sevenDaysAgo}/${today}`),
    apiGet(`/metrics-service/metrics/trainingreadiness/${today}`),
    apiGet(`/usersummary-service/stats/bodybattery/daily/${today}/${today}`),
    apiGet(`/sleep-service/stats/sleep/daily/${sevenDaysAgo}/${today}`),
    apiGet(`/wellness-service/wellness/dailySleepData/${displayName}?date=${today}`),
    apiGet(`/usersummary-service/usersummary/daily/${displayName}?calendarDate=${today}`),
    apiGet(`/metrics-service/metrics/trainingstatus/daily/${today}`),
    apiGet(`/usersummary-service/stats/heartRate/daily/${sevenDaysAgo}/${today}`),
    apiGet(`/metrics-service/metrics/maxmet/weekly/${sixWeeksAgo}/${today}`),
    apiGet(
      `/activitylist-service/activities/list/${displayName}` +
        `?startTimestampLocal=${sixWeeksAgo}T00:00:00.00` +
        `&endTimestampLocal=${today}T23:59:59.999&start=1&limit=1000`,
    ),
  ]);

  // --- athlete ---
  const ftp = ftpResult.status === 'fulfilled' ? extractFtp(ftpResult.value) : null;

  let vo2max: number | null = null;
  let weight_kg: number | null = null;
  let lthr: number | null = null;
  if (personalInfoResult.status === 'fulfilled') {
    const bio = (personalInfoResult.value as Record<string, unknown>).biometricProfile as Record<string, unknown> | null | undefined;
    if (bio) {
      const v = bio.vo2MaxCycling ?? bio.vo2Max;
      vo2max = typeof v === 'number' ? v : null;
      weight_kg = typeof bio.weight === 'number' ? Math.round((bio.weight as number) / 100) / 10 : null;
      lthr = typeof bio.lactateThresholdHeartRate === 'number' ? (bio.lactateThresholdHeartRate as number) : null;
    }
  }

  let hrZones: Array<{ zone: number; floor_bpm: number | null }> = [];
  if (hrZonesResult.status === 'fulfilled') {
    const arr = hrZonesResult.value as Array<Record<string, unknown>>;
    const entry = arr.find((z) => z.sport === 'CYCLING') ?? arr.find((z) => z.sport === 'DEFAULT');
    if (entry) {
      hrZones = [1, 2, 3, 4, 5].map((n) => ({
        zone: n,
        floor_bpm: typeof entry[`zone${n}Floor`] === 'number' ? (entry[`zone${n}Floor`] as number) : null,
      }));
    }
  }

  // --- readiness ---
  // HRV: last entry in the 7-day range is today; all entries feed the trend
  const hrvSummaries = (
    hrvResult.status === 'fulfilled'
      ? (((hrvResult.value as Record<string, unknown>).hrvSummaries ?? []) as Array<Record<string, unknown>>)
      : []
  );
  const todayHrv = hrvSummaries[hrvSummaries.length - 1];
  const hrv_status = typeof todayHrv?.status === 'string' ? (todayHrv.status as string).toLowerCase() : null;
  const hrv_last_night_avg = typeof todayHrv?.lastNightAvg === 'number' ? (todayHrv.lastNightAvg as number) : null;
  const hrv_7day_avg = typeof todayHrv?.weeklyAvg === 'number' ? (todayHrv.weeklyAvg as number) : null;

  let training_readiness_score: number | null = null;
  let training_readiness_level: string | null = null;
  let recovery_time_hours: number | null = null;
  if (readinessResult.status === 'fulfilled') {
    const entries = (readinessResult.value as Array<Record<string, unknown>>).slice().sort((a, b) => {
      const ta = typeof a.timestamp === 'string' ? new Date(a.timestamp as string).getTime() : 0;
      const tb = typeof b.timestamp === 'string' ? new Date(b.timestamp as string).getTime() : 0;
      return tb - ta;
    });
    const latest = entries[0];
    if (latest) {
      training_readiness_score = typeof latest.score === 'number' ? (latest.score as number) : null;
      training_readiness_level = typeof latest.level === 'string' ? (latest.level as string).toLowerCase() : null;
      // Garmin stores recovery time in minutes
      const rtMin = typeof latest.recoveryTime === 'number' ? (latest.recoveryTime as number) : null;
      recovery_time_hours = rtMin !== null ? Math.round((rtMin / 60) * 10) / 10 : null;
    }
  }

  let body_battery_high: number | null = null;
  if (bodyBatteryResult.status === 'fulfilled') {
    const arr = bodyBatteryResult.value as Array<{ values?: { highBodyBattery?: number } }>;
    body_battery_high = arr[0]?.values?.highBodyBattery ?? null;
  }

  // Sleep score + total from the weekly stats range (most recent night)
  let sleep_score: number | null = null;
  let sleep_total_hours: number | null = null;
  if (sleepStatsResult.status === 'fulfilled') {
    const stats = ((sleepStatsResult.value as Record<string, unknown>).individualStats ?? []) as Array<{ values?: Record<string, unknown> }>;
    const lastNight = stats[stats.length - 1];
    if (lastNight?.values) {
      sleep_score = typeof lastNight.values.sleepScore === 'number' ? (lastNight.values.sleepScore as number) : null;
      const secs = typeof lastNight.values.totalSleepTimeInSeconds === 'number' ? (lastNight.values.totalSleepTimeInSeconds as number) : null;
      sleep_total_hours = secs !== null ? Math.round((secs / 3600) * 10) / 10 : null;
    }
  }

  // Sleep stages + feedback from the detailed single-night endpoint
  let sleep_deep_pct: number | null = null;
  let sleep_rem_pct: number | null = null;
  let sleep_light_pct: number | null = null;
  let sleep_feedback: string | null = null;
  if (sleepDetailResult.status === 'fulfilled') {
    const dto = (sleepDetailResult.value as Record<string, unknown>).dailySleepDTO as Record<string, unknown> | undefined;
    if (dto) {
      const deep = typeof dto.deepSleepSeconds === 'number' ? (dto.deepSleepSeconds as number) : null;
      const rem = typeof dto.remSleepSeconds === 'number' ? (dto.remSleepSeconds as number) : null;
      const light = typeof dto.lightSleepSeconds === 'number' ? (dto.lightSleepSeconds as number) : null;
      const total = (deep ?? 0) + (rem ?? 0) + (light ?? 0);
      if (total > 0) {
        sleep_deep_pct = deep !== null ? Math.round((deep / total) * 100) : null;
        sleep_rem_pct = rem !== null ? Math.round((rem / total) * 100) : null;
        sleep_light_pct = light !== null ? Math.round((light / total) * 100) : null;
      }
      sleep_feedback = typeof dto.sleepScoreFeedback === 'string' ? (dto.sleepScoreFeedback as string).toLowerCase() : null;
    }
  }

  // Resting HR + stress from the daily summary
  let resting_hr: number | null = null;
  let resting_hr_7day_avg: number | null = null;
  let avg_stress_level: number | null = null;
  if (dailySummaryResult.status === 'fulfilled') {
    const s = dailySummaryResult.value as Record<string, unknown>;
    resting_hr = typeof s.restingHeartRate === 'number' ? (s.restingHeartRate as number) : null;
    resting_hr_7day_avg = typeof s.lastSevenDaysAvgRestingHeartRate === 'number' ? (s.lastSevenDaysAvgRestingHeartRate as number) : null;
    avg_stress_level = typeof s.averageStressLevel === 'number' ? (s.averageStressLevel as number) : null;
  }

  // --- load ---
  let atl: number | null = null;
  let ctl: number | null = null;
  let acwr: number | null = null;
  let training_status: string | null = null;
  if (trainingStatusResult.status === 'fulfilled') {
    const ts = trainingStatusResult.value as { latestTrainingStatusData?: Record<string, Record<string, unknown>> };
    const deviceData = Object.values(ts.latestTrainingStatusData ?? {})[0] as Record<string, unknown> | undefined;
    if (deviceData) {
      training_status = parseTrainingStatus(deviceData.trainingStatusFeedbackPhrase as string | undefined);
      const actl = deviceData.acuteTrainingLoadDTO as Record<string, unknown> | undefined;
      if (actl) {
        atl = typeof actl.dailyTrainingLoadAcute === 'number' ? Math.round(actl.dailyTrainingLoadAcute as number) : null;
        ctl = typeof actl.dailyTrainingLoadChronic === 'number' ? Math.round(actl.dailyTrainingLoadChronic as number) : null;
        acwr = typeof actl.dailyAcuteChronicWorkloadRatio === 'number' ? Math.round((actl.dailyAcuteChronicWorkloadRatio as number) * 100) / 100 : null;
      }
    }
  }

  // --- trends ---
  const hrv_7d = hrvSummaries.map((s) => ({
    date: s.calendarDate as string,
    hrv: typeof s.lastNightAvg === 'number' ? (s.lastNightAvg as number) : null,
  }));

  let resting_hr_7d: CoachExport['trends']['resting_hr_7d'] = [];
  if (heartRateTrendResult.status === 'fulfilled') {
    resting_hr_7d = (heartRateTrendResult.value as Array<{ calendarDate: string; values?: { restingHR?: number } }>).map((d) => ({
      date: d.calendarDate,
      resting_hr: typeof d.values?.restingHR === 'number' ? d.values.restingHR : null,
    }));
  }

  let vo2max_weekly: CoachExport['trends']['vo2max_weekly'] = [];
  if (vo2maxWeeklyResult.status === 'fulfilled') {
    vo2max_weekly = (vo2maxWeeklyResult.value as Array<{ cycling?: { calendarDate?: string; vo2MaxPreciseValue?: number } }>)
      .filter((w) => w.cycling?.calendarDate)
      .map((w) => ({
        date: w.cycling!.calendarDate as string,
        vo2max: typeof w.cycling?.vo2MaxPreciseValue === 'number' ? w.cycling.vo2MaxPreciseValue : null,
      }));
  }

  // --- recent cycling activities ---
  type ActivityRaw = {
    startTimeLocal?: string;
    activityType?: { typeKey?: string; parentTypeId?: number };
    sportTypeId?: number;
    trainingStressScore?: number | null;
    normPower?: number | null;
    duration?: number | null;
    averageBikingCadenceInRevPerMinute?: number | null;
  };

  let recent_activities: CoachExport['recent_activities'] = [];
  if (activitiesResult.status === 'fulfilled') {
    const list = ((activitiesResult.value as { activityList?: ActivityRaw[] }).activityList ?? []).filter(
      (a) => a.sportTypeId === 2 || a.activityType?.parentTypeId === 2,
    );
    recent_activities = list.map((a) => ({
      date: a.startTimeLocal?.slice(0, 10) ?? '',
      type: a.activityType?.typeKey ?? 'cycling',
      tss: typeof a.trainingStressScore === 'number' ? Math.round(a.trainingStressScore * 10) / 10 : null,
      normalized_power: typeof a.normPower === 'number' ? Math.round(a.normPower) : null,
      duration_min: typeof a.duration === 'number' ? Math.round(a.duration / 60) : null,
      avg_cadence: typeof a.averageBikingCadenceInRevPerMinute === 'number' ? Math.round(a.averageBikingCadenceInRevPerMinute) : null,
    }));
  }

  return {
    exported_at: new Date().toISOString(),
    athlete: {
      ftp,
      vo2max,
      weight_kg,
      lthr,
      zones: {
        power: powerZonesFromFtp(ftp),
        hr: hrZones,
      },
    },
    readiness: {
      hrv_status,
      hrv_last_night_avg,
      hrv_7day_avg,
      training_readiness_score,
      training_readiness_level,
      body_battery_high,
      resting_hr,
      resting_hr_7day_avg,
      avg_stress_level,
      sleep_score,
      sleep_total_hours,
      sleep_deep_pct,
      sleep_rem_pct,
      sleep_light_pct,
      sleep_feedback,
    },
    load: {
      atl,
      ctl,
      acwr,
      training_status,
      recovery_time_hours,
    },
    trends: {
      hrv_7d,
      resting_hr_7d,
      vo2max_weekly,
    },
    recent_activities,
  };
}
