<a href="https://extension.js.org" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>

# Garmin Workout Importer

A Chrome extension that imports structured workouts straight into your **Garmin
Connect** library from a `.json` or `.zwo` (Zwift) file. ZWO files are converted
to Garmin's structured-workout JSON format in the browser before upload.

The UI is an **in-page drawer**. A floating **Import workout** button sits at
the bottom-right of every Garmin Connect page; clicking it slides out a drawer
with the whole experience — file picker, FTP, power zones, an FTP-adaptive
preview, and import. Because it runs on `connect.garmin.com`, the upload uses
your real, logged-in session (same-origin) — so there is no separate login and
no Cloudflare challenge.

## How to use

1. Sign in to [connect.garmin.com](https://connect.garmin.com).
2. Click the floating **Import workout** button (bottom-right) — or the
   extension's toolbar icon — to open the drawer.
3. Pick a `.json` or `.zwo` file. Enter your **FTP** in watts — for ZWO the
   `% FTP` targets convert to watts and the preview chart + power zones update live.
4. Review the preview, set the workout name, and click **Import to Garmin**.
5. Use **Open workout** to jump to the imported workout on Garmin Connect.

## How it works

- A content script (`src/content/`) injects the drawer into the page inside a
  Shadow DOM (so Garmin's styles and ours stay isolated). It reads the file,
  converts ZWO → Garmin JSON, renders the power-profile preview (`WorkoutChart`)
  and power zones (`PowerZones`) that recompute as you change FTP.
- On import it reads the page's `<meta name="csrf-token">` and POSTs to
  `connect.garmin.com/gc-api/workout-service/workout` — the same call the Garmin
  web app makes itself.
- JSON files are normalized (server-managed fields stripped, step IDs cleared)
  the way Garmin expects for a freshly created workout.
- Conversion/preview logic lives in `src/lib/` (`zwo.ts`, `workout-json.ts`,
  `profile.ts`, `garmin-api.ts`).

### ZWO conversion notes

- **FTP** is prefilled: the last value you used is remembered (`chrome.storage`),
  and on open the extension also reads your latest cycling FTP from Garmin. A
  value you've typed always wins.
- **Ramps** — Zwift `Warmup`, `Cooldown`, and `Ramp` segments ramp power
  continuously. Garmin has no intra-step power ramp, so each ramp is split into
  several flat sub-steps (~one per 2 min, 3–8 steps) that step-approximate the
  slope. Short ramps stay a single step.
- **Cadence** — ZWO `Cadence` / `CadenceResting` become a Garmin secondary
  cadence target on the step.
- **Notes** — ZWO `<textevent>` messages become the step's description.

## Commands

### dev

```bash
npm run dev      # launches Chrome with the extension loaded + HMR
```

Sign in to Garmin Connect, then use the **Import workout** button.

### build

```bash
npm run build:chrome     # production build into dist/chrome
```

Load the unpacked build (`dist/chrome`) via `chrome://extensions` → **Load
unpacked** to run it in your day-to-day Chrome profile.

## Learn more

[Extension.js docs](https://extension.js.org).
