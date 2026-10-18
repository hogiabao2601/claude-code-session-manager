# claude-code-session-manager

A light, **read-only** local web app that shows every [Claude Code](https://claude.com/claude-code) session on your machine — across **multiple Claude accounts** — in one place.

- **Folders** — every directory where you started Claude Code, which account(s) used it, and how many sessions.
- **Sessions** — filter by account, folder, title, prompt or branch.
- **Session page** — the full conversation (tool calls collapsed), tokens, models, duration, and a one-click *resume command* for the right account.
- **Search** — full-text search across all conversations in all accounts.
- **Tokens & estimated cost** — per session, per account and in total (Overview shows the most expensive sessions). Cost = tokens × Anthropic API list prices from [`pricing.json`](pricing.json), including prompt-cache reads/writes. It's an *estimate*: subscription plans aren't billed per token, so read it as relative usage.
- **Usage tab** — in-app setup guide, plus the launch command for each detected account.

Zero dependencies. No build step. Nothing leaves your machine: the server binds to `127.0.0.1` only and never writes to your Claude folders.

## Run

Requires Node 18+.

```bash
git clone https://github.com/hogiabao2601/claude-code-session-manager
cd claude-code-session-manager
node server.js          # then open http://localhost:4780
```

Options: `--port 5000`, `--dir /path/to/extra/claude/config` (repeatable), `--help`.

## Multiple accounts

Claude Code reads its config folder from `CLAUDE_CONFIG_DIR` (default `~/.claude`). Give each account its own folder and alias:

```bash
# ~/.zshrc
alias claude.work='CLAUDE_CONFIG_DIR=$HOME/.claude_work claude'
```

Run `claude.work`, `/login` once, done. Folders named `~/.claude_*` or `~/.claude-*` are discovered automatically; use `--dir` for anything else.

## Notes

- Session files that were copied between accounts (same id and size) are listed under both accounts but counted once, under the oldest copy.
- Edit `pricing.json` when prices change or a new model appears; unpriced models are flagged with `?`.
- Sessions are top-level conversation files; subagent runs are counted per session but their tokens are not included in totals.
- Claude Code auto-deletes transcripts older than 30 days by default; raise `cleanupPeriodDays` in its settings to keep history.
- Summary cache lives in `~/.cache/claude-code-session-manager` (safe to delete).
- Search reads every transcript, so it takes a few seconds on multi-GB histories.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
