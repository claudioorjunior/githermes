# github-prs

GitHub PRs & Issues as a right workspace pane in [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop).

A single-file desktop plugin (`@hermes/plugin-sdk`) that shows your repository's open PRs and issues in a dockable pane, with a full PR detail view: conversation, reviews, commits, checks, and files — styled after GitHub and themed with Hermes' own `--ui-*` variables.

## Features

- **PR list** for the current repo: state pills, diff counts (`+N` green / `−N` red), relative timestamps
- **PR detail view** with tabs: Conversation, Commits, Checks, Files
- **GitHub-style comments**: nested quotes, task lists, tables, `<details>` collapsibles, strikethrough — rendered by a built-in GFM subset parser (raw HTML stripped)
- **Session PR detection**: finds the PR for the active session's branch, same join as the core review pane
- **No backend, no tokens**: all data comes from the connected `gh` CLI via `host.request('shell.exec')`

## Requirements

- Hermes Desktop
- [`gh`](https://cli.github.com/) installed and authenticated (`gh auth status`)

## Install

```bash
hermes plugins install claudioorjunior/hermes-github-prs --enable
```

Or manually: drop this folder into `~/.hermes/plugins/github-prs/` (unified package — the desktop half lives at `desktop/plugin.js`), or copy `desktop/plugin.js` to `~/.hermes/desktop-plugins/github-prs/plugin.js` (standalone disk door). The app hot-reloads on save.

## Development notes

- Disk plugins load **uncompiled**: UI is written with `jsx()`/`jsxs()` calls, no JSX syntax, no build step.
- Only `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime` are importable.
- Tailwind classes must already exist in the app's compiled CSS — arbitrary `var()` bracket forms (`bg-[var(--x)]`) are silently dead at runtime. Use the paren shorthand (`text-(--ui-text-tertiary)`) or scoped `<style>` blocks with real theme variables.

## License

MIT
