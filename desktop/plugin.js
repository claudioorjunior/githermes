/**
 * github-prs — GitHub PRs & Issues as a right workspace pane.
 * Data via `host.request('shell.exec')` + connected `gh`. No backend.
 * Session PR: cwd git branch (same join as core review) + transcript URL scan.
 * ponytail: list caps at 30 (shell stdout 4000 chars); paginate when truncated.
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
  ScrollArea,
  EmptyState,
  GlyphSpinner,
  Tabs,
  TabsList,
  TabsTrigger,
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
.github-prs-pane, .github-prs-pane * { box-sizing: border-box; min-width: 0; }
.github-prs-pane { width: 100%; max-width: 100%; overflow: hidden; }
.github-prs-pane [data-radix-scroll-area-viewport] > div { display: block !important; min-width: 0 !important; width: 100% !important; }
.github-prs-pane :is(h1, h2, h3, h4, h5, h6, p, li, a, span, code, summary, td, th, blockquote) { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.github-prs-pane pre { max-width: 100%; overflow-x: auto; }
/* divide color + active tab underline (Tailwind variants not compiled for runtime plugins) */
.github-prs-pane .gh-divide > :not(:last-child) { border-bottom: 1px solid var(--ui-stroke-secondary); }
.github-prs-pane .gh-tab[data-state="active"] { border-bottom-color: var(--ui-accent); color: var(--ui-text-primary); }
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

const $repo = atom('')
const $tab = atom('prs')
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
    className: 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white',
    style: { background: m.bg },
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
      jsx(SelectTrigger, { className: 'h-7 text-xs', children: jsx(SelectValue, { placeholder: 'Select repo' }) }),
      jsx(SelectContent, { children: repos.map(r => jsx(SelectItem, { value: r, children: r }, r)) }),
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
    className: 'inline-flex items-center gap-1.5 min-w-0',
    children: [
      jsx(Avatar, { login, size }),
      jsx('span', { className: 'font-semibold text-(--ui-text-primary) truncate', children: login || '—' }),
      extra ? jsx('span', { className: 'text-(--ui-text-tertiary)', children: extra }) : null,
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
  const btn = jsxs(Button, {
    variant: 'ghost',
    size: 'sm',
    className: 'h-6 px-1.5 gap-1 text-[10px]',
    disabled: !activeId,
    onClick: () => sendCommentToChat(comment),
    children: [
      jsx(Codicon, { name: 'comment' }),
      jsx('span', { children: 'Quote' }),
    ],
  })
  if (!activeId) return jsx('span', { className: wrap, title: 'No active session — open a chat first', children: btn })
  return jsx(Tip, { label: 'Quote in chat', children: jsx('span', { className: wrap, children: btn }) })
}

// GitHub-style comment card: tinted header bar (avatar · login · verb · time [+ review badge]), body below.
function CommentCard({ login, verb, time, timestamp, reviewState, body, permalink, size = 18 }) {
  const badge = reviewState ? REVIEW_BADGE[String(reviewState).toUpperCase()] : null
  return jsxs('div', { className: 'rounded-md border border-(--ui-stroke-secondary) overflow-hidden', children: [
    jsxs('div', { className: 'flex items-center gap-1.5 bg-(--ui-bg-quaternary) border-b border-(--ui-stroke-secondary) px-2.5 py-1.5', children: [
      jsx(Avatar, { login, size }),
      jsx('span', { className: 'font-semibold text-xs text-(--ui-text-primary) truncate', children: login || '—' }),
      jsx('span', { className: 'text-[11px] text-(--ui-text-tertiary) truncate', children: verb }),
      time ? jsx('span', { className: 'text-[11px] text-(--ui-text-quaternary) shrink-0', children: time }) : null,
      badge ? jsxs('span', { className: 'ml-auto inline-flex items-center gap-1 shrink-0 text-[10px] font-medium text-(--ui-text-secondary)', children: [
        jsx('span', { className: 'size-1.5 rounded-full', style: { background: badge.color } }),
        badge.label,
      ] }) : null,
      jsx(SendToChatButton, { comment: { login, verb, timestamp, body, permalink }, className: badge ? undefined : 'ml-auto' }),
    ] }),
    jsx('div', { className: 'p-2.5', children: jsx(MdBody, { text: body }) }),
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

function PrList({ repo, onOpen, highlight }) {
  const state = useValue($prState)
  const q = useQuery({
    queryKey: [ID, 'prs', repo, state],
    enabled: !!repo,
    queryFn: () => shJson(`${GH} pr list --repo ${sq(repo)} --state ${sq(state)} --limit 30 --json number,title,state,author,updatedAt,url,baseRefName,headRefName,isDraft,additions,deletions,changedFiles`),
    staleTime: 15_000,
  })
  if (!repo) return jsx(EmptyState, { title: 'Select a repository', description: 'Pick one above to list PRs.' })
  if (q.isLoading) return jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
  if (q.isError) return jsx('div', { className: 'p-3 text-xs text-(--ui-red)', children: String(q.error?.message || q.error) })
  const items = Array.isArray(q.data) ? q.data : []
  if (!items.length) return jsx(EmptyState, { title: 'No PRs', description: `No ${state} PRs in ${repo}.` })
  return jsx(ScrollArea, {
    className: 'h-full',
    children: jsx('div', {
      className: 'divide-y gh-divide',
      children: items.map(pr =>
        jsxs('button', {
          type: 'button',
          onClick: () => onOpen(pr.number),
          className: cn('w-full text-left px-3 py-2 hover:bg-(--ui-bg-quinary) flex gap-2 items-start', highlight === pr.number && 'bg-(--ui-bg-quaternary)'),
          children: [
            jsx('span', { className: 'mt-1', children: jsx(Avatar, { login: pr.author?.login, size: 22 }) }),
            jsxs('span', {
              className: 'min-w-0 flex-1',
              children: [
                jsxs('span', { className: 'flex gap-1.5 items-baseline flex-wrap', children: [
                  jsx('span', { className: 'font-medium text-xs break-words', children: pr.title }),
                  jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: `#${pr.number}` }),
                ] }),
                jsxs('span', { className: 'text-[10px] text-(--ui-text-tertiary)', children: [
                  jsx('span', { children: `${pr.headRefName || '—'} · ` }),
                  jsx(DiffCount, { add: pr.additions, del: pr.deletions }),
                  jsx('span', { children: ` · ${ago(pr.updatedAt)}` }),
                ] }),
              ],
            }),
          ],
        }, String(pr.number))
      ),
    }),
  })
}

function IssueList({ repo, onOpen }) {
  const state = useValue($issueState)
  const q = useQuery({
    queryKey: [ID, 'issues', repo, state],
    enabled: !!repo,
    queryFn: () => shJson(`${GH} issue list --repo ${sq(repo)} --state ${sq(state)} --limit 30 --json number,title,state,author,updatedAt,url,labels`),
    staleTime: 15_000,
  })
  if (!repo) return jsx(EmptyState, { title: 'Select a repository', description: 'Pick one above to list issues.' })
  if (q.isLoading) return jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
  if (q.isError) return jsx('div', { className: 'p-3 text-xs text-(--ui-red)', children: String(q.error?.message || q.error) })
  const items = Array.isArray(q.data) ? q.data : []
  if (!items.length) return jsx(EmptyState, { title: 'No issues', description: `No ${state} issues in ${repo}.` })
  return jsx(ScrollArea, {
    className: 'h-full',
    children: jsx('div', {
      className: 'divide-y gh-divide',
      children: items.map(it =>
        jsxs('button', {
          type: 'button',
          onClick: () => onOpen(it.number),
          className: 'w-full text-left px-3 py-2 hover:bg-(--ui-bg-quinary) flex gap-2 items-start',
          children: [
            jsx('span', { className: 'mt-1', children: jsx(Avatar, { login: it.author?.login, size: 22 }) }),
            jsxs('span', {
              className: 'min-w-0 flex-1',
              children: [
                jsxs('span', { className: 'flex gap-1.5 items-baseline flex-wrap', children: [
                  jsx('span', { className: 'font-medium text-xs break-words', children: it.title }),
                  jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: `#${it.number}` }),
                ] }),
                jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary)', children: `${it.author?.login || '—'} · ${ago(it.updatedAt)}` }),
              ],
            }),
          ],
        }, String(it.number))
      ),
    }),
  })
}

function PrDetail({ repo, number, onBack }) {
  const [page, setPage] = useState('conversation')
  const n = String(number)
  const headerQ = useQuery({
    queryKey: [ID, 'pr-page', repo, n],
    enabled: !!repo && !!number,
    queryFn: () => ghApi(repo, `pulls/${n}`, '{number,title,state,draft,merged,user:.user.login,created_at,additions,deletions,changed_files,base:.base.ref,head:.head.ref,html_url,body:(.body//""|.[0:1800]),comments}'),
    staleTime: 15_000,
  })
  const convQ = useQuery({
    queryKey: [ID, 'pr-conv', repo, n],
    enabled: !!repo && !!number && page === 'conversation',
    queryFn: async () => {
      const comments = await ghApi(repo, `issues/${n}/comments`, '[.[:20][]|{user:.user.login,created_at,html_url,body:(.body//""|if length>700 then .[0:700]+"…" else . end)}]').catch(() => [])
      const reviews = await ghApi(repo, `pulls/${n}/reviews`, '[.[:15][]|{user:.user.login,state,html_url,body:(.body//""|if length>400 then .[0:400]+"…" else . end),submitted_at}]').catch(() => [])
      return { comments: Array.isArray(comments) ? comments : [], reviews: Array.isArray(reviews) ? reviews : [] }
    },
    staleTime: 15_000,
  })
  const filesQ = useQuery({
    queryKey: [ID, 'pr-files', repo, n],
    enabled: !!repo && !!number && page === 'files',
    queryFn: () => ghApi(repo, `pulls/${n}/files`, '[.[:40][]|{filename,status,additions,deletions}]'),
    staleTime: 15_000,
  })
  const commitsQ = useQuery({
    queryKey: [ID, 'pr-commits', repo, n],
    enabled: !!repo && !!number && page === 'commits',
    queryFn: () => ghApi(repo, `pulls/${n}/commits`, '[.[:30][]|{sha:.sha[0:7],msg:(.commit.message|split("\n")[0]),author:(.commit.author.name//.author.login//"—")}]'),
    staleTime: 15_000,
  })
  const checksQ = useQuery({
    queryKey: [ID, 'pr-checks', repo, n],
    enabled: !!repo && !!number && page === 'checks',
    queryFn: async () => {
      const rows = await shJsonLoose(`${GH} pr checks ${sq(n)} --repo ${sq(repo)} --json name,state,bucket,link`)
      return Array.isArray(rows) ? rows : []
    },
    staleTime: 15_000,
  })

  const d = headerQ.data
  const [owner, name] = String(repo || '').split('/')
  if (headerQ.isLoading) return jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
  if (headerQ.isError) return jsxs('div', { className: 'p-3', children: [jsx(Button, { variant: 'ghost', size: 'sm', onClick: onBack, children: '← Back' }), jsx('div', { className: 'mt-3 text-xs text-(--ui-red)', children: String(headerQ.error?.message || headerQ.error) })] })
  if (!d) return null

  const url = d.html_url || `https://github.com/${repo}/pull/${d.number}`
  const files = Array.isArray(filesQ.data) ? filesQ.data : []
  const commits = Array.isArray(commitsQ.data) ? commitsQ.data : []
  const checks = Array.isArray(checksQ.data) ? checksQ.data : []
  const comments = convQ.data?.comments || []
  const reviews = convQ.data?.reviews || []

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className: 'shrink-0 border-b border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) px-3 py-2 flex items-center gap-1.5 text-xs text-(--ui-text-tertiary)',
        children: [
          jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-6 px-1.5 -ml-1', onClick: onBack, children: jsx(Codicon, { name: 'chevron-left' }) }),
          jsxs('span', { className: 'truncate', children: [jsx('span', { children: owner }), jsx('span', { className: 'mx-0.5 opacity-50', children: '/' }), jsx('span', { className: 'font-medium text-(--ui-text-primary)', children: name })] }),
          jsx('span', { className: 'opacity-40', children: '·' }),
          jsx('span', { className: 'font-mono', children: `#${d.number}` }),
          jsxs('span', { className: 'ml-auto flex gap-0.5', children: [
            jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-6 w-6 p-0', onClick: () => pluginCtx?.os.writeClipboard(url), children: jsx(Codicon, { name: 'copy' }) }),
            jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-6 w-6 p-0', onClick: () => openExternal(url), children: jsx(Codicon, { name: 'link-external' }) }),
          ] }),
        ],
      }),
      jsxs('div', {
        className: 'shrink-0 border-b border-(--ui-stroke-secondary) px-3 py-3 space-y-2',
        children: [
          jsxs('h1', { className: 'text-base font-medium leading-snug', children: [
            jsx('span', { className: 'break-words', children: d.title }),
            jsx('span', { className: 'ml-1.5 text-sm font-normal text-(--ui-text-quaternary)', children: `#${d.number}` }),
          ] }),
          jsxs('div', { className: 'flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-(--ui-text-tertiary)', children: [
            jsx(StatePill, { d }),
            jsx(Person, { login: d.user, size: 18 }),
            jsx('span', { children: `${ago(d.created_at)} · ${d.head} → ${d.base}` }),
            jsxs('span', { children: [jsx(DiffCount, { add: d.additions, del: d.deletions }), jsx('span', { children: ` · ${d.changed_files ?? 0} files` })] }),
          ] }),
        ],
      }),
      jsx('div', {
        className: 'shrink-0 border-b border-(--ui-stroke-secondary) px-2',
        children: jsxs(Tabs, {
          value: page,
          onValueChange: setPage,
          children: [jsxs(TabsList, { className: 'h-7 bg-transparent p-0 gap-0', children: [
            jsx(TabsTrigger, { value: 'conversation', className: 'text-[11px] h-7 px-2 rounded-none border-b-2 border-transparent gh-tab', children: 'Conversation' }),
            jsx(TabsTrigger, { value: 'commits', className: 'text-[11px] h-7 px-2 rounded-none border-b-2 border-transparent gh-tab', children: 'Commits' }),
            jsx(TabsTrigger, { value: 'checks', className: 'text-[11px] h-7 px-2 rounded-none border-b-2 border-transparent gh-tab', children: 'Checks' }),
            jsx(TabsTrigger, { value: 'files', className: 'text-[11px] h-7 px-2 rounded-none border-b-2 border-transparent gh-tab', children: 'Files' }),
          ] })],
        }),
      }),
      jsx(ScrollArea, {
        className: 'flex-1 min-h-0',
        children:
          page === 'conversation'
            ? jsxs('div', { className: 'p-3 space-y-3', children: [
                jsx(CommentCard, { login: d.user, verb: 'described this', body: d.body, timestamp: d.created_at, permalink: url, size: 20 }),
                convQ.isLoading
                  ? jsx('div', { className: 'flex justify-center p-4', children: jsx(GlyphSpinner, {}) })
                  : jsxs(Fragment, { children: [
                      reviews.map((r, i) => jsx(CommentCard, { login: r.user, verb: 'reviewed', time: ago(r.submitted_at), timestamp: r.submitted_at, reviewState: r.state, body: r.body, permalink: r.html_url }, `r-${i}`)),
                      comments.length
                        ? comments.map((c, i) => jsx(CommentCard, { login: c.user, verb: 'commented', time: ago(c.created_at), timestamp: c.created_at, body: c.body, permalink: c.html_url }, `c-${i}`))
                        : jsx('div', { className: 'text-[11px] text-(--ui-text-quaternary)', children: 'No comments yet.' }),
                    ] }),
              ] })
            : page === 'commits'
              ? jsx('div', { className: 'p-2', children: commitsQ.isLoading
                  ? jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
                  : !commits.length
                    ? jsx(EmptyState, { title: 'No commits' })
                    : jsx('div', { className: 'divide-y gh-divide rounded-md border border-(--ui-stroke-secondary)', children:
                        commits.map(c => jsxs('div', { className: 'px-3 py-2', children: [
                          jsx('div', { className: 'text-xs font-medium break-words', children: c.msg }),
                          jsx('div', { className: 'text-[10px] font-mono text-(--ui-text-quaternary)', children: `${c.sha} · ${c.author}` }),
                        ] }, c.sha)),
                      })
                })
              : page === 'checks'
                ? jsx('div', { className: 'p-2', children: checksQ.isLoading
                    ? jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
                    : checksQ.isError
                      ? jsx('div', { className: 'p-3 text-xs text-(--ui-red)', children: String(checksQ.error?.message || checksQ.error) })
                      : !checks.length
                        ? jsx(EmptyState, { title: 'No checks', description: 'Nothing reported for this PR.' })
                        : jsx('div', { className: 'divide-y gh-divide rounded-md border border-(--ui-stroke-secondary)', children:
                            checks.map(c => jsxs('button', {
                              type: 'button',
                              onClick: () => c.link && openExternal(c.link),
                              className: 'w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-(--ui-bg-quinary)',
                              children: [
                                jsx('span', { className: 'size-2 rounded-full shrink-0', style: { background: c.bucket === 'pass' ? 'var(--ui-green)' : c.bucket === 'fail' ? 'var(--ui-red)' : c.bucket === 'pending' ? 'var(--ui-yellow)' : 'var(--ui-text-quaternary)' } }),
                                jsxs('span', { className: 'min-w-0 flex-1', children: [
                                  jsx('span', { className: 'block text-xs break-words', children: c.name }),
                                  jsx('span', { className: 'block text-[10px] text-(--ui-text-quaternary)', children: c.state }),
                                ] }),
                              ],
                            }, c.name + c.state)),
                          })
                  })
                : jsx('div', { className: 'p-2', children: filesQ.isLoading
                    ? jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
                    : !files.length
                      ? jsx(EmptyState, { title: 'No files changed' })
                      : jsx('div', { className: 'divide-y gh-divide rounded-md border border-(--ui-stroke-secondary)', children:
                          files.map(f => jsxs('div', { className: 'px-3 py-1.5 flex justify-between gap-2 text-[11px]', children: [
                            jsx('span', { className: 'min-w-0 flex-1 break-all font-mono', children: f.filename }),
                            jsx(DiffCount, { add: f.additions, del: f.deletions, className: 'shrink-0' }),
                          ] }, f.filename)),
                        })
                  }),
      }),
    ],
  })
}

function IssueDetail({ repo, number, onBack }) {
  const q = useQuery({
    queryKey: [ID, 'issue-detail', repo, number],
    enabled: !!repo && !!number,
    queryFn: () => shJson(`${GH} issue view ${sq(String(number))} --repo ${sq(repo)} --json number,title,body,state,author,createdAt,comments,labels,url`),
    staleTime: 15_000,
  })
  const d = q.data
  if (q.isLoading) return jsx('div', { className: 'flex justify-center p-8', children: jsx(GlyphSpinner, {}) })
  if (q.isError) return jsxs('div', { className: 'p-3', children: [jsx(Button, { variant: 'ghost', size: 'sm', onClick: onBack, children: '← Back' }), jsx('div', { className: 'mt-3 text-xs text-(--ui-red)', children: String(q.error?.message || q.error) })] })
  if (!d) return null
  return jsxs(ScrollArea, {
    className: 'h-full',
    children: [
      jsxs('div', {
        className: 'sticky top-0 z-10 bg-(--ui-bg-editor) border-b border-(--ui-stroke-secondary) px-2 py-1.5 flex items-center gap-1',
        children: [
          jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-6 px-1.5 text-xs', onClick: onBack, children: '←' }),
          jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary) truncate', children: `${repo} #${d.number}` }),
          jsx(Button, { size: 'sm', variant: 'outline', className: 'h-6 ml-auto text-[10px]', onClick: () => openExternal(d.url), children: 'GitHub' }),
        ],
      }),
      jsxs('div', {
        className: 'p-3 space-y-3',
        children: [
          jsxs('div', { className: 'flex gap-2 items-center', children: [jsx(Avatar, { login: d.author?.login, size: 22 }), jsx(StateDot, { state: d.state }), jsx('h2', { className: 'text-sm font-semibold', children: d.title })] }),
          jsx(CommentCard, { login: d.author?.login, verb: 'described this', body: d.body, timestamp: d.createdAt, permalink: d.url, size: 20 }),
          jsxs('div', { children: [
            jsx('div', { className: 'text-[10px] font-medium text-(--ui-text-secondary) mb-1', children: `Comments (${(d.comments || []).length})` }),
            (d.comments || []).length
              ? jsx('div', { className: 'space-y-2', children: d.comments.map(c => jsx(CommentCard, { login: c.author?.login, verb: 'commented', time: ago(c.createdAt), timestamp: c.createdAt, body: c.body, permalink: c.url, size: 16 }, c.id || c.url)) })
              : jsx('div', { className: 'text-[10px] text-(--ui-text-quaternary)', children: 'No comments.' }),
          ] }),
        ],
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
  const prState = useValue($prState)
  const issueState = useValue($issueState)
  const selPr = useValue($selPr)
  const selIssue = useValue($selIssue)
  const cwd = useValue(host.state.cwd)
  const gitQ = useSessionGit(cwd)

  useEffect(() => {
    if (!repo && gitQ.data?.repo) $repo.set(gitQ.data.repo)
    else if (!repo && reposQ.data?.length) {
      const saved = pluginCtx?.storage.get('repo')
      $repo.set(saved && reposQ.data.includes(saved) ? saved : reposQ.data[0])
    }
  }, [reposQ.data, gitQ.data, repo])
  useEffect(() => { if (repo) pluginCtx?.storage.set('repo', repo) }, [repo])
  useEffect(() => { $selPr.set(null); $selIssue.set(null) }, [repo])

  const showPr = tab === 'prs' && selPr != null
  const showIssue = tab === 'issues' && selIssue != null

  if (showPr) return jsx(PrDetail, { repo, number: selPr, onBack: () => $selPr.set(null) })
  if (showIssue) return jsx(IssueDetail, { repo, number: selIssue, onBack: () => $selIssue.set(null) })

  if (reposQ.isError) {
    return jsxs('div', {
      className: 'flex h-full flex-col p-4 gap-3',
      children: [
        jsx('div', { className: 'text-sm font-medium', children: 'GitHub' }),
        jsx('div', { className: 'rounded border border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-red)', children: `gh failed: ${String(reposQ.error?.message || reposQ.error)}` }),
        jsx(Button, { variant: 'outline', size: 'sm', onClick: () => reposQ.refetch(), children: 'Retry' }),
      ],
    })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col min-h-0',
    children: [
      jsx(SessionPrBanner, {}),
      jsxs('div', {
        className: 'shrink-0 border-b border-(--ui-stroke-secondary) p-2 space-y-2',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-1.5',
            children: [
              jsx(Codicon, { name: 'github', className: 'text-(--ui-text-secondary)' }),
              jsx('span', { className: 'font-semibold text-xs', children: 'GitHub' }),
              jsx(Button, { variant: 'ghost', size: 'sm', className: 'h-6 ml-auto', onClick: () => queryClient.invalidateQueries({ queryKey: [ID] }), children: jsx(icons.RefreshCw, { className: 'size-3' }) }),
            ],
          }),
          reposQ.isLoading
            ? jsx('div', { className: 'text-[10px] text-(--ui-text-tertiary)', children: 'loading repos…' })
            : jsx(RepoPicker, { repos: reposQ.data || [], value: repo, onChange: v => $repo.set(v) }),
          jsxs('div', {
            className: 'flex gap-1.5 items-center',
            children: [
              jsx(Tabs, {
                value: tab,
                onValueChange: v => $tab.set(v),
                children: jsxs(TabsList, { className: 'h-6', children: [
                  jsx(TabsTrigger, { value: 'prs', className: 'text-[10px] h-5 px-2', children: 'PRs' }),
                  jsx(TabsTrigger, { value: 'issues', className: 'text-[10px] h-5 px-2', children: 'Issues' }),
                ] }),
              }),
              tab === 'prs'
                ? jsxs(Select, { value: prState, onValueChange: v => $prState.set(v), children: [
                    jsx(SelectTrigger, { className: 'h-6 w-24 text-[10px]', children: jsx(SelectValue, {}) }),
                    jsxs(SelectContent, { children: [
                      jsx(SelectItem, { value: 'open', children: 'Open' }),
                      jsx(SelectItem, { value: 'closed', children: 'Closed' }),
                      jsx(SelectItem, { value: 'merged', children: 'Merged' }),
                      jsx(SelectItem, { value: 'all', children: 'All' }),
                    ] }),
                  ] })
                : jsxs(Select, { value: issueState, onValueChange: v => $issueState.set(v), children: [
                    jsx(SelectTrigger, { className: 'h-6 w-24 text-[10px]', children: jsx(SelectValue, {}) }),
                    jsxs(SelectContent, { children: [
                      jsx(SelectItem, { value: 'open', children: 'Open' }),
                      jsx(SelectItem, { value: 'closed', children: 'Closed' }),
                      jsx(SelectItem, { value: 'all', children: 'All' }),
                    ] }),
                  ] }),
            ],
          }),
        ],
      }),
      jsx('div', {
        className: 'flex-1 min-h-0',
        children: tab === 'prs'
          ? jsx(PrList, { repo, onOpen: n => $selPr.set(n), highlight: selPr })
          : jsx(IssueList, { repo, onOpen: n => $selIssue.set(n) }),
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

    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'GitHub',
      // hermes-bots pattern: own tile on the workspace's right edge.
      // placement:'right' joins the collapsible files/review rail and stays hidden.
      data: {
        placement: 'main',
        dock: { pane: 'workspace', pos: 'right' },
        width: '440px',
        revealAliases: [PANE_ID, 'github'],
      },
      render: () => jsxs('div', { className: 'github-prs-pane h-full min-h-0 min-w-0 max-w-full overflow-hidden', children: [jsx('style', { children: PANE_WRAP_CSS }), jsx(GitHubPane, {})] }),
    })
    ctx.register({
      id: 'palette',
      area: PALETTE_AREA,
      data: { id: 'github-prs.open', label: 'Open GitHub pane', keywords: ['github', 'pr', 'issue', 'pull request'], run: openGithubPane },
    })
    ctx.register({ id: 'titlebar-github', area: TITLEBAR_AREAS.right, order: 20, render: () => jsx(TitlebarGithubButton, {}) })
    ctx.register({ id: 'titlebar-session-pr', area: TITLEBAR_AREAS.center, order: 10, render: () => jsx(SessionPrChip, {}) })
  },
}
