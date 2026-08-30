import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')

test('Issue #26: pane and page share one repository-selection shell', () => {
  assert.ok(source.includes('function useGitHubShellState()'), 'shared shell hook is missing')
  assert.equal((source.match(/const reposQ = useRepos\(\)/g) || []).length, 1)
  // One existing use lives in useSessionPr; shell selection must add only one more.
  assert.equal((source.match(/const gitQ = useSessionGit\(cwd\)/g) || []).length, 2)
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
  assert.ok(toolbar.includes("label: 'Ask Hermes about PR'"))
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
  assert.ok(picker.includes('useEffect(() => { valueRef.current = value })'))
  assert.ok(picker.includes('const startValue = valueRef.current'))
  const guard = picker.indexOf('if (valueRef.current !== startValue) return')
  const apply = picker.indexOf('onChange(resolved)')
  assert.ok(guard >= 0 && guard < apply, 'stale-completion guard must run before onChange')
})
