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

## Run as a background app (`sessions.sh`)

```bash
./sessions.sh start -d      # start in the background, terminal is released
./sessions.sh start         # foreground, Ctrl+C stops it
./sessions.sh stop
./sessions.sh restart -d
./sessions.sh status
```

| Option | Description |
|---|---|
| `-d`, `--detach` | Run in the background (`start` / `restart`) |
| `-p`, `--port N` | Port (default `4780`) |
| `--dir PATH` | Extra Claude config dir to include (repeatable) |

Server output goes to `logs/server.log`, script actions to `logs/sessions_<timestamp>.log`, and the PID to `.run/server.pid`.
Exit codes: `0` ok, `1` error, `2` bad arguments, `3` `status` found it not running.
A detached server does not survive a reboot; use a launchd agent for that.

## Plan usage (5-hour / weekly limits)

Account cards show the 5-hour and weekly plan usage, the percentage left and when each window resets. Claude Code only exposes these numbers to its **status line** script (`rate_limits` in the stdin JSON), so the script saves a snapshot per account to `~/.claude/usage-snapshots/<account>.json` and the dashboard reads those files. No OAuth tokens are read.

Add this near the top of the script your `statusLine` runs. Every account's `settings.json` must run a script that does this. The account id is the config folder name without the leading dot.

```sh
snap_id=$(basename "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" | sed 's/^\.//')
mkdir -p "$HOME/.claude/usage-snapshots"
echo "$input" | jq -c --arg acc "$snap_id" --argjson now "$(date +%s)" \
  'select(.rate_limits.five_hour != null or .rate_limits.seven_day != null)
   | {account:$acc, savedAt:$now, five_hour:.rate_limits.five_hour, seven_day:.rate_limits.seven_day}' \
  > "$HOME/.claude/usage-snapshots/$snap_id.json"
```

A snapshot updates only while you use Claude Code in that account (after its first reply), so an idle account shows its last values marked as possibly out of date. Only Pro/Max subscriptions report these fields.
