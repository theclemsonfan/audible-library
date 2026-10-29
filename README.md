# Next Chapter — Audible Series Manager

This repository contains an **early, untested prototype**, not a deployed or functioning weekly sync.

- `app/`: mobile-responsive library browser, currently accepts local JSON imports only.
- `extension/`: Manifest V3 Chrome/Brave companion prototype, designed to scan Audible pages and POST to a private HTTPS import endpoint.
- **Not implemented:** private authenticated server endpoint, database, purchase-history reconciliation, archive coverage, full series metadata parsing, tests against live Audible, deployment, and reliable weekly scheduling validation.
- Do not install as production-ready. The collector's selectors, permissions, and pagination must be verified and hardened against the real Audible DOM.
- Never store Audible passwords or cookies in the extension. Never upload private library data to this public source repository.
