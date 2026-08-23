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
