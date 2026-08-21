# GitHermes

GitHub PRs & Issues as a right workspace pane in [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop).

> **Community plugin.** GitHermes is an open-source, independent project. It is **not** an official Nous Research product and is not developed or maintained by the Hermes team. It works with Hermes Desktop through its public plugin API.
>
> Sponsored by [CheaperInference](https://cheaperinference.com).

A single-file desktop plugin (`@hermes/plugin-sdk`) that shows your repository's open PRs and issues in a dockable pane — conversation, reviews, commits, checks, files, and in-pane merge — styled after GitHub and themed with Hermes `--ui-*` variables. No backend, no extra token: data comes from the connected `gh` CLI via `host.request('shell.exec')`.

| PR list | PR detail |
| --- | --- |
| ![PR list pane](docs/pr-list.png?v=3) | ![PR detail view](docs/pr-detail.png?v=3) |

| Conversation (inline review) | Commits |
| --- | --- |
| ![Inline review threads](docs/pr-conversation.png) | ![Commits tab](docs/pr-commits.png) |

| Issues |
| --- |
| ![Issue list](docs/issue-list.png) |

## Features

- **PR list** — state pills, `+N / −N`, relative timestamps, **CI** (`passing / pending / failing`) and **review** (`approved / changes / required`) chips, exact `#N` search (`#42` does not match `#142`)
- **Session chip + repo picker** — PR for the active session branch (same join as the core review pane); 32px pill with `https://github.com/{owner}.png` avatar
- **PR / Issue header** — kicker, grouped meta chips, title glued to `#`, **Merge** action on open PRs (`squash / merge / rebase`, optional delete-branch, `GH_PROMPT_DISABLED=1`)
- **Conversation** — `gh-timeline` rail, GFM subset (quotes, task lists, tables, `<details>`, strikethrough; raw HTML stripped), icon-only Quote → active composer, compact checks strip (`Blocked` / `Waiting` / `All passed`)
- **Inline review threads** — `file:line` chip (`original_line` fallback), collapsed diff hunk, replies grouped by `in_reply_to_id`
- **Jump to latest** — floating control on the Radix viewport only (nested code/table scrollers ignored); remeasures when the detail DOM mounts
- **Commits** — same rail; each row is a `<details>` with lazy-loaded body / `+−` / files; SHA + external link do not toggle
- **Files** — unified hunks per file, line numbers, theme diff colors, `A/D/M/R` badge; unboxed header, border on the diff body
- **Issues** — label chips in the label's own color, black/white text via W3C relative luminance
- **Theme** — field surfaces on `--ui-editor-surface-background` (matte/glass inherited from Desktop); cards on `--ui-bg-quaternary`; container queries at `<360` / `<300` / `<240`

## Requirements

- Hermes Desktop
- [`gh`](https://cli.github.com/) installed and authenticated (`gh auth status`)

## Install

```bash
hermes plugins install claudioorjunior/githermes --enable
```

Or manually: drop this folder into `~/.hermes/plugins/githermes/` (unified package — the desktop half lives at `desktop/plugin.js`), or copy `desktop/plugin.js` to `~/.hermes/desktop-plugins/githermes/plugin.js` (standalone disk door). The app hot-reloads on save.

### Upgrading from `github-prs`

The plugin **id** changed (`github-prs` → `githermes`), so the old install must be removed first — delete the old folder (`~/.hermes/desktop-plugins/github-prs/` or `~/.hermes/plugins/github-prs/`), then install fresh. One-time cost: the saved repository in the picker resets (plugin storage is namespaced by id).

## Development notes

- Disk plugins load **uncompiled**: UI is written with `jsx()`/`jsxs()` calls, no JSX syntax, no build step.
- Only `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime` are importable.
- Tailwind classes must already exist in the app's compiled CSS — arbitrary `var()` bracket forms (`bg-[var(--x)]`) are silently dead at runtime. Use the paren shorthand (`text-(--ui-text-tertiary)`) or scoped `<style>` blocks with real theme variables.
- Large `gh` payloads go through `shBig` / `shJsonBig` (base64 chunks under the gateway stdout cap). Lists are capped at 30 rows by design.

## Status & contributing

Early stage — expect bugs; reports and PRs are very welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

---

🇧🇷 **PT-BR:** pane de PRs e Issues no Hermes Desktop. Lista com CI/review, busca `#N` exata, header preenchido, merge no pane, timeline com threads inline (`file:line` + diff), jump-to-latest no viewport, commits em `<details>` lazy, diffs por hunk, labels com contraste W3C. Sem backend — só `gh` via `shell.exec`.
