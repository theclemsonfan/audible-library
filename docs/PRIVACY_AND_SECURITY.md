# Privacy and security — version 0.2.0

This is a single-owner self-hosted application, not an official Audible product.

## Data flow
Desktop Audible page → local isolated content-script DOM reader → extension service worker → the paired Next Chapter origin over HTTPS → private SQLite database. Local testing may use HTTP on localhost only.

The extension collects titles, ASINs, authors, narrators, series/positions, allowed cover URLs, visible completion/progress, purchase/return dates, and dates in the recent listening-history table. It does not collect audio, passwords, cookies, payment-card details, purchase totals, billing addresses, raw page HTML, or order IDs. It never plays audio, buys, returns, archives, rates, or changes completion in Audible. Selecting history/filter destinations changes the view, not the library.

`https://www.audible.com/*` is the only mandatory site permission. The manifest declares optional HTTPS origins so the user can grant the exact self-hosted app origin at pairing time. The software does not request all optional hosts. No Amazon-origin permission is requested; a redirect to authentication pauses collection. No remote code is loaded. No analytics are installed.

## Authentication
First-run setup needs a random setup key in the private data directory, then a new app password of at least 12 characters. Passwords are salted and scrypt-hashed. Session tokens are stored as SHA-256 digests; cookies use HttpOnly, SameSite=Strict, and Secure for HTTPS. Login and pairing attempts are rate-limited. App mutations require the configured origin. Host headers are checked to reduce DNS-rebinding risk. The app and API share one origin.

Pairing codes are random, expire in 10 minutes, and are single-use. Device tokens have only the sync/status capability, not library-read or app-admin privileges. Tokens are bound to the paired extension identity. They are held in extension local storage restricted to trusted extension contexts, not in content scripts. They are not stored in Chrome Sync. A browser-profile compromise can still compromise the device token. Revoking a browser in the app invalidates its token.

For privileged extension fetches where the browser omits Origin, an explicit extension-ID header accompanies the secret bearer token. This header is not authentication on its own. A conflicting Origin is rejected.

## Storage
SQLite transactions stage pages and promote only a completed library scan. Incomplete imports never replace the previous library. Duplicate page acknowledgements are idempotent. Changed page contents, repeated product IDs, and unstable pagination fail closed. A greater-than-30% count drop from a baseline of at least 20 books requires review rather than replacing the inventory.

Missing books are flagged, not deleted. Unknown fields are not silently replaced with false. Purchase versus membership access, return evidence, listening progress, the Finished flag, and local overrides are distinct.

Before replacing an existing inventory, the server writes a consistent SQLite backup; ten rotating snapshots are retained in its data directory. These are local backups, not independent off-site redundancy. Protect the data directory and copy consistent backup files to a separate private destination. Never commit it to a public repository. The database is not encrypted by this application; use encrypted host storage and HTTPS.

This release has automated code/HTTP tests and synthetic-DOM tests. It has not had an independent security audit, an actual iPhone Safari test, a live Audible extension installation test, or a hosted production TLS test. Do not expose an unconfigured service publicly. Set the real PUBLIC_URL before enabling external access.
