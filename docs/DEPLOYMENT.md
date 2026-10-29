# Deployment and installation

## What is ready
The package contains the full web app, authenticated server, SQLite persistence, desktop Chrome/Brave extension, tests, launchers, and Docker/HTTPS configuration. There is no missing import endpoint to program. No runtime npm packages or AI API keys are needed. The release is a deployment candidate pending live account and target-host validation.

## Important boundary
The existing ChatGPT-hosted preview has not been modified. This package is not already connected to that preview. Deploy the full app and server together at one HTTPS origin for use on your phone. Uploading only the `app` directory to a static host does NOT provide synchronization. SQLite needs persistent disk: an ephemeral/serverless filesystem is not appropriate.

No hosting account, paid service, domain, firewall rule, certificate, or browser permission has been provisioned by this work.

## First local test — Windows or Mac
Extract the complete package into a permanent folder. Install a current Node.js 24 LTS build from the official vendor if Node is not present. The code has also been exercised on Node 22.16 in the build environment. Double-click START-WINDOWS.cmd on Windows, or run START-MAC.command on Mac. If the Mac requires an explicit terminal launch, open a terminal in the extracted folder and run:

```sh
node scripts/start-local.mjs
```

The launcher starts the server, opens the setup page, and supplies the one-time setup key via a URL fragment. Choose a new app password; do not use or provide an Amazon password. Keep the launcher window open. This local mode is deliberately restricted to the same computer, not remotely exposed.

Local desktop address:

```text
http://localhost:8787
```

An already running app can be opened at the same address. The private data are in the extracted folder's `data` directory. Do not delete that directory when upgrading. If Node cannot be found, the launcher prints the prerequisite instead of silently failing.

## Desktop extension
In Chrome, open:

```text
chrome://extensions
```

In Brave, open:

```text
brave://extensions
```

Enable Developer mode and choose Load unpacked. Select the extracted `extension` folder—the one containing `manifest.json`. This is an unpacked developer build, not a signed Chrome Web Store release. Do not move or delete the folder after installation.

Open the app → Sync & settings → Generate pairing code. Open the extension. Use the app's Copy app address and Copy pairing code buttons, paste each into its labeled field, and select Pair browser. Approve access only to your chosen app origin. Then sign in to Audible normally in this same desktop browser profile. Select Sync now in the extension.

The first sync reads all visible audiobook pages, recent history, purchase/refund history by the years actually offered by Audible, and (when enabled) series catalog pages. Subsequent runs preserve older evidence and refresh the library, recent history, and catalog. A large library may take several minutes; watch the actual counts rather than expecting an instantaneous import. You may close the extension popup without stopping collection. Do not manually repurpose its dedicated scan tab.

The app records the last completed scan and coverage warnings. Real library state changes only when the required library scan finishes. Archive coverage remains unverified. The recent listening-history window is not a complete listening log. A catalog discovery does not imply that you do not own a different edition or bundle.

## Weekly automation
Automatic sync is enabled at pairing. The extension checks approximately hourly for the next due run, scheduled Sunday at about 8 AM in the desktop's local timezone. An already overdue run catches up on browser startup. Chrome alarms are not precise wake-up timers; the computer must be awake and the browser running. Browser suspension or closing preserves the checkpoint. The one-minute progress alarm resumes an interrupted active run; it does not keep the computer awake. Authentication/verification pauses require user attention. No ChatGPT session is required after installation.

## Deploy for iPhone access
Use an existing Docker-capable server with persistent disk and HTTPS. This package includes an optional Caddy reverse proxy. Set your real hostname in a private `.env` file, using `.env.example` as a template. PUBLIC_URL must equal the exact browser-facing HTTPS origin. APP_DOMAIN is the hostname without a scheme. DNS must point to the host and HTTPS must be reachable. Do not use the example domain literally.

Start the HTTPS deployment from the project folder:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Retrieve the one-time setup key through your own server terminal:

```sh
docker compose exec app cat /app/data/setup-key.txt
```

Open your actual HTTPS app URL, enter this key, and choose an app password. Once setup succeeds the setup-key file is deleted. If your host injects a SETUP_TOKEN instead, provide it through a private environment setting of at least 24 characters, never a committed file.

The app's health check is available at `/healthz`. Docker uses the configured host header in its local health probe. The reverse proxy handles TLS; the app's internal port is not publicly bound. Persistent data are stored in the named `next_chapter_data` volume. Do not use `docker compose down -v`, because `-v` destroys the data volume.

On iPhone, open the HTTPS app URL in Safari, sign in, and use Share → Add to Home Screen. Pair the desktop extension to this HTTPS URL, not the earlier localhost URL. The collector remains on desktop; the iPhone reads the same server database. No separate iPhone extension is required.

## Backups and upgrades
Ten consistent server-side SQLite snapshots rotate automatically before a new completed import replaces existing data. You may request another snapshot in Sync & settings. A backup on the same disk does not protect against loss of that host; copy consistent snapshots privately elsewhere.

For local mode, create a snapshot from the project folder:

```sh
node scripts/backup.mjs
```

To restore, stop the server, preserve the current data directory, copy the chosen consistent backup to `data/next-chapter.sqlite`, remove its old WAL/SHM companion files only while stopped, and restart. A restore also restores the account/device/session state from the snapshot. Revoke or re-pair devices afterward when appropriate. Do not overwrite the database while the server is running.

## Validation before relying on it
Run code and safety checks:

```sh
npm run check
```

Run automated tests:

```sh
npm test
```

For an installed local server, run a read-only access probe:

```sh
node scripts/verify-deployment.mjs http://localhost:8787
```

For a hosted server, supply its actual HTTPS origin instead. Then perform a real sync, compare a sample of owned/unfinished/finished books with Audible, confirm last-page coverage, close/reopen the desktop browser, and verify the same library from the iPhone. None of those target-device/live-account checks has been performed by this package build.

## Troubleshooting
“Sign-in required” or verification: use Open Audible / sync tab in the extension, complete Audible's own sign-in or verification yourself, then Resume. The collector does not bypass site controls.

“Layout not recognized”: the specific adapter must be updated after inspecting the current page. It does not invent data or replace the saved library with zero books. Optional history/catalog failures appear as coverage warnings.

“Another browser has an unfinished sync”: stop the original extension job, or use Stop abandoned run in the app's Sync screen, before starting on another browser.

Server unreachable: start/recover the app server and select Resume. After three backoff attempts the collector pauses rather than retrying indefinitely.

A pairing token was revoked: choose Unpair this browser and generate a new code in the app. This never deletes the server library.

A catastrophic count-drop guard fired: review whether you are signed into the right Audible account or whether filtering/layout changed. No override is provided that silently discards the old inventory.
