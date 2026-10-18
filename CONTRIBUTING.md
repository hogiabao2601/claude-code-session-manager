# Contributing

Thanks for helping! This is a small, dependency-free project — please keep it that way.

- **Run:** `node server.js` (Node 18+), open http://localhost:4780.
- **Layout:** `server.js` (indexer + JSON API, read-only), `public/` (vanilla JS UI, no build step), `pricing.json` (model prices).
- **Principles:** read-only (never write to Claude's folders), local-only (bind to 127.0.0.1), zero runtime dependencies, works on any machine (no hard-coded paths or account names).
- **Prices:** update `pricing.json` from Anthropic's pricing page; include the `updated` date.
- **PRs:** keep them focused, describe what you changed and how you checked it (a screenshot helps for UI changes). If you change what the indexer stores per session, bump `CACHE_VERSION` in `server.js`.
- **Bugs:** open an issue with your OS, Node version, and (without private content) what the Usage tab shows for your accounts.
