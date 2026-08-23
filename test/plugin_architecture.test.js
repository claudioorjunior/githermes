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
  assert.ok(detail.includes('[convQ.data?.reviews, convQ.data?.comments, convQ.data?.threads]'))
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
