# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Schedule a workout** — pick a date in a workout's detail view and add it to your Garmin calendar, with a link to the calendar and a Remove button to take it back off
- The same workout can be scheduled on several days (a plan repeats sessions); each date is listed separately and can be removed on its own
- A freshly created or imported workout offers the date picker right in its confirmation, so it can go on the calendar without a detour through the list
- **Download a workout** — a workout's detail view can now save it as `.json` (a full backup this extension can import again) or as `.zwo`, so a Garmin session can be ridden in Zwift
- Anything Zwift cannot express — heart-rate targets, distance or lap-button steps, repeat groups that are not a simple on/off pair — is reported under the download buttons instead of silently changing the workout
- **Bulk actions in the workout list** — checkboxes on every workout, with "select page" and "select all matching" shortcuts; the selection is kept while you page through the list or change the search
- Bulk delete removes the whole selection in one confirmed step, and reports any workout Garmin refused to delete by name instead of failing the run
- Bulk download saves each selected workout as its own `.json` or `.zwo` file; non-cycling workouts are skipped for ZWO and listed afterwards, and workouts sharing a name get a numbered suffix so no download is overwritten
- **Create a workout** — new button in the workout list that opens a builder: name it, add steps, and send it straight to Garmin without a file
- Six one-click templates (endurance ride, sweet spot 3×15, threshold 4×8, VO₂ max 5×4, over–unders 3×12, recovery spin) whose power targets are set as a percentage of your FTP, so they re-scale when you change it
- Power targets can be typed as `% FTP` instead of watts anywhere in the step editor — the watt equivalent is shown next to the fields
- Optional workout description on a new workout

### Changed

- New steps start with a power target prefilled from your FTP instead of 0 W
- Steps added in the editor are numbered before a workout is created, so Garmin keeps them in the order you see

## [1.4.0] - 2026-07-20

### Added

- Pagination in the workout list — 25 workouts per page, with the page controls pinned to the bottom of the drawer
- Creation date on each workout in the list, shown in your local date format

### Changed

- Only the workout list scrolls now — the import and export buttons stay pinned at the top of the drawer

## [1.3.0] - 2026-06-24

### Added

- **Export coach data** — new button in the workout list that downloads a `garmin-coach-export-YYYY-MM-DD.json` snapshot for use with AI cycling coaches
- Athlete profile in the export: FTP, VO2max, weight, lactate threshold HR, and computed power/HR zones
- Readiness snapshot: HRV status, last-night HRV, 7-day HRV average, training readiness score and level, body battery, resting HR, 7-day average resting HR, daily stress level, sleep score, total sleep hours, sleep stage breakdown (deep/REM/light %), and a qualitative sleep feedback phrase
- Training load in the export: acute load (ATL), chronic load (CTL), acute/chronic ratio, training status, and recommended recovery time
- Trend data: 7-day per-night HRV, 7-day daily resting HR, and multi-week VO2max progression
- Last 6 weeks of cycling activities in the export: date, type, TSS, normalized power, duration, and average cadence

## [1.2.0] - 2026-06-17

### Added

- Drag-and-drop file upload in the import panel (alongside the existing file picker)
- Edit workout steps before importing — open the step editor directly from the import preview
- Add new steps to a workout (interval, warm-up, cool-down, recovery, rest, or repeat group)
- Drag-and-drop reordering of steps in the workout editor
- Delete button directly on each step row

## [1.1.0] - 2026-06-11

### Added

- Browse and search your Garmin workout library from the in-page drawer
- View workout details including the power-profile chart and step breakdown
- Delete workouts directly from the drawer
- Edit an existing workout
- Clone a workout
- Privacy policy
- Updated extension icon

## [1.0.0]

- Initial release.