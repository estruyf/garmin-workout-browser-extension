# Privacy Policy — Garmin Workout Importer

**Last updated: June 11, 2026**

Garmin Workout Importer ("the extension") is a Chrome extension that helps you
manage and import structured workouts in your own [Garmin
Connect](https://connect.garmin.com) account. This policy explains exactly what
the extension does and does not do with your data.

**Short version:** the extension runs only on Garmin Connect, works entirely
between your browser and your own Garmin account, stores nothing about you
except your last-entered FTP (locally, on your device), and sends no data to the
developer or any third party.

## What the extension accesses

The extension operates only on pages under `https://connect.garmin.com/*`, using
your existing, already-signed-in Garmin Connect session. While you use it, it
can access:

- **Your Garmin workouts** — to list them, show a workout's details and power
  graph, create new workouts, and delete workouts you choose to delete. These
  actions use Garmin's own first-party APIs, the same ones the Garmin Connect
  website itself uses.
- **Your cycling FTP** — read from Garmin (and/or entered by you) to draw power
  zones and convert ZWO `% FTP` targets into watts.
- **Workout files you select** (`.json` or `.zwo`) — read locally in your
  browser only when you pick a file to import.

The extension acts strictly on your own Garmin Connect account and only when you
interact with it.

## What the extension stores

- **Your last-entered FTP** (a single number) is saved in `chrome.storage.local`
  so it can be prefilled next time. This value stays on your device and is not
  synced or transmitted anywhere.

The extension does not store your workouts, account details, credentials, or any
other personal information.

## What the extension sends, and where

- Network requests go **only to `connect.garmin.com`**, to your own Garmin
  account, using your existing session — the same requests the Garmin Connect
  web app makes.
- Workout files you choose are processed **locally in your browser** and are
  only uploaded to **your own Garmin Connect account** when you click Import.
- **No data is ever sent to the extension's developer or to any third party.**

## What the extension does NOT do

- It does **not** collect, transmit, or sell your personal data.
- It does **not** use analytics, tracking, advertising, or fingerprinting.
- It does **not** read or modify pages on any website other than Garmin Connect.
- It does **not** handle or store your Garmin username or password (you remain
  signed in through Garmin itself).
- It does **not** load or execute any remote code; all of its code is bundled in
  the published package.

## Permissions

- **`storage`** — to remember your last-entered FTP locally (see above).
- **Host access to `https://connect.garmin.com/*`** (via the content script) —
  required because the extension's entire functionality, and all of its API
  calls, happen on the Garmin Connect origin. No other sites are accessed.

## Third parties

The extension interacts only with Garmin Connect, which is operated by Garmin and
governed by [Garmin's own privacy policy](https://www.garmin.com/en-US/privacy/connect/).
The extension's developer receives no data from your use of the extension.

## Children's privacy

The extension is a general-purpose tool for managing your own Garmin workouts and
is not directed at children.

## Changes to this policy

If this policy changes, the updated version will be published in the extension's
repository with a new "Last updated" date.

## Contact

Questions about this policy or the extension can be sent to **eliostruyf@gmail.com**.
