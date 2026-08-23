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
