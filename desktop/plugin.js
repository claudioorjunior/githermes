/**
 * github-prs — GitHub PRs & Issues as a right workspace pane.
 * Data via `host.request('shell.exec')` + connected `gh`. No backend.
 * Session PR: cwd git branch (same join as core review) + transcript URL scan.
 * ponytail: lists cap at 30 rows by design; payloads route through shBig (stdout 4000 cap).
 */
import {
  host,
  atom,
  useValue,
  useQuery,
  queryClient,
  Button,
  Input,
  Badge,
  CopyButton,
  StatusDot,
  ScrollArea,
  EmptyState,
  ErrorState,
  GlyphSpinner,
  Skeleton,
  SearchField,
  SegmentedControl,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Codicon,
  icons,
  cn,
  relativeTime,
  PALETTE_AREA,
  TITLEBAR_AREAS,
  PANES_AREA,
  Tip,
} from '@hermes/plugin-sdk'
import { useState, useEffect } from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'

const ID = 'github-prs'
const PANE_ID = `${ID}:pane`
const REVEAL = 'hermes:pane-toggle-reveal'
const GITHUB_ROUTE = '/github'
// Registry areas as string literals — works even if the SDK build omits the
// named exports; the host keys contributions by these exact strings.
const ROUTES_AREA_LIT = 'routes'
const SIDEBAR_NAV_LIT = 'sidebar.nav'
const TRUNK = new Set(['main', 'master', 'dev', 'develop', 'trunk'])
const GH = 'PATH=/opt/homebrew/bin:/usr/local/bin:$PATH gh'
const PR_URL = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)\/pull\/(\d+)/i

let pluginCtx = null

// Scoped wrap fix. Radix ScrollArea wraps children in a display:table div
// (content-measuring hack) that lets content grow wider than the pane instead of
// wrapping; the viewport's overflow-x:hidden then silently clips it. Force block
// layout so content reflows to the pane width. Inline style => !important needed.
// Selectors are prefixed so they can only match inside this pane.
const PANE_WRAP_CSS = `
.github-prs-pane, .github-prs-pane * { box-sizing: border-box; }
.github-prs-pane {
  width: 100%; max-width: 100%; min-width: 0; overflow: hidden; background: var(--ui-editor-surface-background);
  container-type: inline-size;
}
.github-prs-pane [data-radix-scroll-area-viewport] > div { display: block !important; min-width: 0 !important; width: 100% !important; }
.github-prs-pane :is(h1, h2, h3, h4, h5, h6, p, li, a, span, code, summary, td, th, blockquote) { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.github-prs-pane pre { max-width: 100%; overflow-x: auto; }
/* Runtime plugins need scoped divide color because Tailwind variants are not compiled. */
.github-prs-pane .gh-divide > :not(:last-child) { border-bottom: 1px solid var(--ui-stroke-secondary); }
.github-prs-pane .gh-shell-header {
  background: var(--ui-editor-surface-background);
  box-shadow: inset 0 -1px var(--ui-stroke-secondary);
}
.github-prs-pane .gh-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ui-stroke-secondary);
  background: var(--ui-bg-quaternary);
  color: var(--ui-text-secondary);
}
.github-prs-pane .gh-repo-trigger {
  height: 32px;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  border-color: var(--ui-stroke-secondary);
}
.github-prs-pane .gh-repo-trigger:hover,
.github-prs-pane .gh-repo-trigger[data-state='open'] {
  background: var(--ui-bg-quinary);
  box-shadow: none;
}
.github-prs-pane .gh-list { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.github-prs-pane .gh-list-row {
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: 8px;
  background: var(--ui-bg-quaternary);
  transition: border-color 120ms ease, background-color 120ms ease;
}
.github-prs-pane .gh-list-row:hover {
  border-color: color-mix(in srgb, var(--ui-accent) 55%, var(--ui-stroke-secondary));
  background: var(--ui-bg-quinary);
}
.github-prs-pane .gh-list-row:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.github-prs-pane .gh-list-title { font-size: 13px; line-height: 18px; font-weight: 600; }
.github-prs-pane .gh-list-heading { color: var(--ui-text-tertiary); letter-spacing: .04em; text-transform: uppercase; }
.github-prs-pane .gh-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: 999px;
  background: var(--ui-bg-editor);
  padding: 1px 6px;
  color: var(--ui-text-secondary);
  white-space: nowrap;
}
.github-prs-pane .gh-card-arrow { color: var(--ui-text-quaternary); opacity: .5; }
.github-prs-pane .gh-list-row:hover .gh-card-arrow { color: var(--ui-accent); opacity: 1; }
.github-prs-pane .gh-empty {
  min-height: 280px;
  background: transparent;
}
.github-prs-pane .gh-empty-icon { width: 48px; height: 48px; border-radius: 14px; font-size: 20px; }
.github-prs-pane .gh-detail-summary {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background-color: var(--ui-bg-quaternary);
  background-image: radial-gradient(circle, color-mix(in srgb, var(--ui-stroke-secondary) 55%, transparent) 0.65px, transparent 0.7px);
  background-size: 8px 8px;
}
.github-prs-pane .gh-detail-title { display: block; }
.github-prs-pane .gh-detail-title .gh-item-num { white-space: nowrap; }
.github-prs-pane .gh-detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 10px;
  row-gap: 6px;
}
.github-prs-pane .gh-detail-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.github-prs-pane .gh-detail-tabs { background: var(--ui-editor-surface-background); }
.github-prs-pane .gh-detail-tabs > div { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.github-prs-pane .gh-detail-tabs button,
.github-prs-pane .gh-list-tabs button { min-width: 0; overflow: hidden; padding-inline: 6px; text-overflow: ellipsis; white-space: nowrap; }
.github-prs-pane .gh-list-tabs > div { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.github-prs-pane .gh-comment-action { opacity: .45; transition: opacity 120ms ease; }
.github-prs-pane .gh-comment:hover .gh-comment-action,
.github-prs-pane .gh-comment:focus-within .gh-comment-action { opacity: 1; }
.github-prs-pane .gh-timeline { display: flex; flex-direction: column; gap: 12px; }
.github-prs-pane .gh-timeline > :is(.gh-comment, .gh-commit) { position: relative; }
.github-prs-pane .gh-timeline > .gh-comment:has(+ .gh-comment)::after,
.github-prs-pane .gh-timeline > .gh-commit:has(+ .gh-commit)::after {
  content: '';
  position: absolute;
  left: 11px;
  width: 1px;
  background: var(--ui-stroke-secondary);
  pointer-events: none;
}
.github-prs-pane .gh-timeline > .gh-comment:has(+ .gh-comment)::after { top: 26px; bottom: -12px; }
.github-prs-pane .gh-timeline > .gh-commit:has(+ .gh-commit)::after { top: 16px; bottom: -12px; }
.github-prs-pane .gh-commit-node {
  width: 8px; height: 8px; margin: 6px 7px 0; flex: none;
  border-radius: 50%;
  border: 1.5px solid var(--ui-text-quaternary);
  background: var(--ui-editor-surface-background);
}
.github-prs-pane .gh-commit-action { opacity: .45; transition: opacity 120ms ease; }
.github-prs-pane .gh-commit:hover .gh-commit-action,
.github-prs-pane .gh-commit:focus-within .gh-commit-action { opacity: 1; }
.github-prs-pane .gh-commit > summary { cursor: pointer; list-style: none; }
.github-prs-pane .gh-commit > summary::-webkit-details-marker { display: none; }
.github-prs-pane .gh-commit-panel { margin-left: 26px; margin-top: 8px; padding-bottom: 4px; }
.github-prs-pane .gh-narrow-only { display: none; }
@container (max-width: 359px) {
  .github-prs-pane .gh-detail-tabs > div { display: flex; width: 100%; overflow-x: auto; }
  .github-prs-pane .gh-detail-tabs button { flex: none; min-width: max-content; }
}
@container (max-width: 299px) {
  .github-prs-pane .gh-comment { display: block; }
  .github-prs-pane .gh-comment-avatar { display: none; }
  .github-prs-pane .gh-timeline > .gh-comment:has(+ .gh-comment)::after,
  .github-prs-pane .gh-timeline > .gh-commit:has(+ .gh-commit)::after { display: none; }
  .github-prs-pane .gh-commit-action { opacity: 1; }
  .github-prs-pane .gh-comment-action { opacity: 1; }
  .github-prs-pane .gh-detail-meta { display: none; }
  .github-prs-pane .gh-detail-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
}
@container (max-width: 239px) {
  .github-prs-pane .gh-pane-content { display: none; }
  .github-prs-pane .gh-narrow-only { display: flex; }
}
`

function sq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

export function parseRemote(url) {
  if (!url) return null
  const s = String(url).trim()
  const m = s.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/i)
  return m ? m[1].replace(/\.git$/i, '') : null
}

export function extractPrRef(text) {
  const m = String(text || '').match(PR_URL)
  if (!m) return null
  return { repo: `${m[1]}/${m[2].replace(/\.git$/i, '')}`, number: Number(m[3]) }
}

// SDK relativeTime(targetMs: number) — gh returns ISO strings. NaN throws in Intl.
export function ago(iso) {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  return Number.isFinite(ms) ? relativeTime(ms) : ''
}

// GitHub-style diff counts: +N green, −N red, theme-aware via diff vars.
function DiffCount({ add, del, className }) {
  return jsxs('span', { className: cn('font-mono', className), children: [
    jsx('span', { className: 'text-(--ui-diff-add-foreground)', children: `+${add ?? 0}` }),
    jsx('span', { children: ' ' }),
    jsx('span', { className: 'text-(--ui-diff-remove-foreground)', children: `−${del ?? 0}` }),
  ] })
}

function openGithubPane() {
  try {
    window.dispatchEvent(new CustomEvent(REVEAL, { detail: { id: PANE_ID, mode: 'open' } }))
  } catch { /* older shells ignore */ }
}

function openGithubPage() {
  if (typeof host.navigate === 'function') host.navigate(GITHUB_ROUTE)
  else openGithubPane()
}

function openExternal(url) {
  if (url) pluginCtx?.os.openExternal(url)
}

// Issue #1: quote a comment into the active session's composer (draft, NOT sent).
// Core's composer subscribes to these window events (chat/composer/focus.ts) — the
// same bus this plugin already uses for pane reveal. No backend, no clipboard.
const COMPOSER_INSERT = 'hermes:composer-insert'
const COMPOSER_FOCUS = 'hermes:composer-focus'

export function commentToChatText({ login, verb, timestamp, body, permalink }) {
  const who = login ? `@${String(login).replace(/^@/, '')}` : '@unknown'
  const when = timestamp ? ` · ${timestamp}` : ''
  const quoted = String(body || '').split('\n').map(l => `> ${l}`).join('\n')
  const parts = [`> **${who}** ${verb || 'commented'}${when}:`, quoted]
  if (permalink) parts.push('>', `> ${permalink}`)
  return parts.join('\n')
}

function sendCommentToChat(c) {
  const text = commentToChatText(c)
  if (!text.trim()) return
  // Defer like core's dispatch() (focus.ts): the composer must focus AFTER this
  // click handler finishes, or the browser re-focuses the clicked button.
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(COMPOSER_INSERT, { detail: { mode: 'block', target: 'main', text } }))
    window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS, { detail: { target: 'main' } }))
  }, 0)
}

async function sh(cmd) {
  const r = await host.request('shell.exec', { command: cmd })
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim().slice(0, 600))
  return (r.stdout || '').trim()
}

async function shJson(cmd) {
  const out = await sh(cmd)
  if (!out) return null
  try { return JSON.parse(out) } catch { throw new Error('gh JSON parse failed: ' + out.slice(0, 300)) }
}

function repoOk(r) {
  return typeof r === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)
}

// Compact GitHub REST via jq so shell.exec's 4k stdout cap doesn't truncate.
async function ghApi(repo, path, jq) {
  if (!repoOk(repo)) throw new Error('invalid repo')
  return shJson(`${GH} api ${sq(`repos/${repo}/${path}`)} --jq ${sq(jq)}`)
}

// shell.exec returns only the LAST 4000 chars of stdout (gateway cap), so big
// payloads (full comment bodies) can't come back in one call. Route them through
// a temp file read back in base64 chunks — base64 is pure ASCII, so a chunk
// boundary can never split a multi-byte char the way raw-byte chunking would.
// ponytail: N+2 shell.exec round-trips per big read; swap for a single call if
// the gateway cap is raised or a file-read RPC lands.
async function shBig(cmd) {
  const tag = `ghprs.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const raw = `/tmp/${tag}.raw`, b64 = `/tmp/${tag}.b64`
  try {
    await sh(`${cmd} > ${sq(raw)} && base64 < ${sq(raw)} > ${sq(b64)}`)
    let out = ''
    // EOF = empty read, not short chunk: base64 wraps at 76 chars, so a
    // chunk boundary can land on a wrapping newline that sh()'s trim removes,
    // making a full 3800-byte read report 3799 and a length-based EOF exit early.
    for (let off = 1; ; off += 3800) {
      const chunk = await sh(`tail -c +${off} ${sq(b64)} | head -c 3800`)
      if (!chunk) break
      out += chunk
    }
    const bin = atob(out.replace(/\s+/g, ''))
    return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  } finally {
    sh(`unlink ${sq(raw)}; unlink ${sq(b64)}`).catch(() => {})
  }
}

async function shJsonBig(cmd) {
  const out = await shBig(cmd)
  if (!out) return null
  try { return JSON.parse(out) } catch { throw new Error('gh JSON parse failed: ' + out.slice(0, 300)) }
}

async function ghApiBig(repo, path, jq) {
  if (!repoOk(repo)) throw new Error('invalid repo')
  return shJsonBig(`${GH} api ${sq(`repos/${repo}/${path}`)} --jq ${sq(jq)}`)
}

async function ghApiBigPaginated(repo, path) {
  if (!repoOk(repo)) throw new Error('invalid repo')
  // gh cannot combine --slurp with --jq, so flatten the raw page array here.
  const pages = await shJsonBig(`${GH} api ${sq(`repos/${repo}/${path}`)} --paginate --slurp`)
  return Array.isArray(pages) ? pages.flat() : []
}

// Body of a `[...]` array filter — strip only the outer brackets so the
// JS-side projection below can be recognized and re-applied (folding the whole
// array expression to '' would skip the projection and leak raw objects into
// the render tree, e.g. a full user object as a React child).
export function projectionBody(jq) {
  return String(jq || '').replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '').trim()
}

// Lean shape the inline-comment rows: `user` is always a string, never the
// full REST user object, so nothing can reach a React child (React #31).
export function projectInlineComments(items) {
  return (items || []).map(c => ({
    id: c.id, user: typeof c.user === 'string' ? c.user : (c.user?.login ?? ''), body: c.body ?? '',
    path: c.path, line: c.line, original_line: c.original_line,
    in_reply_to_id: c.in_reply_to_id, created_at: c.created_at,
    html_url: c.html_url, diff_hunk: c.diff_hunk ?? '',
  }))
}

async function ghApiBigPaginatedProjected(repo, path, jq) {
  const items = await ghApiBigPaginated(repo, path)
  if (!jq || !items.length) return items
  // Codex P1+P2: avoid `jq` binary and large-payload printf arg — project in JS.
  const proj = projectionBody(jq)
  // Recognize the two projections used by this plugin; fall back to raw items.
  if (proj.includes('diff_hunk')) {
    return projectInlineComments(items)
  }
  if (proj.includes('patch')) {
    return items.map(f => ({
      filename: f.filename, status: f.status,
      additions: f.additions, deletions: f.deletions, patch: f.patch ?? '',
    }))
  }
  return items
}

async function fetchPrByNumber(repo, n) {
  return shJsonBig(`${GH} pr view ${sq(String(n))} --repo ${sq(repo)} --json number,title,state,author,updatedAt,url,baseRefName,headRefName,isDraft,additions,deletions,changedFiles,reviewDecision,statusCheckRollup`)
}

async function fetchIssueByNumber(repo, n) {
  return shJsonBig(`${GH} issue view ${sq(String(n))} --repo ${sq(repo)} --json number,title,state,author,updatedAt,url,labels`)
}

async function shJsonLoose(cmd) {
  const r = await host.request('shell.exec', { command: cmd })
  const out = (r.stdout || '').trim()
  if (!out) {
    if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim().slice(0, 400))
    return null
  }
  try { return JSON.parse(out) } catch {
    throw new Error('gh JSON parse failed: ' + out.slice(0, 300))
  }
}

export function prStateKey(d) {
  if (!d) return 'open'
  if (d.isDraft || d.draft) return 'draft'
  const s = String(d.state || '').toLowerCase()
  if (d.merged || s === 'merged') return 'merged'
  return s === 'closed' ? 'closed' : 'open'
}

// Issue #10: statusCheckRollup -> one CI state. Two shapes in the rollup:
// CheckRun (status QUEUED|IN_PROGRESS|COMPLETED + conclusion) and StatusContext
// (state SUCCESS|FAILURE|ERROR|PENDING|EXPECTED). Failing wins over pending.
const CI_FAILURES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])
const CI_PENDING = new Set(['QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING', 'EXPECTED'])
const CI_PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

export function ciState(rollup) {
  const checks = Array.isArray(rollup) ? rollup : []
  if (!checks.length) return 'none'
  let pending = false
  for (const c of checks) {
    const raw = c?.__typename === 'StatusContext'
      ? c.state
      : String(c?.status || '').toUpperCase() === 'COMPLETED' ? c.conclusion : c.status
    const s = String(raw || '').toUpperCase()
    if (CI_FAILURES.has(s)) return 'failing'
    if (CI_PENDING.has(s) || !CI_PASSING.has(s)) pending = true
  }
  return pending ? 'pending' : 'passing'
}

// Issue #10: gh reviewDecision string -> one review state ('' when no decision).
export function reviewState(decision) {
  const d = String(decision || '').toUpperCase()
  if (d === 'APPROVED') return 'approved'
  if (d === 'CHANGES_REQUESTED') return 'changes'
  if (d === 'REVIEW_REQUIRED') return 'required'
  return 'none'
}

const CHECK_RANK = { fail: 0, pending: 1, cancel: 1, skipping: 2, pass: 3 }

export function checkTone(bucket) {
  const b = String(bucket || '').toLowerCase()
  if (b === 'pass' || b === 'success') return 'good'
  if (b === 'fail' || b === 'failure') return 'bad'
  if (b === 'pending') return 'warn'
  if (b === 'cancel' || b === 'cancelled') return 'bad'
  if (b === 'skipping') return 'muted'
  return 'muted'
}

export function summarizeChecks(checks) {
  const counts = { fail: 0, pending: 0, pass: 0, other: 0, cancel: 0, skipping: 0 }
  for (const c of checks || []) {
    const b = String(c?.bucket || '').toLowerCase()
    if (b === 'fail') counts.fail++
    else if (b === 'pending') counts.pending++
    else if (b === 'pass') counts.pass++
    else if (b === 'cancel' || b === 'cancelled') counts.cancel++
    else if (b === 'skipping') counts.skipping++
    else counts.other++
  }
  const title = counts.fail
    ? `Blocked by ${counts.fail} failing check${counts.fail === 1 ? '' : 's'}`
    : counts.pending
      ? `Waiting on ${counts.pending} check${counts.pending === 1 ? '' : 's'}`
      : counts.cancel
        ? `${counts.cancel} check${counts.cancel === 1 ? '' : 's'} canceled`
        : counts.other
          ? `${counts.other} check${counts.other === 1 ? '' : 's'} needs attention`
          : counts.skipping && !counts.pass
            ? `Skipped ${counts.skipping} check${counts.skipping === 1 ? '' : 's'}`
            : (counts.pass || counts.skipping) ? 'All checks passed' : 'No checks'
  return { ...counts, title }
}

export function sortChecks(checks) {
  return [...(checks || [])].sort((a, b) => {
    const ra = CHECK_RANK[String(a?.bucket || '').toLowerCase()] ?? 3
    const rb = CHECK_RANK[String(b?.bucket || '').toLowerCase()] ?? 3
    return ra - rb || String(a?.name || '').localeCompare(String(b?.name || ''))
  })
}

export function matchesListQuery(item, query) {
  const raw = String(query || '').trim().toLowerCase()
  if (!raw) return true
  const q = raw.startsWith('#') ? raw.slice(1).trimStart() : raw
  if (!q) return true
  return [
    item?.number,
    `#${item?.number}`,
    item?.title,
    item?.author?.login,
    item?.headRefName,
    ...(Array.isArray(item?.labels) ? item.labels.map(label => label?.name) : []),
  ].some(value => String(value || '').toLowerCase().includes(q))
}

// Exact-number search (`#42` or `42`) beyond the fetched page: look the item
// up server-side instead of filtering the 30-row list. Non-numeric queries
// keep the cheap client-side filter — `gh search` would hit different indexes.
// ponytail: one extra gh call only when the list misses; add a search-index
// query when free-text search needs to cover old items too.
export function numericListQuery(query) {
  const q = String(query || '').trim().replace(/^#/, '')
  return /^\d+$/.test(q) ? Number(q) : null
}

// Issue #9: REST review comments -> threads. Replies carry in_reply_to_id
// pointing at the thread root; an orphan (root outside the fetched page)
// anchors its own thread. Cap: first 30 threads, bodies never truncated.
export function groupInlineThreads(comments) {
  const list = Array.isArray(comments) ? comments : []
  const byId = new Set(list.map(c => c.id))
  const rootId = c => (c.in_reply_to_id && byId.has(c.in_reply_to_id)) ? c.in_reply_to_id : c.id
  const threads = []
  const byRoot = new Map()
  for (const c of list) {
    if (rootId(c) === c.id) {
      const t = { root: c, replies: [] }
      threads.push(t)
      byRoot.set(c.id, t)
    }
  }
  for (const c of list) {
    const rid = rootId(c)
    if (rid !== c.id) byRoot.get(rid)?.replies.push(c)
  }
  return threads.slice(0, 30)
}

// Issue #9: file:line chip; GitHub nulls `line` for outdated comments, fall back to original_line.
function inlineFileChip(c) {
  const line = c.line ?? c.original_line
  return c.path ? (line ? `${c.path}:${line}` : c.path) : ''
}

const $repo = atom('')
// Last session repo auto-applied; lets a manual pick stand until the session repo changes.
let lastAutoRepo = null
const $tab = atom('prs')
const $listQuery = atom('')
const $prState = atom('open')
const $issueState = atom('open')
const $selPr = atom(null)
const $selIssue = atom(null)

function useRepos() {
  return useQuery({
    queryKey: [ID, 'repos'],
    queryFn: async () => {
      const repos = await shJson(`${GH} repo list --limit 30 --json nameWithOwner`)
      if (!Array.isArray(repos)) throw new Error('gh repo list failed')
      return repos.map(r => r.nameWithOwner).sort()
    },
    staleTime: 60_000,
  })
}

function useSessionGit(cwd) {
  return useQuery({
    queryKey: [ID, 'session-git', cwd],
    enabled: !!cwd,
    queryFn: async () => {
      const branch = await sh(`git -C ${sq(cwd)} rev-parse --abbrev-ref HEAD`).catch(() => '')
      const remote = await sh(`git -C ${sq(cwd)} config --get remote.origin.url`).catch(() => '')
      return { branch: (branch || '').trim() || null, repo: parseRemote(remote) }
    },
    staleTime: 10_000,
  })
}

// Orca/T3Code: linked review = branch PR, else last PR url in the transcript.
function useSessionPr(cwd, sessionId) {
  const gitQ = useSessionGit(cwd)
  const repo = gitQ.data?.repo
  const branch = gitQ.data?.branch
  const isTrunk = branch ? TRUNK.has(branch.toLowerCase()) : false

  const branchQ = useQuery({
    queryKey: [ID, 'session-pr', repo, branch],
    enabled: !!repo && !!branch && !isTrunk,
    queryFn: async () => {
      const list = await shJson(`${GH} pr list --repo ${sq(repo)} --head ${sq(branch)} --limit 5 --json number,title,state,isDraft,url,headRefName,baseRefName`)
      return Array.isArray(list) && list.length ? { ...list[0], repo, source: 'branch' } : null
    },
    staleTime: 15_000,
  })

  const histQ = useQuery({
    queryKey: [ID, 'session-pr-hist', sessionId],
    enabled: !!sessionId && !branchQ.data && !branchQ.isFetching,
    queryFn: async () => {
      const r = await host.request('session.history', { session_id: sessionId }).catch(() => null)
      const msgs = r?.messages || []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const hit = extractPrRef(msgs[i]?.text)
        if (!hit) continue
        const d = await shJson(`${GH} pr view ${sq(String(hit.number))} --repo ${sq(hit.repo)} --json number,title,state,isDraft,url,headRefName,baseRefName`).catch(() => null)
        if (d) return { ...d, repo: hit.repo, source: 'transcript' }
        return { number: hit.number, repo: hit.repo, title: `#${hit.number}`, state: 'OPEN', url: `https://github.com/${hit.repo}/pull/${hit.number}`, source: 'transcript' }
      }
      return null
    },
    staleTime: 30_000,
  })

  return { gitQ, pr: branchQ.data || histQ.data || null, loading: gitQ.isLoading || branchQ.isLoading || histQ.isLoading }
}

function StateDot({ state, isDraft }) {
  const color = isDraft ? 'var(--ui-text-quaternary)'
    : state === 'OPEN' || state === 'open' ? 'var(--ui-green)'
    : state === 'MERGED' ? 'var(--ui-purple)'
    : state === 'CLOSED' ? 'var(--ui-red)'
    : 'var(--ui-yellow)'
  return jsx('span', { className: 'inline-block size-2 rounded-full shrink-0', style: { background: color } })
}

// Issue #10: compact CI + review dots on each PR row (native title = tooltip).
const CI_DOT = { passing: 'var(--ui-green)', failing: 'var(--ui-red)', pending: 'var(--ui-yellow)', none: 'var(--ui-text-quaternary)' }
const CI_LABEL = { passing: 'CI passing', failing: 'CI failing', pending: 'CI pending', none: 'No CI configured' }
const REVIEW_DOT = { approved: 'var(--ui-green)', changes: 'var(--ui-red)', required: 'var(--ui-yellow)', none: 'var(--ui-text-quaternary)' }
const REVIEW_LABEL = { approved: 'Approved', changes: 'Changes requested', required: 'Review required', none: 'No review decision' }
function StatusDots({ pr }) {
  const ci = ciState(pr.statusCheckRollup)
  const rv = reviewState(pr.reviewDecision)
  return jsxs('span', { className: 'inline-flex flex-wrap items-center gap-1 text-[10px]', children: [
    jsxs('span', { className: 'gh-status-chip', title: CI_LABEL[ci], children: [
      jsx('span', { className: 'size-1.5 rounded-full', style: { background: CI_DOT[ci] } }),
      CI_LABEL[ci],
    ] }),
    jsxs('span', { className: 'gh-status-chip', title: REVIEW_LABEL[rv], children: [
      jsx('span', { className: 'size-1.5 rounded-full', style: { background: REVIEW_DOT[rv] } }),
      REVIEW_LABEL[rv],
    ] }),
  ] })
}

// GitHub-style state pill, themed via skin vars (inline style => reskins live).
const STATE_PILL = {
  merged: { bg: 'var(--ui-purple)', label: 'Merged', icon: 'git-merge' },
  closed: { bg: 'var(--ui-red)', label: 'Closed', icon: 'git-pull-request-closed' },
  draft: { bg: 'var(--ui-text-quaternary)', label: 'Draft', icon: 'git-pull-request' },
  open: { bg: 'var(--ui-green)', label: 'Open', icon: 'git-pull-request' },
}
function StatePill({ d }) {
  const m = STATE_PILL[prStateKey(d)] || STATE_PILL.open
  return jsxs('span', {
    className: 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
    style: { background: 'var(--ui-bg-editor)', color: m.bg, border: `1px solid ${m.bg}` },
    children: [jsx(Codicon, { name: m.icon }), m.label],
  })
}

function TitlebarGithubButton() {
  return jsx(Tip, {
    label: 'Open GitHub pane',
    children: jsx(Button, {
      variant: 'ghost',
      size: 'sm',
      className: 'h-6 px-2 gap-1.5',
      onClick: openGithubPane,
      children: jsxs('span', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(Codicon, { name: 'github' }),
          jsx('span', { className: 'hidden sm:inline text-xs font-medium', children: 'GitHub' }),
        ],
      }),
    }),
  })
}

function SessionPrChip() {
  const cwd = useValue(host.state.cwd)
  const activeId = useValue(host.state.activeSessionId)
  const { gitQ, pr, loading } = useSessionPr(cwd, activeId)
  const branch = gitQ.data?.branch
  const repo = gitQ.data?.repo

  const openLinked = () => {
    if (pr?.repo) $repo.set(pr.repo)
    if (pr?.number) {
      $tab.set('prs')
      $selPr.set(pr.number)
      $selIssue.set(null)
    }
    openGithubPane()
  }

  if (!cwd) return null
  if (loading) return jsxs('span', { className: 'flex items-center gap-1.5 text-xs text-(--ui-text-quaternary)', children: [jsx(GlyphSpinner, { className: 'size-3' }), ' git…'] })
  if (pr) {
    return jsx(Tip, {
      label: `${pr.repo} #${pr.number} · ${pr.source === 'transcript' ? 'from session' : pr.headRefName || branch}`,
      children: jsxs('button', {
        type: 'button',
        onClick: openLinked,
        className: 'flex items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) px-2.5 py-0.5 text-xs hover:bg-(--ui-bg-quinary) max-w-[280px]',
        children: [
          jsx(StateDot, { state: pr.state, isDraft: pr.isDraft }),
          jsx('span', { className: 'truncate font-medium', children: `#${pr.number} ${pr.title || ''}` }),
        ],
      }),
    })
  }
  if (branch && repo && TRUNK.has(branch.toLowerCase())) {
    return jsx(Tip, { label: `${repo} · ${branch}`, children: jsx('span', { className: 'text-xs text-(--ui-text-quaternary) truncate', children: `${branch} · trunk` }) })
  }
  if (branch) {
    return jsxs('span', {
      className: 'flex items-center gap-1.5 text-xs text-(--ui-text-quaternary)',
      children: [
        jsx('span', { children: `${branch} · no PR` }),
        jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-5 px-1.5 text-[11px]', onClick: openGithubPane, children: 'Open' }),
      ],
    })
  }
  return null
}

function RepoLabel({ repo, size = 20 }) {
  const [owner, name] = String(repo || '').split('/')
  return jsxs('span', { className: 'flex min-w-0 items-center gap-2 text-left', children: [
    jsx(Avatar, { login: owner, size }),
    jsxs('span', { className: 'min-w-0 truncate', children: [
      owner ? jsx('span', { className: 'text-(--ui-text-tertiary)', children: owner }) : null,
      owner ? jsx('span', { className: 'mx-0.5 opacity-50', children: '/' }) : null,
      jsx('span', { className: 'font-medium text-(--ui-text-primary)', children: name || repo }),
    ] }),
  ] })
}

function RepoPicker({ repos, value, onChange }) {
  const [manual, setManual] = useState('')
  if (!repos?.length) {
    return jsxs('div', {
      className: 'flex gap-2',
      children: [
        jsx(Input, { placeholder: 'owner/repo', value: manual, onChange: e => setManual(e.target.value), className: 'h-7 flex-1 text-xs' }),
        jsx(Button, { size: 'sm', className: 'h-7', onClick: () => { if (manual.trim()) onChange(manual.trim()) }, children: 'Use' }),
      ],
    })
  }
  return jsxs(Select, {
    value: value || '__none__',
    onValueChange: v => { if (v !== '__none__') onChange(v) },
    children: [
      jsx(SelectTrigger, {
        className: 'gh-repo-trigger text-xs',
        children: jsx(SelectValue, {
          placeholder: 'Select repository',
          children: value ? jsx(RepoLabel, { repo: value }) : undefined,
        }),
      }),
      jsx(SelectContent, { children: repos.map(r => jsx(SelectItem, { value: r, children: jsx(RepoLabel, { repo: r, size: 18 }) }, r)) }),
    ],
  })
}

export function labelTextColor(hex) {
  let clean = String(hex || '').replace(/^#/, '')
  if (clean.length === 3 && /^[0-9a-fA-F]{3}$/.test(clean)) {
    clean = clean.split('').map(c => c + c).join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#000000'
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  // Relative luminance threshold (W3C standard)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 140 ? '#000000' : '#ffffff'
}

function LabelChip({ label, className }) {
  if (!label?.name) return null
  const bg = label.color ? `#${String(label.color).replace(/^#/, '')}` : 'var(--ui-bg-quaternary)'
  const color = label.color ? labelTextColor(label.color) : 'var(--ui-text-secondary)'
  return jsx('span', {
    className: cn('inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium leading-none shrink-0', className),
    style: { backgroundColor: bg, color, border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' },
    children: label.name,
  })
}

// Issue #12: parse unified diff patch into structured row model
export function parsePatch(patch) {
  if (!patch || typeof patch !== 'string') return []
  const lines = patch.split('\n')
  const rows = []
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      if (m) {
        oldLine = parseInt(m[1], 10)
        newLine = parseInt(m[2], 10)
      }
      rows.push({ type: 'hunk', text: line, oldLine: null, newLine: null })
    } else if (line.startsWith('+')) {
      rows.push({ type: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ })
    } else if (line.startsWith('-')) {
      rows.push({ type: 'del', text: line.slice(1), oldLine: oldLine++, newLine: null })
    } else if (line.startsWith('\\')) {
      rows.push({ type: 'meta', text: line, oldLine: null, newLine: null })
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      rows.push({ type: 'ctx', text, oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return rows
}

function FileStatusBadge({ status }) {
  const s = String(status || '').toLowerCase()
  const map = {
    added: { label: 'A', bg: 'var(--ui-green)', title: 'Added' },
    removed: { label: 'D', bg: 'var(--ui-red)', title: 'Deleted' },
    modified: { label: 'M', bg: 'var(--ui-yellow)', title: 'Modified' },
    renamed: { label: 'R', bg: 'var(--ui-purple)', title: 'Renamed' },
  }
  const meta = map[s] || { label: '•', bg: 'var(--ui-text-quaternary)', title: s || 'Changed' }
  return jsx('span', {
    className: 'inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[9px] font-bold shrink-0',
    style: { backgroundColor: 'var(--ui-bg-editor)', color: meta.bg, border: `1px solid ${meta.bg}` },
    title: meta.title,
    children: meta.label,
  })
}

function FileDiffBlock({ file }) {
  const rows = parsePatch(file.patch)
  const lineCount = rows.length
  const defaultOpen = Boolean(file.patch && lineCount < 150)

  return jsxs('details', {
    open: defaultOpen,
    className: 'group text-xs',
    children: [
      jsxs('summary', {
        className: 'cursor-pointer select-none flex items-center gap-2 rounded-md px-1 py-1.5 font-mono hover:bg-(--ui-bg-quinary)',
        children: [
          jsx(FileStatusBadge, { status: file.status }),
          jsx('span', { className: 'min-w-0 flex-1 truncate font-medium text-(--ui-text-primary)', title: file.filename, children: file.filename }),
          jsx(DiffCount, { add: file.additions, del: file.deletions, className: 'shrink-0' }),
        ],
      }),
      file.patch && rows.length
        ? jsx('div', {
            className: 'mt-1 overflow-x-auto rounded-md border border-(--ui-stroke-secondary) font-mono text-[11px] leading-5',
            children: jsx('table', {
              className: 'w-full border-collapse',
              children: jsx('tbody', {
                children: rows.map((r, idx) => {
                  if (r.type === 'hunk') {
                    return jsx('tr', {
                      className: 'bg-(--ui-bg-quaternary) text-(--ui-text-tertiary) text-[10px] italic',
                      children: jsxs('td', {
                        colSpan: 4,
                        className: 'px-3 py-0.5 border-y border-(--ui-stroke-secondary) select-none',
                        children: r.text,
                      }),
                    }, idx)
                  }
                  const isAdd = r.type === 'add'
                  const isDel = r.type === 'del'
                  const bgStyle = isAdd
                    ? { backgroundColor: 'var(--ui-diff-add-background)' }
                    : isDel
                    ? { backgroundColor: 'var(--ui-diff-remove-background)' }
                    : undefined
                  const textColor = isAdd
                    ? 'text-(--ui-diff-add-foreground)'
                    : isDel
                    ? 'text-(--ui-diff-remove-foreground)'
                    : 'text-(--ui-text-primary)'
                  const sign = isAdd ? '+' : isDel ? '−' : ' '

                  return jsxs('tr', {
                    style: bgStyle,
                    className: cn('hover:bg-(--ui-bg-quinary)/50', textColor),
                    children: [
                      jsx('td', {
                        className: 'select-none text-right pr-2 text-[10px] text-(--ui-text-quaternary) w-9 border-r border-(--ui-stroke-secondary)/40 opacity-60 font-mono',
                        children: r.oldLine ?? '',
                      }),
                      jsx('td', {
                        className: 'select-none text-right pr-2 text-[10px] text-(--ui-text-quaternary) w-9 border-r border-(--ui-stroke-secondary)/40 opacity-60 font-mono',
                        children: r.newLine ?? '',
                      }),
                      jsx('td', {
                        className: 'select-none text-center w-4 text-[10px] opacity-70 font-semibold',
                        children: sign,
                      }),
                      jsx('td', {
                        className: 'pl-1 pr-3 whitespace-pre text-left font-mono break-all',
                        children: r.text,
                      }),
                    ],
                  }, idx)
                }),
              }),
            }),
          })
        : jsx('div', {
            className: 'mt-1 px-2 py-2 text-xs italic text-(--ui-text-tertiary)',
            children: file.status === 'renamed'
              ? 'File renamed without changes'
              : 'Binary file or no diff content to display',
          }),
    ],
  })
}

function CommitsView({ repo, commits, loading, error, onRetry }) {
  if (loading) return jsx(ListSkeleton, {})
  if (error) return jsx(ListErrorState, { title: 'Could not load commits', error, onRetry })
  if (!commits.length) return jsx(EmptyState, { title: 'No commits' })
  const capped = commits.length >= 30
  return jsxs('div', { className: 'space-y-2', children: [
    capped ? jsx('div', { className: 'px-0.5 text-[10px] text-(--ui-text-quaternary)', children: 'Showing first 30 commits' }) : null,
    jsx('div', { className: 'gh-timeline', children: commits.map(c => jsx(CommitRow, { repo, commit: c }, c.full || c.sha)) }),
  ] })
}

function CommitRow({ repo, commit }) {
  const [open, setOpen] = useState(false)
  const sha = commit.full || commit.sha
  const url = commit.full ? `https://github.com/${repo}/commit/${commit.full}` : null
  const q = useQuery({
    queryKey: [ID, 'commit', repo, sha],
    enabled: open && !!repo && !!sha,
    queryFn: () => ghApiBig(repo, `commits/${sha}`, '{msg:.commit.message,additions:.stats.additions,deletions:.stats.deletions,files:[.files[:20][]|{filename,status,additions,deletions}]}'),
    staleTime: 60_000,
  })
  const files = Array.isArray(q.data?.files) ? q.data.files : []
  const extra = String(q.data?.msg || '').split('\n').slice(1).join('\n').trim()
  return jsxs('details', {
    className: 'gh-commit',
    onToggle: e => setOpen(e.currentTarget.open),
    children: [
      jsxs('summary', { className: 'flex items-start gap-2', children: [
        jsx('span', { className: 'gh-commit-node', 'aria-hidden': true }),
        jsxs('div', { className: 'min-w-0 flex-1 py-0.5', children: [
          jsx('div', { className: 'truncate text-xs font-medium leading-5 text-(--ui-text-primary)', title: commit.msg, children: commit.msg || '—' }),
          jsxs('div', { className: 'mt-0.5 truncate text-[10px] text-(--ui-text-quaternary)', children: [
            commit.author,
            commit.date ? ` · ${ago(commit.date)}` : '',
          ] }),
        ] }),
        jsxs('span', {
          className: 'flex shrink-0 items-center gap-0.5 pt-0.5',
          onClick: e => e.stopPropagation(),
          children: [
            jsx(CopyButton, { appearance: 'inline', className: 'font-mono text-[10px]', label: 'Copy SHA', text: sha, children: commit.sha }),
            url ? jsx(Button, { variant: 'ghost', size: 'sm', className: 'gh-commit-action h-6 w-6 p-0', 'aria-label': 'Open commit on GitHub', onClick: () => openExternal(url), children: jsx(Codicon, { name: 'link-external' }) }) : null,
          ],
        }),
      ] }),
      jsx('div', { className: 'gh-commit-panel space-y-2', children: !open
        ? null
        : q.isLoading
          ? jsx(Skeleton, { className: 'h-16 w-full rounded-md' })
          : q.isError
            ? jsx('div', { className: 'text-[11px] text-(--ui-text-tertiary)', children: 'Could not load commit.' })
            : jsxs(Fragment, { children: [
                extra ? jsx('pre', { className: 'whitespace-pre-wrap font-sans text-[11px] leading-5 text-(--ui-text-secondary)', children: extra }) : null,
                jsxs('div', { className: 'flex items-center gap-2 text-[11px] text-(--ui-text-tertiary)', children: [
                  jsx(DiffCount, { add: q.data?.additions, del: q.data?.deletions }),
                  jsx('span', { children: `${files.length}${files.length === 20 ? '+' : ''} file${files.length === 1 ? '' : 's'}` }),
                ] }),
                files.length
                  ? jsx('div', { className: 'space-y-0.5', children: files.map(f => jsxs('div', {
                      className: 'flex items-center gap-2 py-0.5 font-mono text-[11px]',
                      children: [
                        jsx(FileStatusBadge, { status: f.status }),
                        jsx('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-secondary)', title: f.filename, children: f.filename }),
                        jsx(DiffCount, { add: f.additions, del: f.deletions, className: 'shrink-0' }),
                      ],
                    }, f.filename)) })
                  : null,
              ] }),
      }),
    ],
  })
}

function ChecksView({ checks, loading, error, onRetry, compact = false }) {
  if (loading) return compact ? jsx(Skeleton, { className: 'h-9 w-full rounded-md' }) : jsx(ListSkeleton, {})
  if (error) return compact ? null : jsx(ListErrorState, { title: 'Could not load checks', error, onRetry })
  if (!checks.length) return compact ? null : jsx(EmptyState, { title: 'No checks', description: 'Nothing reported for this PR.' })
  const summary = summarizeChecks(checks)
  const tone = summary.fail ? 'bad' : summary.pending || summary.cancel ? 'warn' : summary.other ? 'warn' : 'good'
  const counts = [
    summary.fail ? `${summary.fail} fail` : null,
    summary.pending ? `${summary.pending} pending` : null,
    summary.cancel ? `${summary.cancel} canceled` : null,
    summary.skipping ? `${summary.skipping} skipped` : null,
    summary.other ? `${summary.other} other` : null,
    summary.pass ? `${summary.pass} pass` : null,
  ].filter(Boolean).join(' · ')
  const head = jsxs('div', { className: 'flex items-center gap-2', children: [
    jsx(StatusDot, { tone }),
    jsx('span', { className: 'text-xs font-medium text-(--ui-text-primary)', children: summary.title }),
    counts ? jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: counts }) : null,
  ] })
  const list = jsx('div', { className: 'space-y-0.5', children: sortChecks(checks).map(c => jsxs('button', {
    type: 'button',
    disabled: !c.link,
    onClick: () => c.link && openExternal(c.link),
    className: 'flex w-full items-start gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-(--ui-bg-quinary) disabled:hover:bg-transparent',
    children: [
      jsx('span', { className: 'mt-1.5 shrink-0', children: jsx(StatusDot, { tone: checkTone(c.bucket) }) }),
      jsxs('span', { className: 'min-w-0 flex-1', children: [
        jsx('span', { className: 'block text-xs text-(--ui-text-primary)', children: c.name }),
        jsx('span', { className: 'block text-[10px] text-(--ui-text-quaternary)', children: c.state }),
      ] }),
      c.link ? jsx(Codicon, { name: 'link-external', className: 'mt-0.5 shrink-0 text-(--ui-text-quaternary)' }) : null,
    ],
  }, `${c.name}:${c.state}`)) })
  if (compact) {
    return jsxs('details', {
      open: summary.fail > 0 || summary.cancel > 0 || summary.other > 0,
      className: 'rounded-md border border-(--ui-stroke-secondary) px-3 py-2',
      children: [
        jsx('summary', { className: 'cursor-pointer select-none', children: head }),
        jsx('div', { className: 'mt-2', children: list }),
      ],
    })
  }
  return jsxs('div', { className: 'space-y-3', children: [jsx('div', { className: 'px-0.5', children: head }), list] })
}

function FilesView({ files, loading, error, onRetry }) {
  if (loading) return jsx(ListSkeleton, {})
  if (error) return jsx(ListErrorState, { title: 'Could not load files', error, onRetry })
  if (!files.length) return jsx(EmptyState, { title: 'No files changed' })
  let add = 0
  let del = 0
  for (const f of files) {
    add += f.additions || 0
    del += f.deletions || 0
  }
  const shownLabel = `${files.length} file${files.length === 1 ? '' : 's'} shown`
  return jsxs('div', { className: 'space-y-2', children: [
    jsxs('div', { className: 'flex items-center gap-2 px-0.5 text-[11px] text-(--ui-text-tertiary)', children: [
      jsx('span', { children: shownLabel }),
      jsx(DiffCount, { add, del }),
    ] }),
    jsx('div', { className: 'space-y-1', children: files.map(f => jsx(FileDiffBlock, { file: f }, f.filename)) }),
  ] })
}

// Issue #2: Merge PR control (method select, delete-branch checkbox, confirm, error handling)
function MergeControl({ repo, number }) {
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState('squash')
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState(null)

  const handleMerge = async () => {
    setIsMerging(true)
    setError(null)
    try {
      const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge'
      const del = deleteBranch ? ' --delete-branch' : ''
      // gh pr merge prompts interactively (branch protection, merge queue);
      // shell.exec has no TTY so it would hang. gh has no --yes on this
      // subcommand; GH_PROMPT_DISABLED=1 suppresses prompts for this call only.
      await sh(`GH_PROMPT_DISABLED=1 ${GH} pr merge ${sq(String(number))} --repo ${sq(repo)} ${flag}${del}`)
      queryClient.invalidateQueries({ queryKey: [ID, 'pr-page', repo, String(number)] })
      queryClient.invalidateQueries({ queryKey: [ID, 'prs', repo] })
      queryClient.invalidateQueries({ queryKey: [ID, 'session-git'] })
      setOpen(false)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setIsMerging(false)
    }
  }

  if (!open) {
    return jsx(Button, {
      size: 'sm',
      className: 'h-5 px-2 text-[10px] gap-1 ml-auto',
      onClick: () => { setOpen(true); setError(null) },
      children: [
        jsx(Codicon, { name: 'git-merge' }),
        jsx('span', { children: 'Merge PR' }),
      ],
    })
  }

  const methodLabel = method === 'squash' ? 'Squash & merge' : method === 'rebase' ? 'Rebase & merge' : 'Merge commit'

  return jsxs('div', {
    className: 'w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) p-2.5 space-y-2 mt-2 text-xs',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsxs('span', { className: 'font-semibold text-(--ui-text-primary) flex items-center gap-1.5', children: [
            jsx(Codicon, { name: 'git-merge' }),
            jsx('span', { children: 'Merge pull request' }),
          ] }),
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            className: 'h-5 w-5 p-0 text-[10px]',
            disabled: isMerging,
            onClick: () => { setOpen(false); setError(null) },
            children: '✕',
          }),
        ],
      }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('span', { className: 'text-[11px] text-(--ui-text-secondary) shrink-0', children: 'Method:' }),
          jsxs(Select, {
            value: method,
            onValueChange: setMethod,
            disabled: isMerging,
            children: [
              jsx(SelectTrigger, { className: 'h-6 text-xs flex-1', children: jsx(SelectValue, {}) }),
              jsxs(SelectContent, { children: [
                jsx(SelectItem, { value: 'squash', children: 'Squash and merge' }),
                jsx(SelectItem, { value: 'merge', children: 'Create a merge commit' }),
                jsx(SelectItem, { value: 'rebase', children: 'Rebase and merge' }),
              ] }),
            ],
          }),
        ],
      }),
      jsxs('label', {
        className: 'flex items-center gap-2 text-[11px] text-(--ui-text-secondary) cursor-pointer select-none',
        children: [
          jsx('input', {
            type: 'checkbox',
            checked: deleteBranch,
            onChange: e => setDeleteBranch(e.target.checked),
            disabled: isMerging,
            className: 'rounded border-(--ui-stroke-secondary)',
          }),
          jsx('span', { children: 'Delete branch after merging' }),
        ],
      }),
      error ? jsx('div', {
        className: 'p-2 rounded bg-(--ui-bg-quinary) border border-(--ui-red)/30 text-[11px] text-(--ui-red) font-mono break-words whitespace-pre-wrap',
        children: error,
      }) : null,
      jsxs('div', {
        className: 'flex gap-2 justify-end pt-1',
        children: [
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            className: 'h-6 text-xs',
            disabled: isMerging,
            onClick: () => { setOpen(false); setError(null) },
            children: 'Cancel',
          }),
          jsx(Button, {
            size: 'sm',
            className: 'h-6 px-2.5 text-xs',
            disabled: isMerging,
            onClick: handleMerge,
            children: isMerging ? 'Merging...' : `Confirm ${methodLabel}`,
          }),
        ],
      }),
    ],
  })
}

function Avatar({ login, size = 20 }) {
  const who = String(login || '').replace(/^@/, '')
  if (!who || who === '—') {
    return jsx('span', { className: 'inline-block rounded-full shrink-0 bg-(--ui-bg-quaternary)', style: { width: size, height: size } })
  }
  return jsx('img', {
    src: `https://github.com/${encodeURIComponent(who)}.png?size=${size * 2}`,
    alt: who,
    className: 'rounded-full shrink-0 bg-(--ui-bg-quaternary) object-cover',
    style: { width: size, height: size },
    referrerPolicy: 'no-referrer',
  })
}

function Person({ login, extra, size = 18 }) {
  return jsxs('span', {
    className: 'inline-flex min-w-0 items-center gap-1.5',
    children: [
      jsx(Avatar, { login, size }),
      jsx('span', { className: 'truncate font-semibold text-(--ui-text-primary)', children: login || '—' }),
      extra ? jsx('span', { className: 'shrink-0 text-(--ui-text-tertiary)', children: extra }) : null,
    ],
  })
}

function ItemTitle({ title, number, detail = false }) {
  return jsxs(detail ? 'h1' : 'span', {
    className: detail ? 'gh-detail-title text-base font-semibold leading-snug' : 'gh-list-title',
    children: [
      title,
      jsx('span', { className: 'gh-item-num ml-1.5 font-mono text-[10px] font-normal text-(--ui-text-quaternary)', children: `#${number}` }),
    ],
  })
}

function StateSelect({ kind }) {
  const isPr = kind === 'prs'
  const value = useValue(isPr ? $prState : $issueState)
  return jsxs(Select, {
    value,
    onValueChange: v => (isPr ? $prState : $issueState).set(v),
    children: [
      jsx(SelectTrigger, { className: 'h-7 w-24 shrink-0 text-xs', children: jsx(SelectValue, {}) }),
      jsxs(SelectContent, { children: isPr
        ? [jsx(SelectItem, { value: 'open', children: 'Open' }, 'open'), jsx(SelectItem, { value: 'closed', children: 'Closed' }, 'closed'), jsx(SelectItem, { value: 'merged', children: 'Merged' }, 'merged'), jsx(SelectItem, { value: 'all', children: 'All' }, 'all')]
        : [jsx(SelectItem, { value: 'open', children: 'Open' }, 'open'), jsx(SelectItem, { value: 'closed', children: 'Closed' }, 'closed'), jsx(SelectItem, { value: 'all', children: 'All' }, 'all')],
      }),
    ],
  })
}

const REVIEW_BADGE = {
  APPROVED: { label: 'approved', color: 'var(--ui-green)' },
  CHANGES_REQUESTED: { label: 'requested changes', color: 'var(--ui-red)' },
  COMMENTED: { label: 'reviewed', color: 'var(--ui-text-quaternary)' },
  DISMISSED: { label: 'dismissed', color: 'var(--ui-text-quaternary)' },
}

// Issue #1 affordance: quote this comment into the active session's composer.
// Disabled + native-title hint when no session is active (Radix Tip won't open
// on a disabled button, hence the title on the wrapper span).
function SendToChatButton({ comment, className }) {
  const activeId = useValue(host.state.activeSessionId)
  const wrap = cn('inline-flex shrink-0', className)
  const btn = jsx(Button, {
    variant: 'ghost',
    size: 'sm',
    className: 'h-6 w-6 p-0',
    'aria-label': 'Quote in chat',
    disabled: !activeId,
    onClick: () => sendCommentToChat(comment),
    children: jsx(Codicon, { name: 'comment' }),
  })
  if (!activeId) return jsx('span', { className: wrap, title: 'No active session — open a chat first', children: btn })
  return jsx(Tip, { label: 'Quote in chat', children: jsx('span', { className: wrap, children: btn }) })
}

// Open conversation row: Copilot-style attributed content without a box around every message.
// Issue #9: inline review comments add a file:line chip and a collapsed diff-hunk block.
function CommentCard({ login, verb, time, timestamp, reviewState, body, permalink, size = 18, fileChip, hunk }) {
  const badge = reviewState ? REVIEW_BADGE[String(reviewState).toUpperCase()] : null
  return jsxs('article', { className: 'gh-comment flex items-start gap-2.5 py-1', children: [
    jsx('span', { className: 'gh-comment-avatar shrink-0 pt-0.5', children: jsx(Avatar, { login, size: Math.max(size, 22) }) }),
    jsxs('div', { className: 'min-w-0 flex-1', children: [
      jsxs('div', { className: 'flex min-w-0 items-start gap-2', children: [
        jsxs('div', { className: 'min-w-0 flex-1', children: [
          jsxs('div', { className: 'flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', children: [
            jsx('span', { className: 'font-semibold text-xs text-(--ui-text-primary)', children: login || '—' }),
            jsx('span', { className: 'text-[11px] text-(--ui-text-tertiary)', children: verb }),
            time ? jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: time }) : null,
          ] }),
          fileChip || badge ? jsxs('div', { className: 'mt-1 flex flex-wrap items-center gap-1.5', children: [
            fileChip ? jsxs('span', { className: 'inline-flex max-w-full items-center gap-1 rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) px-1.5 py-px font-mono text-[10px] text-(--ui-text-secondary)', title: fileChip, children: [
              jsx(Codicon, { name: 'file' }),
              jsx('span', { className: 'truncate', children: fileChip }),
            ] }) : null,
            badge ? jsxs('span', { className: 'inline-flex items-center gap-1 text-[10px] font-medium text-(--ui-text-secondary)', children: [
              jsx('span', { className: 'size-1.5 rounded-full', style: { background: badge.color } }),
              badge.label,
            ] }) : null,
          ] }) : null,
        ] }),
        jsx(SendToChatButton, { comment: { login, verb, timestamp, body, permalink }, className: 'gh-comment-action' }),
      ] }),
      hunk ? jsx('details', { className: 'mt-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) px-2.5 py-1.5', children: [
        jsx('summary', { className: 'cursor-pointer select-none text-[10px] text-(--ui-text-tertiary)', children: 'Diff context' }),
        jsx('pre', { className: 'mt-1 overflow-x-auto font-mono text-[10px] leading-4 text-(--ui-text-secondary)', children: hunk }),
      ] }) : null,
      jsx('div', { className: 'mt-2 pr-1', children: jsx(MdBody, { text: body }) }),
    ] }),
  ] })
}

const SAFE_URL = /^https?:\/\//i
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
const INLINE_RE = /(`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~\n]+~~|\*[^*\n]+\*|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g

function mdInline(text, key) {
  const s = String(text ?? '').replace(HTML_TAG, '')
  const out = []
  let last = 0
  let i = 0
  INLINE_RE.lastIndex = 0
  let m
  while ((m = INLINE_RE.exec(s))) {
    if (m.index > last) out.push(jsx(Fragment, { children: s.slice(last, m.index) }, `${key}-t${i}`))
    const p = m[0]
    if (p[0] === '`') {
      out.push(jsx('code', { className: 'rounded bg-(--ui-bg-quaternary) px-1 py-px font-mono text-xs', children: p.slice(1, -1) }, `${key}-c${i}`))
    } else if (p.startsWith('**') || p.startsWith('__')) {
      out.push(jsx('strong', { children: p.slice(2, -2) }, `${key}-b${i}`))
    } else if (p.startsWith('~~')) {
      out.push(jsx('del', { children: p.slice(2, -2) }, `${key}-s${i}`))
    } else if (p[0] === '*' && p.endsWith('*')) {
      out.push(jsx('em', { children: p.slice(1, -1) }, `${key}-i${i}`))
    } else if (p.startsWith('![')) {
      const im = p.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      out.push(im && SAFE_URL.test(im[2])
        ? jsx('img', { src: im[2], alt: im[1], className: 'my-1 max-w-full rounded' }, `${key}-img${i}`)
        : jsx(Fragment, { children: p }, `${key}-x${i}`))
    } else if (p.startsWith('[')) {
      const lm = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      out.push(lm && SAFE_URL.test(lm[2])
        ? jsx('a', { href: lm[2], target: '_blank', rel: 'noreferrer', className: 'text-(--ui-accent) underline break-all', children: lm[1] }, `${key}-a${i}`)
        : jsx(Fragment, { children: p }, `${key}-x${i}`))
    } else if (SAFE_URL.test(p)) {
      const href = p.replace(/[.,;:]+$/, '')
      out.push(jsx('a', { href, target: '_blank', rel: 'noreferrer', className: 'text-(--ui-accent) underline break-all', children: href }, `${key}-u${i}`))
    } else {
      out.push(jsx(Fragment, { children: p }, `${key}-x${i}`))
    }
    last = m.index + p.length
    i++
  }
  if (last < s.length) out.push(jsx(Fragment, { children: s.slice(last) }, `${key}-e`))
  return out
}

// ponytail: GFM subset (headings, lists, task lists, tables, nested quotes, details, fences, hr, inline). Other raw HTML stripped to text. Full GFM when SDK ships markdown.
export function mdBlocks(text) {
  const lines = String(text || '').replace(HTML_COMMENT, '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*<details[^>]*>\s*$/i.test(line)) {
      const buf = []
      let summary = 'Details'
      i++
      while (i < lines.length && !/^\s*<\/details>\s*$/i.test(lines[i])) {
        const sm = /^\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*$/i.exec(lines[i])
        if (sm) summary = sm[1].trim()
        else buf.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      blocks.push({ t: 'details', summary, children: mdBlocks(buf.join('\n')) })
      continue
    }
    if (line.startsWith('```')) {
      const buf = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++ }
      if (i < lines.length) i++
      blocks.push({ t: 'pre', text: buf.join('\n') })
      continue
    }
    const hm = /^(#{1,3}) (.+)$/.exec(line)
    if (hm) { blocks.push({ t: 'h', n: hm[1].length, text: hm[2] }); i++; continue }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue }
    if (/^>/.test(line)) {
      const buf = []
      while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push({ t: 'quote', children: mdBlocks(buf.join('\n')) })
      continue
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const header = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++ }
      blocks.push({ t: 'table', header, rows })
      continue
    }
    if (/^[-*] /.test(line) || /^\d+\. /.test(line)) {
      const items = []
      while (i < lines.length && (/^[-*] /.test(lines[i]) || /^\d+\. /.test(lines[i]))) {
        const raw = lines[i].replace(/^([-*] |\d+\. )/, '')
        const tm = /^\[([ xX])\] (.*)$/.exec(raw)
        items.push(tm ? { task: true, checked: tm[1] !== ' ', text: tm[2] } : { text: raw })
        i++
      }
      blocks.push({ t: 'ul', items })
      continue
    }
    if (!line.trim()) { i++; continue }
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^#{1,3} /.test(lines[i]) && !/^>/.test(lines[i]) && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i]) && !/^\|.*\|\s*$/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ t: 'p', text: buf.join('\n') })
  }
  return blocks
}

function MdBlocksView({ blocks, keyPrefix }) {
  const H = { 1: 'text-base font-semibold mt-2 mb-1', 2: 'text-sm font-semibold mt-2 mb-1', 3: 'text-sm font-medium mt-1.5 mb-1' }
  return blocks.map((b, i) => {
    const k = `${keyPrefix}-${i}`
    if (b.t === 'pre') return jsx('pre', { className: 'overflow-x-auto rounded-md bg-(--ui-bg-quaternary) p-2 font-mono text-[11px] leading-5', children: b.text }, k)
    if (b.t === 'h') return jsx('div', { className: H[b.n] || H[3], children: mdInline(b.text, k) }, k)
    if (b.t === 'hr') return jsx('hr', { className: 'gh-divide my-3 border-t' }, k)
    if (b.t === 'details') return jsx('details', { className: 'rounded-md border border-(--ui-stroke-secondary) px-2 py-1', children: [
      jsx('summary', { className: 'cursor-pointer select-none text-xs font-medium text-(--ui-text-secondary)', children: mdInline(b.summary, `${k}-s`) }, `${k}-s`),
      jsx('div', { className: 'mt-1 space-y-2', children: jsx(MdBlocksView, { blocks: b.children, keyPrefix: k }) }, `${k}-c`),
    ] }, k)
    if (b.t === 'quote') return jsx('blockquote', { className: 'border-l-[3px] border-(--ui-stroke-secondary) pl-3 text-(--ui-text-tertiary) space-y-2', children: jsx(MdBlocksView, { blocks: b.children, keyPrefix: k }) }, k)
    if (b.t === 'table') return jsx('div', { className: 'overflow-x-auto rounded-md border border-(--ui-stroke-secondary)', children: jsx('table', { className: 'w-full text-xs', children: jsxs('tbody', { children: [
      jsx('tr', { className: 'bg-(--ui-bg-quaternary)', children: b.header.map((c, j) => jsx('th', { className: 'gh-divide border-b px-2 py-1 text-left font-semibold', children: mdInline(c, `${k}-h${j}`) }, j)) }),
      ...b.rows.map((r, ri) => jsx('tr', { children: r.map((c, j) => jsx('td', { className: 'gh-divide border-b border-transparent px-2 py-1 align-top last:border-b-0', children: mdInline(c, `${k}-r${ri}c${j}`) }, j)) }, ri)),
    ] }) }) }, k)
    if (b.t === 'ul') return jsx('ul', { className: 'list-disc pl-5 space-y-0.5', children: b.items.map((it, j) => it.task
      ? jsx('li', { className: 'list-none -ml-5 flex items-start gap-1.5', children: [
          jsx('input', { type: 'checkbox', checked: it.checked, disabled: true, className: 'mt-1.5 size-3 shrink-0 accent-(--ui-accent)' }, `${k}-cb${j}`),
          jsx('span', { className: it.checked ? 'text-(--ui-text-tertiary) line-through' : undefined, children: mdInline(it.text, `${k}-${j}`) }),
        ] }, j)
      : jsx('li', { children: mdInline(it.text, `${k}-${j}`) }, j)) }, k)
    return jsx('p', { className: 'whitespace-pre-wrap', children: mdInline(b.text, k) }, k)
  })
}

function MdBody({ text }) {
  if (!text) return jsx('span', { className: 'text-sm text-(--ui-text-quaternary) italic', children: 'No description.' })
  return jsx('div', {
    className: 'text-sm leading-6 break-words space-y-2',
    children: jsx(MdBlocksView, { blocks: mdBlocks(text), keyPrefix: 'b' }),
  })
}

function ListSkeleton() {
  return jsx('div', { className: 'gh-list', 'aria-busy': true, 'aria-label': 'Loading list', children: [0, 1, 2].map(i =>
    jsxs('div', { className: 'gh-list-row flex items-start gap-2.5 px-3 py-3', children: [
      jsx(Skeleton, { className: 'size-6 shrink-0 rounded-full' }),
      jsxs('div', { className: 'min-w-0 flex-1 space-y-2', children: [
        jsx(Skeleton, { className: i === 1 ? 'h-3.5 w-4/5' : 'h-3.5 w-3/5' }),
        jsx(Skeleton, { className: 'h-3 w-2/5' }),
      ] }),
    ] }, i)
  ) })
}

function ListErrorState({ title, error, onRetry }) {
  return jsx('div', { className: 'p-6', children: jsx(ErrorState, {
    title,
    description: String(error?.message || error),
    children: jsx(Button, { variant: 'outline', size: 'sm', onClick: onRetry, children: 'Retry' }),
  }) })
}

function ListEmptyState({ kind, state, repo, query }) {
  const isPr = kind === 'prs'
  const noun = isPr ? 'pull requests' : 'issues'
  const title = query ? 'No matching results' : state === 'all' ? `No ${noun} found` : `No ${state} ${noun}`
  return jsxs('div', { className: 'gh-empty flex h-full flex-col items-center justify-center px-8 py-10 text-center', children: [
    jsx('span', { className: 'gh-empty-icon mb-4', children: jsx(Codicon, { name: isPr ? 'git-pull-request' : 'issues' }) }),
    jsx('h3', { className: 'text-base font-semibold tracking-tight text-(--ui-text-primary)', children: title }),
    jsx('p', { className: 'mt-1 max-w-64 text-xs leading-5 text-(--ui-text-tertiary)', children: query
      ? `Nothing matches “${query}”. Try a title, number, author, branch, or label.`
      : state === 'all'
      ? `Nothing to show in ${repo}.`
      : `There are no ${state} ${noun} in this repository.` }),
    jsxs('div', { className: 'mt-4 flex flex-wrap justify-center gap-2', children: [
      query ? jsx(Button, {
        variant: 'outline',
        size: 'sm',
        onClick: () => $listQuery.set(''),
        children: 'Clear search',
      }) : state !== 'all' ? jsx(Button, {
        variant: 'outline',
        size: 'sm',
        onClick: () => (isPr ? $prState : $issueState).set('all'),
        children: 'Show all',
      }) : null,
      jsx(Button, {
        variant: 'ghost',
        size: 'sm',
        onClick: () => $tab.set(isPr ? 'issues' : 'prs'),
        children: isPr ? 'View issues' : 'View pull requests',
      }),
      jsx(Button, {
        variant: 'ghost',
        size: 'sm',
        onClick: () => openExternal(`https://github.com/${repo}/${isPr ? 'pulls' : 'issues'}`),
        children: jsxs('span', { className: 'flex items-center gap-1.5', children: [jsx(Codicon, { name: 'link-external' }), 'Open on GitHub'] }),
      }),
    ] }),
  ] })
}

function PrList({ repo, onOpen, query }) {
  const state = useValue($prState)
  const q = useQuery({
    queryKey: [ID, 'prs', repo, state],
    enabled: !!repo,
    // Issue #10: +reviewDecision,statusCheckRollup (~580B/row, 30 rows ≈ 17KB)
    // overflows the 4000-char stdout cap, so the list routes through shBig.
    queryFn: () => shJsonBig(`${GH} pr list --repo ${sq(repo)} --state ${sq(state)} --limit 30 --json number,title,state,author,updatedAt,url,baseRefName,headRefName,isDraft,additions,deletions,changedFiles,reviewDecision,statusCheckRollup`),
    staleTime: 15_000,
  })
  const allItems = Array.isArray(q.data) ? q.data : []
  const exactN = numericListQuery(query)
  const miss = exactN != null && allItems.length > 0 && !allItems.some(it => it.number === exactN)
  const lookup = useQuery({
    queryKey: [ID, 'pr-lookup', repo, exactN],
    enabled: !!repo && miss,
    queryFn: async () => {
      try { return await fetchPrByNumber(repo, exactN) } catch { return null }
    },
    staleTime: 15_000,
  })
  if (!repo) return jsx(EmptyState, { title: 'Select a repository', description: 'Pick one above to list PRs.' })
  if (q.isLoading) return jsx(ListSkeleton, {})
  if (q.isError) return jsx(ListErrorState, { title: 'Could not load pull requests', error: q.error, onRetry: () => q.refetch() })
  const source = lookup.data ? [lookup.data] : allItems
  const items = source.filter(item => matchesListQuery(item, query))
  if (!items.length) return jsx(ListEmptyState, { kind: 'prs', state, repo, query: allItems.length ? query : '' })
  return jsx(ScrollArea, {
    className: 'h-full',
    children: jsx('div', {
      className: 'gh-list',
      children: [
        jsxs('div', { className: 'gh-list-heading flex items-center gap-1.5 px-1 py-0.5 text-[10px] font-semibold', children: [
          jsx(Codicon, { name: 'git-pull-request' }),
          jsx('span', { children: 'Pull requests' }),
          jsx(Badge, { variant: 'secondary', className: 'ml-auto h-5 min-w-5 justify-center text-[10px]', children: String(items.length) }),
        ] }),
        ...items.map(pr =>
        jsxs('button', {
          type: 'button',
          onClick: () => onOpen(pr.number),
          className: 'gh-list-row w-full text-left px-3 py-2.5 flex gap-2.5 items-start',
          children: [
            jsx('span', { className: 'mt-0.5', children: jsx(Avatar, { login: pr.author?.login, size: 24 }) }),
            jsxs('span', {
              className: 'min-w-0 flex-1',
              children: [
                jsx(ItemTitle, { title: pr.title, number: pr.number }),
                jsxs('span', { className: 'mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] text-(--ui-text-tertiary)', children: [
                  jsx('span', { className: 'rounded bg-(--ui-bg-editor) px-1.5 py-0.5 font-mono', children: pr.headRefName || '—' }),
                  jsx(DiffCount, { add: pr.additions, del: pr.deletions }),
                  jsx('span', { children: `${pr.changedFiles ?? 0} files` }),
                  jsx('span', { className: 'text-(--ui-text-quaternary)', children: ago(pr.updatedAt) }),
                  jsx(StatusDots, { pr }),
                ] }),
              ],
            }),
            jsx(Codicon, { name: 'chevron-right', className: 'gh-card-arrow mt-1 shrink-0', 'aria-hidden': true }),
          ],
        }, String(pr.number))
      )],
    }),
  })
}

function IssueList({ repo, onOpen, query }) {
  const state = useValue($issueState)
  const q = useQuery({
    queryKey: [ID, 'issues', repo, state],
    enabled: !!repo,
    // Issue #10: same stdout-cap routing as the PR list (busy repos overflow).
    queryFn: () => shJsonBig(`${GH} issue list --repo ${sq(repo)} --state ${sq(state)} --limit 30 --json number,title,state,author,updatedAt,url,labels`),
    staleTime: 15_000,
  })
  const allItems = Array.isArray(q.data) ? q.data : []
  const exactN = numericListQuery(query)
  const miss = exactN != null && allItems.length > 0 && !allItems.some(it => it.number === exactN)
  const lookup = useQuery({
    queryKey: [ID, 'issue-lookup', repo, exactN],
    enabled: !!repo && miss,
    queryFn: async () => {
      try { return await fetchIssueByNumber(repo, exactN) } catch { return null }
    },
    staleTime: 15_000,
  })
  if (!repo) return jsx(EmptyState, { title: 'Select a repository', description: 'Pick one above to list issues.' })
  if (q.isLoading) return jsx(ListSkeleton, {})
  if (q.isError) return jsx(ListErrorState, { title: 'Could not load issues', error: q.error, onRetry: () => q.refetch() })
  const source = lookup.data ? [lookup.data] : allItems
  const items = source.filter(item => matchesListQuery(item, query))
  if (!items.length) return jsx(ListEmptyState, { kind: 'issues', state, repo, query: allItems.length ? query : '' })
  return jsx(ScrollArea, {
    className: 'h-full',
    children: jsx('div', {
      className: 'gh-list',
      children: [
        jsxs('div', { className: 'gh-list-heading flex items-center gap-1.5 px-1 py-0.5 text-[10px] font-semibold', children: [
          jsx(Codicon, { name: 'issues' }),
          jsx('span', { children: 'Issues' }),
          jsx(Badge, { variant: 'secondary', className: 'ml-auto h-5 min-w-5 justify-center text-[10px]', children: String(items.length) }),
        ] }),
        ...items.map(it =>
        jsxs('button', {
          type: 'button',
          onClick: () => onOpen(it.number),
          className: 'gh-list-row w-full text-left px-3 py-2.5 flex gap-2.5 items-start',
          children: [
            jsx('span', { className: 'mt-0.5', children: jsx(Avatar, { login: it.author?.login, size: 24 }) }),
            jsxs('span', {
              className: 'min-w-0 flex-1',
              children: [
                jsx(ItemTitle, { title: it.title, number: it.number }),
                Array.isArray(it.labels) && it.labels.length
                  ? jsx('span', { className: 'mt-1 flex flex-wrap gap-1 items-center', children: it.labels.map(l => jsx(LabelChip, { label: l }, l.name || l.id)) })
                  : null,
                jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary)', children: `${it.author?.login || '—'} · ${ago(it.updatedAt)}` }),
              ],
            }),
            jsx(Codicon, { name: 'chevron-right', className: 'gh-card-arrow mt-1 shrink-0', 'aria-hidden': true }),
          ],
        }, String(it.number))
      )],
    }),
  })
}

function DetailToolbar({ repo, number, url, onBack, backLabel }) {
  const [owner, name] = String(repo || '').split('/')
  return jsxs('div', {
    className: 'shrink-0 border-b border-(--ui-stroke-secondary) bg-(--ui-editor-surface-background) px-3 py-2 flex items-center gap-1.5 text-xs text-(--ui-text-tertiary)',
    children: [
      jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-7 w-7 p-0 -ml-1', onClick: onBack, 'aria-label': backLabel, children: jsx(Codicon, { name: 'chevron-left' }) }),
      jsxs('span', { className: 'gh-detail-repo min-w-0 flex-1 truncate', children: [
        jsx('span', { children: owner }),
        jsx('span', { className: 'mx-0.5 opacity-50', children: '/' }),
        jsx('span', { className: 'font-medium text-(--ui-text-primary)', children: name }),
      ] }),
      url ? jsxs('span', { className: 'ml-auto flex shrink-0 items-center gap-0.5', children: [
        jsx(CopyButton, { appearance: 'icon', buttonSize: 'icon-sm', label: 'Copy GitHub URL', text: url }),
        jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-7 w-7 p-0', onClick: () => openExternal(url), 'aria-label': 'Open on GitHub', children: jsx(Codicon, { name: 'link-external' }) }),
      ] }) : null,
    ],
  })
}

function DetailSummary({ title, number, children }) {
  return jsxs('div', {
    className: 'gh-detail-summary shrink-0 border-b border-(--ui-stroke-secondary) px-3 py-2',
    children: [
      jsx(ItemTitle, { title, number, detail: true }),
      children,
    ],
  })
}

function DetailLoading({ repo, number, onBack, backLabel }) {
  return jsxs('div', { className: 'flex h-full flex-col', children: [
    jsx(DetailToolbar, { repo, number, onBack, backLabel }),
    jsxs('div', { className: 'space-y-3 p-4', 'aria-busy': true, children: [
      jsx(Skeleton, { className: 'h-5 w-4/5' }),
      jsx(Skeleton, { className: 'h-4 w-3/5' }),
      jsx(Separator, {}),
      jsx(Skeleton, { className: 'h-24 w-full rounded-md' }),
    ] }),
  ] })
}

function DetailError({ repo, number, title, error, onBack, backLabel }) {
  return jsxs('div', { className: 'flex h-full flex-col', children: [
    jsx(DetailToolbar, { repo, number, onBack, backLabel }),
    jsx('div', { className: 'p-6', children: jsx(ErrorState, { title, description: String(error?.message || error) }) }),
  ] })
}

function PrDetail({ repo, number, onBack }) {
  const [page, setPage] = useState('conversation')
  const n = String(number)
  const headerQ = useQuery({
    queryKey: [ID, 'pr-page', repo, n],
    enabled: !!repo && !!number,
    queryFn: () => ghApiBig(repo, `pulls/${n}`, '{number,title,state,draft,merged,mergeable,mergeable_state,user:.user.login,created_at,additions,deletions,changed_files,base:.base.ref,head:.head.ref,html_url,body:(.body//""),comments}'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const convQ = useQuery({
    queryKey: [ID, 'pr-conv', repo, n],
    enabled: !!repo && !!number && page === 'conversation',
    queryFn: async () => {
      const comments = await ghApiBig(repo, `issues/${n}/comments`, '[.[:20][]|{user:.user.login,created_at,html_url,body:(.body//"")}]')
      const reviews = await ghApiBig(repo, `pulls/${n}/reviews`, '[.[:15][]|{user:.user.login,state,html_url,body:(.body//""),submitted_at}]')
      // Issue #9: line-level review comments live on their own endpoint; bodies
      // and hunks are big, so same shBig routing as the rest of this query.
      const inline = await ghApiBigPaginatedProjected(repo, `pulls/${n}/comments?per_page=100`, '[.[]|{id,user:.user.login,body:(.body//""),path,line,original_line,in_reply_to_id,created_at,html_url,diff_hunk:(.diff_hunk//"")}]')
      return {
        comments: Array.isArray(comments) ? comments : [],
        reviews: Array.isArray(reviews) ? reviews : [],
        threads: groupInlineThreads(inline),
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const filesQ = useQuery({
    queryKey: [ID, 'pr-files', repo, n],
    enabled: !!repo && !!number && page === 'files',
    queryFn: () => ghApiBigPaginatedProjected(repo, `pulls/${n}/files?per_page=100`, '[.[]|{filename,status,additions,deletions,patch:(.patch//"")}]'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const commitsQ = useQuery({
    queryKey: [ID, 'pr-commits', repo, n],
    enabled: !!repo && !!number && page === 'commits',
    queryFn: () => ghApiBig(repo, `pulls/${n}/commits`, '[.[:30][]|{sha:.sha[0:7],full:.sha,msg:(.commit.message|sub("\n(?s).*";"")),author:(.commit.author.name//.author.login//"—"),date:(.commit.author.date//"")}]'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const checksQ = useQuery({
    queryKey: [ID, 'pr-checks', repo, n],
    enabled: !!repo && !!number && (page === 'checks' || page === 'conversation'),
    queryFn: async () => {
      const rows = await shJsonLoose(`${GH} pr checks ${sq(n)} --repo ${sq(repo)} --json name,state,bucket,link`)
      return Array.isArray(rows) ? rows : []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const d = headerQ.data
  if (headerQ.isLoading) return jsx(DetailLoading, { repo, number, onBack, backLabel: 'Back to pull requests' })
  if (headerQ.isError) return jsx(DetailError, { repo, number, title: 'Could not load pull request', error: headerQ.error, onBack, backLabel: 'Back to pull requests' })
  if (!d) return null

  const url = d.html_url || `https://github.com/${repo}/pull/${d.number}`
  const files = Array.isArray(filesQ.data) ? filesQ.data : []
  const commits = Array.isArray(commitsQ.data) ? commitsQ.data : []
  const checks = Array.isArray(checksQ.data) ? checksQ.data : []
  const comments = convQ.data?.comments || []
  const reviews = convQ.data?.reviews || []
  const threads = convQ.data?.threads || []
  // Issue #9: one chronological timeline of reviews, issue comments, and inline threads.
  const timeline = [
    ...reviews.map((r, i) => ({ ts: r.submitted_at, el: jsx(CommentCard, { login: r.user, verb: 'reviewed', time: ago(r.submitted_at), timestamp: r.submitted_at, reviewState: r.state, body: r.body, permalink: r.html_url }, `r-${i}`) })),
    ...comments.map((c, i) => ({ ts: c.created_at, el: jsx(CommentCard, { login: c.user, verb: 'commented', time: ago(c.created_at), timestamp: c.created_at, body: c.body, permalink: c.html_url }, `c-${i}`) })),
    ...threads.map((t, i) => ({ ts: t.root.created_at, el: jsxs('div', { className: 'gh-timeline', children: [
      jsx(CommentCard, { login: t.root.user, verb: 'commented on the diff', time: ago(t.root.created_at), timestamp: t.root.created_at, body: t.root.body, permalink: t.root.html_url, fileChip: inlineFileChip(t.root), hunk: t.root.diff_hunk || undefined }, `t-${i}-root`),
      ...t.replies.map((r, j) => jsx('div', { className: 'ml-4', children: jsx(CommentCard, { login: r.user, verb: 'replied', time: ago(r.created_at), timestamp: r.created_at, body: r.body, permalink: r.html_url, fileChip: inlineFileChip(r) }, `t-${i}-${j}`) })),
    ] }, `t-${i}`) })),
  ].sort((a, b) => (Date.parse(a.ts || '') || 0) - (Date.parse(b.ts || '') || 0)).map(x => x.el)

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsx(DetailToolbar, { repo, number: d.number, url, onBack, backLabel: 'Back to pull requests' }),
      jsxs(DetailSummary, {
        title: d.title,
        number: d.number,
        children: [
          jsxs('div', { className: 'gh-detail-meta text-[11px] text-(--ui-text-tertiary)', children: [
            jsx(StatePill, { d }),
            jsx(Person, { login: d.user, size: 16 }),
            jsx('span', { children: ago(d.created_at) }),
            jsx('span', { className: 'font-mono', children: `${d.head} → ${d.base}` }),
            jsxs('span', { children: [jsx(DiffCount, { add: d.additions, del: d.deletions }), jsx('span', { children: ` · ${d.changed_files ?? 0} files` })] }),
            d.comments ? jsx(Badge, { variant: 'secondary', className: 'h-5 text-[10px]', children: `${d.comments} comments` }) : null,
          ] }),
          prStateKey(d) === 'open' && !d.draft
            ? jsx(MergeControl, { repo, number: d.number, mergeableState: d.mergeable_state })
            : null,
        ],
      }),
      jsx('div', {
        className: 'gh-detail-tabs shrink-0 border-b border-(--ui-stroke-secondary) px-3 py-2',
        children: jsx(SegmentedControl, {
          value: page,
          onChange: setPage,
          className: 'w-full',
          options: [
            { id: 'conversation', label: 'Conversation' },
            { id: 'commits', label: 'Commits' },
            { id: 'checks', label: 'Checks' },
            { id: 'files', label: 'Files' },
          ],
        }),
      }),
      jsx(ScrollArea, {
        className: 'flex-1 min-h-0',
        children:
          page === 'conversation'
            ? jsxs('div', { className: 'gh-timeline p-3', children: [
                jsx(CommentCard, { login: d.user, verb: 'described this', body: d.body, timestamp: d.created_at, permalink: url, size: 20 }),
                jsx(ChecksView, { checks, loading: checksQ.isLoading, error: checksQ.isError ? checksQ.error : null, onRetry: () => checksQ.refetch(), compact: true }),
                convQ.isLoading
                  ? jsx(Skeleton, { className: 'h-24 w-full rounded-md' })
                  : timeline.length
                    ? jsxs(Fragment, { children: timeline })
                    : jsx('div', { className: 'text-[11px] text-(--ui-text-quaternary)', children: 'No comments yet.' }),
              ] })
            : page === 'commits'
              ? jsx('div', { className: 'p-3', children: jsx(CommitsView, { repo, commits, loading: commitsQ.isLoading, error: commitsQ.isError ? commitsQ.error : null, onRetry: () => commitsQ.refetch() }) })
              : page === 'checks'
                ? jsx('div', { className: 'p-3', children: jsx(ChecksView, { checks, loading: checksQ.isLoading, error: checksQ.isError ? checksQ.error : null, onRetry: () => checksQ.refetch() }) })
                : jsx('div', { className: 'p-3', children: jsx(FilesView, { files, loading: filesQ.isLoading, error: filesQ.isError ? filesQ.error : null, onRetry: () => filesQ.refetch() }) }),
      }),
    ],
  })
}

function IssueDetail({ repo, number, onBack }) {
  const q = useQuery({
    queryKey: [ID, 'issue-detail', repo, number],
    enabled: !!repo && !!number,
    queryFn: () => shJsonBig(`${GH} issue view ${sq(String(number))} --repo ${sq(repo)} --json number,title,body,state,author,createdAt,comments,labels,url`),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const d = q.data
  if (q.isLoading) return jsx(DetailLoading, { repo, number, onBack, backLabel: 'Back to issues' })
  if (q.isError) return jsx(DetailError, { repo, number, title: 'Could not load issue', error: q.error, onBack, backLabel: 'Back to issues' })
  if (!d) return null
  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsx(DetailToolbar, { repo, number: d.number, url: d.url, onBack, backLabel: 'Back to issues' }),
      jsx(DetailSummary, {
        title: d.title,
        number: d.number,
        children: jsxs('div', { className: 'gh-detail-meta text-[11px] text-(--ui-text-tertiary)', children: [
          jsx(StatePill, { d }),
          jsx(Person, { login: d.author?.login, size: 16 }),
          jsx('span', { children: ago(d.createdAt) }),
          jsx(Badge, { variant: 'secondary', className: 'h-5 text-[10px]', children: `${(d.comments || []).length} comments` }),
          ...(Array.isArray(d.labels) ? d.labels.map(label => jsx(LabelChip, { label }, label.name || label.id)) : []),
        ] }),
      }),
      jsx(ScrollArea, {
        className: 'min-h-0 flex-1',
        children: jsxs('div', { className: 'space-y-4 p-3', children: [
          jsx(CommentCard, { login: d.author?.login, verb: 'described this', body: d.body, timestamp: d.createdAt, permalink: d.url, size: 20 }),
          jsxs('section', { className: 'space-y-2', children: [
            jsxs('div', { className: 'flex items-center gap-2 px-0.5', children: [
              jsx('h2', { className: 'text-xs font-semibold text-(--ui-text-secondary)', children: 'Comments' }),
              jsx(Badge, { variant: 'secondary', className: 'h-5 min-w-5 justify-center text-[10px]', children: String((d.comments || []).length) }),
            ] }),
            (d.comments || []).length
              ? jsx('div', { className: 'gh-timeline', children: d.comments.map(c => jsx(CommentCard, { login: c.author?.login, verb: 'commented', time: ago(c.createdAt), timestamp: c.createdAt, body: c.body, permalink: c.url, size: 16 }, c.id || c.url)) })
              : jsx('div', { className: 'rounded-md border border-(--ui-stroke-secondary) px-3 py-4 text-center text-xs text-(--ui-text-quaternary)', children: 'No comments yet.' }),
          ] }),
        ] }),
      }),
    ],
  })
}

function SessionPrBanner() {
  const cwd = useValue(host.state.cwd)
  const activeId = useValue(host.state.activeSessionId)
  const { pr, loading } = useSessionPr(cwd, activeId)
  if (loading || !pr) return null
  return jsxs('button', {
    type: 'button',
    onClick: () => {
      $repo.set(pr.repo)
      $tab.set('prs')
      $selPr.set(pr.number)
      $selIssue.set(null)
    },
    className: 'shrink-0 w-full text-left border-b border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) px-3 py-2 flex items-center gap-2 hover:bg-(--ui-bg-quinary)',
    children: [
      jsx(StateDot, { state: pr.state, isDraft: pr.isDraft }),
      jsxs('span', { className: 'min-w-0 flex-1', children: [
        jsx('span', { className: 'block text-[10px] text-(--ui-text-quaternary)', children: pr.source === 'transcript' ? 'Linked in this session' : 'This session’s branch' }),
        jsx('span', { className: 'block text-xs font-medium break-words', children: `#${pr.number} ${pr.title || ''}` }),
      ] }),
      jsx(Badge, { variant: 'secondary', className: 'text-[10px] h-4 shrink-0', children: String(pr.state || '').toLowerCase() }),
    ],
  })
}

function GitHubPane() {
  const reposQ = useRepos()
  const repo = useValue($repo)
  const tab = useValue($tab)
  const query = useValue($listQuery)
  const selPr = useValue($selPr)
  const selIssue = useValue($selIssue)
  const cwd = useValue(host.state.cwd)
  const gitQ = useSessionGit(cwd)

  useEffect(() => {
    const sessionRepo = gitQ.data?.repo
    if (sessionRepo) {
      // Follow the session's repo; a manual pick stands until it changes again.
      if (sessionRepo !== lastAutoRepo) {
        lastAutoRepo = sessionRepo
        if (sessionRepo !== repo) $repo.set(sessionRepo)
      }
    } else if (gitQ.data) {
      lastAutoRepo = null // cwd resolved with no repo: re-arm auto-follow
    } else if (!repo && reposQ.data?.length) {
      const saved = pluginCtx?.storage.get('repo')
      $repo.set(saved && reposQ.data.includes(saved) ? saved : reposQ.data[0])
    }
  }, [reposQ.data, gitQ.data, repo])
  useEffect(() => { if (repo) pluginCtx?.storage.set('repo', repo) }, [repo])
  useEffect(() => { $selPr.set(null); $selIssue.set(null); $listQuery.set('') }, [repo])

  const showPr = tab === 'prs' && selPr != null
  const showIssue = tab === 'issues' && selIssue != null

  if (showPr) return jsx(PrDetail, { repo, number: selPr, onBack: () => $selPr.set(null) })
  if (showIssue) return jsx(IssueDetail, { repo, number: selIssue, onBack: () => $selIssue.set(null) })

  if (reposQ.isError) {
    return jsx('div', { className: 'p-6', children: jsx(ErrorState, {
      title: 'Could not load repositories',
      description: String(reposQ.error?.message || reposQ.error),
      children: jsx(Button, { variant: 'outline', size: 'sm', onClick: () => reposQ.refetch(), children: 'Retry' }),
    }) })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col min-h-0',
    children: [
      jsx(SessionPrBanner, {}),
      jsxs('div', {
        className: 'gh-shell-header shrink-0 p-3',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              reposQ.isLoading
                ? jsx(Skeleton, { className: 'h-8 flex-1 rounded-md' })
                : jsx('div', { className: 'min-w-0 flex-1', children: jsx(RepoPicker, { repos: reposQ.data || [], value: repo, onChange: v => $repo.set(v) }) }),
              jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-7 w-7 p-0 ml-auto', onClick: () => queryClient.invalidateQueries({ queryKey: [ID] }), 'aria-label': 'Refresh GitHub data', children: jsx(icons.RefreshCw, { className: 'size-3' }) }),
            ],
          }),
          jsx(Separator, { className: 'my-3' }),
          jsx(SegmentedControl, {
            value: tab,
            onChange: v => $tab.set(v),
            className: 'gh-list-tabs w-full',
            options: [{ id: 'prs', label: 'PRs' }, { id: 'issues', label: 'Issues' }],
          }),
          jsxs('div', {
            className: 'mt-3 flex items-center gap-2',
            children: [
              jsx(SearchField, {
                'aria-label': `Search ${tab === 'prs' ? 'pull requests' : 'issues'}`,
                containerClassName: 'min-w-0 flex-1',
                inputClassName: 'flex-1',
                placeholder: `Search ${tab === 'prs' ? 'pull requests' : 'issues'}`,
                value: query,
                onChange: value => $listQuery.set(value),
              }),
              jsx(StateSelect, { kind: tab }),
            ],
          }),
        ],
      }),
      jsx('div', {
        className: 'flex-1 min-h-0',
        children: tab === 'prs'
          ? jsx(PrList, { repo, query, onOpen: n => $selPr.set(n) })
          : jsx(IssueList, { repo, query, onOpen: n => $selIssue.set(n) }),
      }),
    ],
  })
}

function GithubPage() {
  const reposQ = useRepos()
  const repo = useValue($repo)
  const tab = useValue($tab)
  const query = useValue($listQuery)
  const selPr = useValue($selPr)
  const selIssue = useValue($selIssue)
  const cwd = useValue(host.state.cwd)
  const gitQ = useSessionGit(cwd)

  useEffect(() => {
    const sessionRepo = gitQ.data?.repo
    if (sessionRepo) {
      if (sessionRepo !== lastAutoRepo) {
        lastAutoRepo = sessionRepo
        if (sessionRepo !== repo) $repo.set(sessionRepo)
      }
    } else if (gitQ.data) {
      lastAutoRepo = null
    } else if (!repo && reposQ.data?.length) {
      const saved = pluginCtx?.storage.get('repo')
      $repo.set(saved && reposQ.data.includes(saved) ? saved : reposQ.data[0])
    }
  }, [reposQ.data, gitQ.data, repo])
  useEffect(() => { if (repo) pluginCtx?.storage.set('repo', repo) }, [repo])
  useEffect(() => { $selPr.set(null); $selIssue.set(null); $listQuery.set('') }, [repo])

  const showPr = tab === 'prs' && selPr != null
  const showIssue = tab === 'issues' && selIssue != null
  if (showPr) return jsx(PrDetail, { repo, number: selPr, onBack: () => $selPr.set(null) })
  if (showIssue) return jsx(IssueDetail, { repo, number: selIssue, onBack: () => $selIssue.set(null) })

  if (reposQ.isError) {
    return jsx('div', { className: 'mx-auto w-full max-w-[1020px] p-6', children: jsx(ErrorState, {
      title: 'Could not load repositories',
      description: String(reposQ.error?.message || reposQ.error),
      children: jsx(Button, { variant: 'outline', size: 'sm', onClick: () => reposQ.refetch(), children: 'Retry' }),
    }) })
  }

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className: 'shrink-0 border-b border-(--ui-stroke-secondary) bg-(--ui-editor-surface-background)',
        children: [
          jsx(SessionPrBanner, {}),
          jsxs('div', {
            className: 'mx-auto flex w-full max-w-[1020px] flex-col gap-3 px-4 py-3 sm:px-6',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsxs('span', { className: 'flex items-center gap-2 text-sm font-semibold', children: [jsx(Codicon, { name: 'github' }), 'GitHub'] }),
                  jsx('span', { className: 'text-xs text-(--ui-text-quaternary)', children: repo || '—' }),
                  jsx(Button, { variant: 'ghost', size: 'sm', className: 'ml-auto h-7 w-7 p-0', onClick: () => queryClient.invalidateQueries({ queryKey: [ID] }), 'aria-label': 'Refresh', children: jsx(icons.RefreshCw, { className: 'size-3' }) }),
                  jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-7 px-2 text-xs', onClick: openGithubPane, children: 'Open pane' }),
                ],
              }),
              reposQ.isLoading
                ? jsx(Skeleton, { className: 'h-8 w-full max-w-[420px] rounded-md' })
                : jsx('div', { className: 'max-w-[420px]', children: jsx(RepoPicker, { repos: reposQ.data || [], value: repo, onChange: v => $repo.set(v) }) }),
              jsx(SegmentedControl, {
                value: tab,
                onChange: v => $tab.set(v),
                className: 'gh-list-tabs w-full max-w-[360px]',
                options: [{ id: 'prs', label: 'PRs' }, { id: 'issues', label: 'Issues' }],
              }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(SearchField, {
                    'aria-label': `Search ${tab === 'prs' ? 'pull requests' : 'issues'}`,
                    containerClassName: 'min-w-0 flex-1',
                    inputClassName: 'flex-1',
                    placeholder: 'Filter by title, #number, author, branch or label',
                    value: query,
                    onChange: value => $listQuery.set(value),
                  }),
                  jsx(StateSelect, { kind: tab }),
                ],
              }),
            ],
          }),
        ],
      }),
      jsx('div', {
        className: 'mx-auto flex w-full max-w-[1020px] flex-1 min-h-0 flex-col px-2 py-2 sm:px-6 sm:py-3',
        children: tab === 'prs'
          ? jsx(PrList, { repo, query, onOpen: n => $selPr.set(n) })
          : jsx(IssueList, { repo, query, onOpen: n => $selIssue.set(n) }),
      }),
    ],
  })
}

export default {
  id: ID,
  name: 'GitHub PRs',
  register(ctx) {
    pluginCtx = ctx
    const saved = ctx.storage.get('repo')
    if (saved) $repo.set(saved)

    const paneWrap = () => jsxs('div', { className: 'github-prs-pane h-full min-h-0 min-w-0 max-w-full overflow-hidden', children: [
      jsx('style', { children: PANE_WRAP_CSS }),
      jsxs('div', { className: 'gh-narrow-only h-full flex-col items-center justify-center gap-2 px-2 text-center text-(--ui-text-quaternary)', children: [
        jsx(Codicon, { name: 'github', className: 'text-base' }),
        jsx('span', { className: 'text-[10px] leading-4', children: 'Widen pane' }),
      ] }),
      jsx('div', { className: 'gh-pane-content h-full min-h-0', children: jsx(GitHubPane, {}) }),
    ] })
    const pageShell = () => jsxs('div', { className: 'github-prs-pane h-full min-h-0 min-w-0 max-w-full overflow-hidden bg-(--ui-editor-surface-background)', children: [jsx('style', { children: PANE_WRAP_CSS }), jsx(GithubPage, {})] })

    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'GitHub',
      data: {
        placement: 'main',
        dock: { pane: 'workspace', pos: 'right' },
        width: '440px',
        revealAliases: [PANE_ID, 'github'],
      },
      render: paneWrap,
    })
    // Dedicated full page (workspace route) — does NOT replace the pane.
    // Sidebar orders on `order` within SIDEBAR_NAV_AREA; this keeps GitHub
    // near the top. Falls back to literals if the SDK build omits the exports.
    ctx.register({
      id: 'route-github',
      area: ROUTES_AREA_LIT,
      data: { path: GITHUB_ROUTE },
      render: pageShell,
    })
    ctx.register({
      id: 'nav-github',
      area: SIDEBAR_NAV_LIT,
      order: 12,
      data: { path: GITHUB_ROUTE, label: 'GitHub', codicon: 'github' },
    })
    ctx.register({
      id: 'palette',
      area: PALETTE_AREA,
      data: { id: 'github-prs.open', label: 'Open GitHub pane', keywords: ['github', 'pr', 'issue', 'pull request'], run: openGithubPane },
    })
    ctx.register({
      id: 'palette-page',
      area: PALETTE_AREA,
      data: { id: 'github-prs.open-page', label: 'GitHub: Open page', keywords: ['github', 'page', 'pr', 'issue'], run: openGithubPage },
    })
    ctx.register({ id: 'titlebar-github', area: TITLEBAR_AREAS.right, order: 20, render: () => jsx(TitlebarGithubButton, {}) })
    ctx.register({ id: 'titlebar-session-pr', area: TITLEBAR_AREAS.center, order: 10, render: () => jsx(SessionPrChip, {}) })
  },
}
