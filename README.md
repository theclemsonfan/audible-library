# Next Chapter — deployment candidate 0.2.0

A private audiobook series manager with an automated, read-only desktop Chrome/Brave companion.

**This package contains working app/server code, not just a UI prototype. It is not yet a verified live Audible integration or an already-deployed website.** The previously published ChatGPT preview is unchanged.

Open **START_HERE.html** for the setup guide. Full deployment details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Security/data flow: [docs/PRIVACY_AND_SECURITY.md](docs/PRIVACY_AND_SECURITY.md). Validation evidence: [docs/VALIDATION.md](docs/VALIDATION.md).

## Included
- Responsive library and series interface, search, filters, purchase/listening-date sorting, local completion overrides, favorites and notes.
- Authenticated Node server, persistent SQLite data, import-only device tokens, one-time pairing, staged/idempotent imports, consistent rotating backups.
- Manifest V3 companion, automatic weekly due checks and startup catch-up, page checkpoints, resumable worker state, all-year initial purchase/refund backfill, optional series catalog scans.
- Fail-closed parsing, ownership uncertainty, separate Finished/progress evidence, no deletion of missing books, a count-drop guard.
- Windows/Mac local launchers, Docker packaging, optional HTTPS reverse proxy, automated tests and read-only deployment probe.

## Test evidence
101 automated Node tests and 23 rendered synthetic-DOM/UI checks passed. The local server also passed five access/readiness probes. These are not live Audible acceptance tests. See docs/VALIDATION.md for the exact boundary.

## Runtime
Node.js 24 LTS recommended. No runtime npm dependencies. SQLite requires persistent disk; this is **not** a static-only or ephemeral-filesystem deployment. Local-only mode uses localhost HTTP; any externally accessible origin must use HTTPS.

```sh
node scripts/start-local.mjs
```

```sh
npm test
```

## Honest limits
Archived-item coverage is unverified. The web's recent listening-history window is not a complete listening log. Catalog layout support may need tuning against the actual account. Chrome/Brave installation, account sign-in and actual collection must be validated on desktop. An iPhone can use the hosted app, but is not the scheduled Chrome/Brave collector. No production deployment, Web Store publication, permissions grant, hosting purchase or private library upload was performed while preparing this package.

There is no code that extracts Amazon credentials/cookies, downloads audio, makes purchases, returns books or modifies Audible listening state. Private data and secrets must never be committed to this public repository.
