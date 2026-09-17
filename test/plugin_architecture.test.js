import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')

test('Issue #26: pane and page share one repository-selection shell', () => {
  assert.ok(source.includes('function useGitHubShellState()'), 'shared shell hook is missing')
  assert.equal((source.match(/const reposQ = useRepos\(\)/g) || []).length, 1)
  // One existing use lives in useSessionPr, one in the status-bar branch item
  // (same query key, so the cache still fetches once); shell selection must
  // add only one more.
  assert.equal((source.match(/const gitQ = useSessionGit\(cwd\)/g) || []).length, 3)
  assert.equal((source.match(/useGitHubShellState\(\)/g) || []).length, 3)
  assert.equal((source.match(/placeholder: 'Filter by title, #number, author, branch or label'/g) || []).length, 2)
})

test('Issue #27: conversation sources start together', () => {
  const detail = source.slice(source.indexOf('function PrDetail'), source.indexOf('function IssueDetail'))
  assert.ok(detail.includes('const [comments, reviews, inline] = await Promise.all(['))
  assert.equal((detail.match(/ghApiBig(?:PaginatedProjected)?\(repo,/g) || []).length, 6)
})

test('Issue #34: polling is tiered, focus-aware and paused with the pane', () => {
  assert.equal((source.match(/refetchIntervalInBackground/g) || []).length, 0)
  assert.equal((source.match(/refetchOnWindowFocus: true/g) || []).length, 8)
  assert.ok(source.includes("refetchInterval: q => livePollInterval(headerQ.data, { kind: 'checks', checks: q.state.data })"))
  assert.equal((source.match(/livePollInterval\(headerQ\.data, \{ kind: 'slow' \}\)/g) || []).length, 2)
  assert.ok(source.includes("const paneVisible = useValue(typeof host.paneVisibility === 'function' ? host.paneVisibility(PANE_ID) : $alwaysVisible)"))
  assert.ok(source.includes("queryKey: [ID, 'pr-checks', repo, String(number)]"))
})

test('Issue #29: Markdown parsing is memoized at the component top level', () => {
  assert.ok(/import \{[^}]*\buseMemo\b[^}]*\} from 'react'/.test(source), 'React useMemo import is missing')

  const body = source.slice(source.indexOf('function MdBody'), source.indexOf('function ListSkeleton'))
  const memo = body.indexOf('const blocks = useMemo(() => mdBlocks(text), [text])')
  assert.ok(memo >= 0 && memo < body.indexOf('if (!text)'), 'MdBody memo must run before its early return')
  assert.ok(body.includes("blocks, keyPrefix: 'b'"))

  const composer = source.slice(source.indexOf('function CommentComposer'), source.indexOf('function PrDetail'))
  assert.ok(composer.includes("const previewBlocks = useMemo(() => mode === 'preview' ? mdBlocks(body) : null, [body, mode])"))
  assert.ok(composer.includes("blocks: previewBlocks, keyPrefix: 'preview'"))
})

test('Issue #29: timeline assembly is memoized before detail early returns', () => {
  const detail = source.slice(source.indexOf('function PrDetail'), source.indexOf('function IssueDetail'))
  const memo = detail.indexOf('const timeline = useMemo(() => assembleTimeline(')
  assert.ok(memo >= 0 && memo < detail.indexOf('if (headerQ.isLoading)'), 'timeline memo must run before early returns')
  assert.ok(detail.includes('[convQ.data?.reviews, convQ.data?.comments, convQ.data?.threads, repo, n]'))
})

test('Issue #31: pane and page wire the shared list keyboard flow', () => {
  assert.equal((source.match(/const keyboard = useListKeyboardFlow\(query\)/g) || []).length, 2)
  assert.equal((source.match(/onKeyDown: keyboard\.onKeyDown/g) || []).length, 2)
  assert.equal((source.match(/inputRef: keyboard\.searchRef/g) || []).length, 2)
})

test('Issue #30: list filter tokens keep row and token actions separate', () => {
  const lists = source.slice(source.indexOf('function PrList'), source.indexOf('function DetailToolbar'))
  assert.equal((lists.match(/jsxs\('div', \{\n\s+onClick: \(\) => onOpen\(/g) || []).length, 2)
  assert.equal((lists.match(/className: 'gh-row-open/g) || []).length, 2)
  assert.ok(lists.includes("setListFilter(event, 'author', pr.author?.login)"))
  assert.ok(lists.includes("setListFilter(event, 'label', l.name)"))
})

test('List filters fetch and expose the same author/label scopes', () => {
  const lists = source.slice(source.indexOf('function PrList'), source.indexOf('function DetailToolbar'))
  assert.ok(lists.includes('reviewDecision,statusCheckRollup,labels`'))
  assert.equal((lists.match(/setListFilter\(event, 'author'/g) || []).length, 2)
  assert.equal((lists.match(/setListFilter\(event, 'label'/g) || []).length, 2)
})

test('Issue #33: checkout copy action is wired only to loaded PR details', () => {
  const toolbar = source.slice(source.indexOf('function DetailToolbar'), source.indexOf('function DetailSummary'))
  assert.ok(toolbar.includes("label: 'Copy checkout command'"))
  assert.ok(toolbar.includes('text: checkoutCommand'))
  assert.equal((source.match(/checkoutCommand: formatPrCheckoutCmd\(repo, d\.number\)/g) || []).length, 1)
})

test('Assign to a Bot is wired on loaded PR and issue details', () => {
  const toolbar = source.slice(source.indexOf('function DetailToolbar'), source.indexOf('function DetailSummary'))
  const assign = source.slice(source.indexOf('function AssignToBot'), source.indexOf('function DetailToolbar'))
  assert.ok(source.includes('function AssignToBot({ kind, repo, number })'))
  assert.ok(toolbar.includes('jsx(AssignToBot, { kind, repo, number })'))
  assert.ok(source.includes("title: d.title, kind: 'pr', checkoutCommand"))
  assert.ok(source.includes("title: d.title, kind: 'issue', onBack"))
  assert.ok(source.includes('assignToBot(host, buildAssignPlan('))
  // fix(assign): cwd of the checked-out repo flows into buildAssignPlan (#60 review)
  assert.ok(assign.includes('useSessionGit(cwd)'))
  assert.ok(assign.includes('sessionRepo: sessionGitQ.data?.repo'))
  assert.ok(assign.includes('sessionCwd: cwd'))
  assert.ok(!assign.includes('if (!ready) return null'))
  assert.ok(assign.includes('Update Hermes Desktop to assign to a bot'))
  assert.ok(assign.includes("value: ''"))
  assert.ok(assign.includes('onOpenChange: setOpen'))
  assert.equal((assign.match(/onValueChange: chooseBot/g) || []).length, 2)
  assert.ok(assign.includes('onSuccess: (result, { bot, itemKey }) =>'))
  assert.ok(assign.includes("placeholder: 'Assign to a Bot'"))
  assert.ok(assign.includes('const assignment = useValue($botAssignments)[itemKey]'))
  assert.ok(assign.includes("pluginCtx?.storage.set('botAssignments'"))
  assert.ok(assign.includes('host.openSession(assignment.sessionId'))
  assert.ok(assign.includes('children: assignment.label'))
  assert.ok(assign.includes("'aria-label': 'Change or remove bot assignment'"))
  assert.ok(!assign.includes("children: jsx(Codicon, { name: 'chevron-down' })"))
  assert.ok(assign.includes("if (bot === '__remove__')"))
  assert.ok(assign.includes("children: 'Remove link'"))
  assert.ok(assign.includes('updateBotAssignment($botAssignments.get(), itemKey)'))
  assert.ok(!assign.includes("'aria-label': 'Cancel assign'"))
  assert.ok(!assign.includes("children: run.isPending ? jsx(GlyphSpinner, {}) : 'Assign'"))
  assert.ok(!source.includes("title: 'Bot Chat'"))
})

test('Issue #58: Approve is gated on open non-self PRs and wired through approvePlan', () => {
  const approve = source.slice(source.indexOf('function ApproveControl'), source.indexOf('function IssueControl'))
  const detail = source.slice(source.indexOf('function PrDetail'), source.indexOf('function IssueDetail'))
  assert.ok(detail.includes('canApprove(prStateKey(d), userQ.data, d.user)'))
  assert.ok(detail.includes('jsx(ApproveControl, { repo, number: d.number })'))
  assert.ok(detail.includes("queryKey: [ID, 'user']"))
  assert.ok(approve.includes('pr review'))
  assert.ok(approve.includes('--approve'))
  assert.ok(approve.includes('approvePlan(repo, n)'))
  assert.ok(approve.includes('disabled: isApproving'))
  assert.ok(!approve.includes('if (!me.data)'))
})

test('Issue #59: Close/Reopen follows issueAction and shares the confirm panel', () => {
  const control = source.slice(source.indexOf('function IssueControl'), source.indexOf('function Avatar'))
  const detail = source.slice(source.indexOf('function IssueDetail'), source.indexOf('function SessionPrBanner'))
  assert.ok(detail.includes('jsx(IssueControl, { repo, number: d.number, state: d.state })'))
  assert.ok(control.includes('const action = issueAction(state)'))
  assert.ok(control.includes('issuePlan(repo, n, state)'))
  assert.ok(control.includes('GH} issue ${action}'))
  assert.ok(control.includes("children: action === 'close' ? 'Close issue' : 'Reopen issue'"))
  assert.ok(control.includes('if (!confirming)'))
  assert.ok(!control.includes("if (action === 'close' && !confirming)"))
  assert.ok(control.includes('disabled: isPending'))
})

test('Issue #54: Ask Hermes actions insert drafts via COMPOSER_INSERT only', () => {
  const toolbar = source.slice(source.indexOf('function DetailToolbar'), source.indexOf('function DetailSummary'))
  const ask = source.slice(source.indexOf('function AskHermesButton'), source.indexOf('function CommentCard'))
  const checks = source.slice(source.indexOf('function ChecksView'), source.indexOf('function FilesView'))
  const detail = source.slice(source.indexOf('function PrDetail'), source.indexOf('function IssueDetail'))
  assert.ok(source.includes('export function formatAskHermesPrompt'))
  assert.ok(toolbar.includes("label: 'Ask Hermes'"))
  assert.ok(toolbar.includes("label: 'Plan fix for this issue'"))
  assert.ok(checks.includes("label: 'Investigate failing checks'"))
  assert.ok(source.includes("label: 'Explain this review thread'"))
  assert.ok(detail.includes('askThread: item.root.html_url'))
  assert.ok(ask.includes('insertComposerText(text)'))
  assert.ok(!ask.includes('prompt.submit'))
  assert.ok(!ask.includes('session.create'))
  assert.ok(source.includes("new CustomEvent(COMPOSER_INSERT, { detail: { mode: 'block', target: 'main', text: body } })"))
  assert.ok(source.includes('function insertComposerText(text)'))
})

test('Issue #56: repo picker merges pins and reveals validated manual input', () => {
  const picker = source.slice(source.indexOf('function RepoPicker'), source.indexOf('export function labelTextColor'))
  const shell = source.slice(source.indexOf('function useGitHubShellState'), source.indexOf('function useListKeyboardFlow'))
  assert.ok(source.includes('export function mergeRepoOptions'))
  assert.ok(shell.includes('mergeRepoOptions({'))
  assert.ok(shell.includes('pinned: [gitQ.data?.repo, savedRepo, repo]'))
  assert.equal((source.match(/repos: repoOptions/g) || []).length, 2)
  assert.ok(picker.includes("'Use another repository…'") || picker.includes('Use another repository…'))
  assert.ok(picker.includes('repoOk(manual.trim())'))
  assert.ok(picker.includes('gh} repo view') || picker.includes('repo view'))
  assert.ok(picker.includes("role: 'alert'"))
  assert.ok(picker.includes('onChange(resolved)'))
})

test('Issue #64 review: a pending manual check cannot revert a newer repo', () => {
  const picker = source.slice(source.indexOf('function RepoPicker'), source.indexOf('export function labelTextColor'))
  assert.ok(picker.includes('const valueRef = useRef(value)'), 'latest-value ref missing')
  assert.ok(picker.includes('valueRef.current = value'), 'ref must sync during render, not in a passive effect')
  assert.ok(!/useEffect\(\(\) => \{ valueRef\.current = value \}\)/.test(picker), 'effect-based sync reopens the race window')
  assert.ok(picker.includes('const startValue = valueRef.current'))
  const guard = picker.indexOf('if (valueRef.current !== startValue) return')
  const apply = picker.indexOf('onChange(resolved)')
  assert.ok(guard >= 0 && guard < apply, 'stale-completion guard must run before onChange')
})

test('Issue #55: lists cap explicitly and load more on demand', () => {
  const prs = source.slice(source.indexOf('function PrList'), source.indexOf('function IssueList'))
  const issues = source.slice(source.indexOf('function IssueList'), source.indexOf('function AssignToBot'))
  const foot = source.slice(source.indexOf('function ListMoreFooter'), source.indexOf('function PrList'))
  assert.ok(foot.includes("children: 'Show more'"), 'footer: load-more missing')
  assert.ok(foot.includes("children: 'Retry'"), 'footer: retry missing')
  for (const [name, list] of [['prs', prs], ['issues', issues]]) {
    assert.ok(list.includes('const [limit, setLimit] = useState(30)'), `${name}: limit state missing`)
    assert.ok(list.includes('--limit ${limit}'), `${name}: limit not wired into the query`)
    assert.ok(list.includes('Showing latest'), `${name}: cap label missing`)
    assert.ok(list.includes('placeholderData: (prev) => prev'), `${name}: growth must hold rows`)
    assert.ok(list.includes('ListMoreFooter({ q, limit, setLimit, allItems })'), `${name}: footer not wired`)
    assert.ok(list.includes('q.isError && !allItems.length'), `${name}: refetch failure must keep rows`)
  }
})

test('PR list rows carry a state indicator open/draft/merged/closed', () => {
  const prs = source.slice(source.indexOf('function PrList'), source.indexOf('function IssueList'))
  assert.ok(prs.includes('STATE_PILL[prStateKey(pr)]'), 'list must reuse the detail pill state table')
  assert.ok(prs.includes('title: (STATE_PILL[prStateKey(pr)] || STATE_PILL.open).label'), 'indicator needs a tooltip label')
  assert.ok(prs.includes('style: { color:'), 'indicator colors come from the state table')
})

test('Repo picker rows drag to reorder and the order persists', () => {
  const picker = source.slice(source.indexOf('function RepoPicker'), source.indexOf('export function labelTextColor'))
  const shell = source.slice(source.indexOf('function useGitHubShellState'), source.indexOf('function useListKeyboardFlow'))
  const store = source.slice(source.indexOf('export function getGitHubShellStore'), source.indexOf('const githubShellStore ='))
  // DnD wiring: native drag on rows, drop commits, order lands in storage.
  assert.ok(picker.includes('draggable: true'), 'rows must be natively draggable')
  assert.ok(picker.includes('onDragStart') && picker.includes('onDrop'), 'drag handlers missing')
  assert.ok(picker.includes("effectAllowed = 'move'"), 'drag must be move-only')
  assert.ok(picker.includes("storage.set('repoOrder'"), 'drop must persist the order')
  assert.ok(picker.includes('jsxs(Popover'), 'picker must be a popover list (Select cannot host drag)')
  assert.ok(picker.includes("title: 'Drag to reorder'"), 'every row needs the movable affordance tooltip')
  // Downward drops: the bar sits above row idx, removal shifts left first.
  assert.ok(picker.includes('dragIdx < idx ? idx - 1 : idx'), 'downward drop must compensate the removal shift')
  // Keyboard parity: rows are divs, so they must act like options.
  assert.ok(picker.includes("role: 'option'") && picker.includes('tabIndex: 0'), 'rows must be focusable options')
  assert.ok(picker.includes('onKeyDown'), 'rows need Enter/Space activation')
  // Shell feeds the saved order to the merge and hydrates it once.
  assert.ok(shell.includes('ordered: repoOrder || []'), 'shell must pass the saved order')
  assert.ok(shell.includes("storage.get('repoOrder')"), 'shell must hydrate the saved order')
  assert.ok(shell.includes('if (!pluginCtx || githubShellStore.repoOrder.get()) return'), 'hydration must retry until pluginCtx exists')
  // Hot-reload backfill: the cached store predates newer atoms.
  assert.ok(store.includes('if (!store.repoOrder) store.repoOrder = atom(null)'), 'hot reload must backfill new atoms')
})

test('Session branch lives in the status bar and hides without git state', () => {
  const status = source.slice(source.indexOf('function SessionBranchStatus'), source.indexOf('function RepoLabel'))
  assert.ok(status.includes('if (!cwd || !branch || !repo) return null'), 'no footprint without git state, never a stale repo')
  assert.ok(status.includes('`${repo} · ${branch}`'), 'visible label carries repo context per #69')
  assert.ok(status.includes('max-w-[180px]'), 'status-bar item needs a width ceiling')
  assert.ok(status.includes("size: 12"), 'font-glyph icon sizes via the size prop, not layout classes')
  assert.ok(status.includes('text-(--ui-green)'), 'branch glyph matches the composer coding row')
  assert.ok(source.includes("id: 'statusbar-session-branch'"), 'registered next to the PR pill')
})

test('Session PR lives in the status bar and hides without a linked PR', () => {
  const status = source.slice(source.indexOf('function SessionPrStatus'), source.indexOf('function RepoLabel'))
  assert.ok(status.includes('if (!cwd || !pr) return null'), 'no footprint without a linked PR')
  assert.ok(status.includes('max-w-[220px]'), 'status-bar item needs a width ceiling')
  assert.ok(source.includes("area: STATUSBAR_AREAS.right"), 'right bar, next to agents/context')
  assert.ok(!source.includes('titlebar-session-pr'), 'titlebar chip is gone')
})

test('Merged transcript PRs unlink: session falls back until the next PR', () => {
  const hook = source.slice(source.indexOf('const histQ = useQuery'), source.indexOf('function StateDot'))
  assert.ok(hook.includes('resolveTranscriptPr(r?.messages'), 'histQ delegates the scan to the tested helper')
})

test('Session queries re-poll so opened/merged PRs surface without refocus', () => {
  const hook = source.slice(source.indexOf('function useSessionGit'), source.indexOf('function StateDot'))
  assert.equal((hook.match(/refetchInterval: MEDIUM_POLL_MS/g) || []).length, 3)
})
