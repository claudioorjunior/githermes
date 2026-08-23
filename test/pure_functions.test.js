import test from 'node:test'
import assert from 'node:assert/strict'
import {
  labelTextColor,
  parsePatch,
  prStateKey,
  ciState,
  reviewState,
  checkTone,
  summarizeChecks,
  sortChecks,
  matchesListQuery,
  groupInlineThreads,
  assembleTimeline,
  parseRemote,
  extractPrRef,
  commentToChatText,
  ago,
  mdBlocks,
  projectionBody,
  projectInlineComments,
  numericListQuery,
  isLongBody,
  lookupMatchesState,
  repoOk,
  repoApiPath,
  isNoChecksError,
  livePollInterval,
  commentBodyOk,
  loginOf,
  projectIssueComments,
  isMergeConflict,
  deriveChunkOffsets,
  readChunksConcurrently,
} from '../desktop/plugin.js'

test('Issue #13: labelTextColor chooses high-contrast text color based on luminance', () => {
  // Light backgrounds -> black text
  assert.equal(labelTextColor('#ffffff'), '#000000')
  assert.equal(labelTextColor('ffffff'), '#000000')
  assert.equal(labelTextColor('ededed'), '#000000')
  assert.equal(labelTextColor('#a2eeef'), '#000000')
  assert.equal(labelTextColor('fff'), '#000000')

  // Dark backgrounds -> white text
  assert.equal(labelTextColor('#000000'), '#ffffff')
  assert.equal(labelTextColor('000000'), '#ffffff')
  assert.equal(labelTextColor('0075ca'), '#ffffff')
  assert.equal(labelTextColor('#d73a4a'), '#ffffff')
  assert.equal(labelTextColor('000'), '#ffffff')

  // Invalid hex fallbacks to black
  assert.equal(labelTextColor(''), '#000000')
  assert.equal(labelTextColor(null), '#000000')
  assert.equal(labelTextColor('invalid'), '#000000')
})

test('Issue #12: parsePatch parses unified diff patch into structured row model', () => {
  assert.deepEqual(parsePatch(''), [])
  assert.deepEqual(parsePatch(null), [])
  assert.deepEqual(parsePatch(undefined), [])

  const samplePatch = [
    '@@ -10,4 +10,5 @@ function test() {',
    ' context line',
    '-deleted line',
    '+added line 1',
    '+added line 2',
    ' final context',
    '\\ No newline at end of file',
  ].join('\n')

  const rows = parsePatch(samplePatch)
  assert.equal(rows.length, 7)
  assert.deepEqual(rows[0], { type: 'hunk', text: '@@ -10,4 +10,5 @@ function test() {', oldLine: null, newLine: null })
  assert.deepEqual(rows[1], { type: 'ctx', text: 'context line', oldLine: 10, newLine: 10 })
  assert.deepEqual(rows[2], { type: 'del', text: 'deleted line', oldLine: 11, newLine: null })
  assert.deepEqual(rows[3], { type: 'add', text: 'added line 1', oldLine: null, newLine: 11 })
  assert.deepEqual(rows[4], { type: 'add', text: 'added line 2', oldLine: null, newLine: 12 })
  assert.deepEqual(rows[5], { type: 'ctx', text: 'final context', oldLine: 12, newLine: 13 })
  assert.deepEqual(rows[6], { type: 'meta', text: '\\ No newline at end of file', oldLine: null, newLine: null })
})

test('parseRemote extracts owner/repo from various git remote URL shapes', () => {
  assert.equal(parseRemote('https://github.com/claudioorjunior/githermes.git'), 'claudioorjunior/githermes')
  assert.equal(parseRemote('git@github.com:claudioorjunior/githermes.git'), 'claudioorjunior/githermes')
  assert.equal(parseRemote('https://github.com/owner/repo'), 'owner/repo')
  assert.equal(parseRemote(''), null)
  assert.equal(parseRemote(null), null)
})

test('extractPrRef extracts repo and PR number from PR URLs', () => {
  assert.deepEqual(
    extractPrRef('https://github.com/owner/repo/pull/42'),
    { repo: 'owner/repo', number: 42 }
  )
  assert.equal(extractPrRef('not a url'), null)
  assert.equal(extractPrRef(''), null)
})

test('prStateKey resolves open, draft, merged, closed states', () => {
  assert.equal(prStateKey({ draft: true }), 'draft')
  assert.equal(prStateKey({ isDraft: true }), 'draft')
  assert.equal(prStateKey({ merged: true }), 'merged')
  assert.equal(prStateKey({ state: 'MERGED' }), 'merged')
  assert.equal(prStateKey({ state: 'CLOSED' }), 'closed')
  assert.equal(prStateKey({ state: 'OPEN' }), 'open')
  assert.equal(prStateKey(null), 'open')
})

test('ciState resolves failing, pending, passing and none', () => {
  assert.equal(ciState([]), 'none')
  assert.equal(ciState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'passing')
  assert.equal(ciState([{ status: 'IN_PROGRESS' }]), 'pending')
  assert.equal(ciState([{ status: 'COMPLETED', conclusion: 'FAILURE' }]), 'failing')
  assert.equal(ciState([{ status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' }]), 'failing')
  assert.equal(ciState([{ status: 'COMPLETED', conclusion: 'STALE' }]), 'failing')
  assert.equal(ciState([{ status: 'WAITING' }]), 'pending')
  assert.equal(ciState([{ status: 'REQUESTED' }]), 'pending')
  assert.equal(ciState([{ status: 'COMPLETED', conclusion: 'UNKNOWN' }]), 'pending')
  assert.equal(ciState([
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'COMPLETED', conclusion: 'FAILURE' },
  ]), 'failing')
})

test('reviewState resolves review decision strings', () => {
  assert.equal(reviewState('APPROVED'), 'approved')
  assert.equal(reviewState('CHANGES_REQUESTED'), 'changes')
  assert.equal(reviewState('REVIEW_REQUIRED'), 'required')
  assert.equal(reviewState(''), 'none')
})

test('summarizeChecks titles failing first and sortChecks orders by bucket', () => {
  assert.equal(checkTone('fail'), 'bad')
  assert.equal(checkTone('pending'), 'warn')
  assert.equal(checkTone('pass'), 'good')
  assert.equal(checkTone('cancel'), 'bad')
  assert.equal(checkTone('skipping'), 'muted')
  assert.deepEqual(summarizeChecks([]).title, 'No checks')
  const rows = [
    { name: 'lint', bucket: 'pass' },
    { name: 'build', bucket: 'fail' },
    { name: 'test', bucket: 'pending' },
  ]
  const summary = summarizeChecks(rows)
  assert.equal(summary.fail, 1)
  assert.equal(summary.pending, 1)
  assert.equal(summary.pass, 1)
  assert.equal(summary.title, 'Blocked by 1 failing check')
  assert.deepEqual(sortChecks(rows).map(c => c.name), ['build', 'test', 'lint'])
  assert.equal(summarizeChecks([{ bucket: 'pending' }]).title, 'Waiting on 1 check')
  assert.equal(summarizeChecks([{ bucket: 'pass' }, { bucket: 'pass' }]).title, 'All checks passed')
  assert.equal(summarizeChecks([{ bucket: 'cancel' }]).title, '1 check canceled')
  assert.equal(summarizeChecks([{ bucket: 'skipping' }]).title, 'Skipped 1 check')
  assert.equal(summarizeChecks([{ bucket: 'skipping' }, { bucket: 'pass' }]).title, 'All checks passed')
  assert.equal(summarizeChecks([{ bucket: 'cancel' }, { bucket: 'skipping' }]).title, '1 check canceled')
})

test('matchesListQuery searches list metadata without case sensitivity', () => {
  const item = {
    number: 42,
    title: 'Fix keyboard navigation',
    author: { login: 'Octocat' },
    headRefName: 'feat/keyboard',
    labels: [{ name: 'Accessibility' }],
  }
  assert.equal(matchesListQuery(item, ''), true)
  assert.equal(matchesListQuery(item, '42'), true)
  assert.equal(matchesListQuery(item, '#42'), true)
  assert.equal(matchesListQuery(item, '# 42'), true)
  assert.equal(matchesListQuery(item, 'KEYBOARD'), true)
  assert.equal(matchesListQuery(item, 'octocat'), true)
  assert.equal(matchesListQuery(item, 'accessibility'), true)
  assert.equal(matchesListQuery(item, 'missing'), false)
})

test('groupInlineThreads groups comments into root and replies', () => {
  const comments = [
    { id: 1, body: 'root comment' },
    { id: 2, in_reply_to_id: 1, body: 'reply 1' },
    { id: 3, in_reply_to_id: 1, body: 'reply 2' },
    { id: 4, body: 'independent root' },
  ]
  const threads = groupInlineThreads(comments)
  assert.equal(threads.length, 2)
  assert.equal(threads[0].root.id, 1)
  assert.equal(threads[0].replies.length, 2)
  assert.equal(threads[1].root.id, 4)
  assert.equal(threads[1].replies.length, 0)
})

test('Issue #29: assembleTimeline merges conversation events chronologically', () => {
  const reviews = [{ id: 'review', submitted_at: '2026-08-23T12:00:00Z' }]
  const comments = [{ id: 'comment', created_at: '2026-08-23T10:00:00Z' }]
  const threads = [{ root: { id: 'thread', created_at: '2026-08-23T11:00:00Z' }, replies: [] }]

  const timeline = assembleTimeline(reviews, comments, threads)

  assert.deepEqual(timeline.map(({ kind, item }) => [kind, item.id ?? item.root.id]), [
    ['comment', 'comment'],
    ['thread', 'thread'],
    ['review', 'review'],
  ])
})

test('Issue #26: GitHub shell state survives plugin hot reloads', async () => {
  const nonce = Date.now()
  const firstModule = await import(`../desktop/plugin.js?hot-reload-a=${nonce}`)
  const secondModule = await import(`../desktop/plugin.js?hot-reload-b=${nonce}`)

  assert.equal(typeof firstModule.getGitHubShellStore, 'function')
  assert.strictEqual(firstModule.getGitHubShellStore(), secondModule.getGitHubShellStore())
})

test('projectionBody strips only the outer array brackets so projections run (regression: React #31)', () => {
  // A `[...]` array filter must keep its body for recognition; folding it to ''
  // made ghApiBigPaginatedProjected return raw items, leaking a full REST user
  // object into CommentCard and throwing React #31 ("Objects are not valid...").
  const inlineJq =
    '[.[]|{id,user:.user.login,body:(.body//""),path,line,original_line,in_reply_to_id,created_at,html_url,diff_hunk:(.diff_hunk//"")}]'
  const filesJq = '[.[]|{filename,status,additions,deletions,patch:(.patch//"")}]'
  assert.ok(projectionBody(inlineJq).includes('diff_hunk'))
  assert.ok(projectionBody(filesJq).includes('patch'))
  assert.equal(projectionBody(null), '')
  // Non-array filters stay untouched (no projection recognized -> raw fallback).
  assert.equal(projectionBody('{number,title}'), '{number,title}')
})

test('projectInlineComments guarantees user is a string, never the REST user object', () => {
  const raw = [
    { id: 1, user: { login: 'octocat', id: 1, node_id: 'U1' }, body: 'hi' },
    { id: 2, user: { id: 2, node_id: 'U2' }, body: 'deleted user' },
    { id: 3, user: null, body: 'null user' },
    { id: 4, user: 'codereview[bot]', body: 'string user' },
  ]
  const out = projectInlineComments(raw)
  for (const c of out) assert.equal(typeof c.user, 'string')
  assert.equal(out[0].user, 'octocat')
  assert.equal(out[1].user, '')
  assert.equal(out[3].user, 'codereview[bot]')
  assert.equal(projectInlineComments(undefined).length, 0)
})

test('numericListQuery detects exact-number searches for server-side lookup', () => {
  // Codex P2: `#42`/`42` must escape the 30-row client filter; text stays local.
  assert.equal(numericListQuery('#42'), 42)
  assert.equal(numericListQuery('42'), 42)
  assert.equal(numericListQuery('  #7 '), 7)
  assert.equal(numericListQuery('fix login'), null)
  assert.equal(numericListQuery('#42x'), null)
  assert.equal(numericListQuery(''), null)
  assert.equal(numericListQuery(null), null)
})

test('isLongBody collapses comments over the line/char thresholds', () => {
  assert.equal(isLongBody(Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')), false)
  assert.equal(isLongBody(Array.from({ length: 13 }, (_, i) => `line ${i}`).join('\n')), true)
  assert.equal(isLongBody('x'.repeat(800)), false)
  assert.equal(isLongBody('x'.repeat(801)), true)
  assert.equal(isLongBody(''), false)
})

test('lookupMatchesState keeps exact-number hits inside the selected filter', () => {
  // Regression: `gh pr view N` is state-agnostic; a merged PR must not leak
  // into the Open list when the user searches `#N`.
  const mergedPr = { state: 'CLOSED', merged: true }
  const closedPr = { state: 'CLOSED' }
  const openPr = { state: 'OPEN' }
  assert.equal(lookupMatchesState(mergedPr, 'open', true), false)
  assert.equal(lookupMatchesState(mergedPr, 'merged', true), true)
  assert.equal(lookupMatchesState(mergedPr, 'closed', true), true)
  assert.equal(lookupMatchesState(mergedPr, 'all', true), true)
  assert.equal(lookupMatchesState(closedPr, 'closed', true), true)
  assert.equal(lookupMatchesState(openPr, 'open', true), true)
  assert.equal(lookupMatchesState(openPr, 'closed', true), false)
  // Draft PRs belong to the open state (gh --draft is a separate filter).
  const draftPr = { state: 'OPEN', isDraft: true }
  assert.equal(lookupMatchesState(draftPr, 'open', true), true)
  assert.equal(lookupMatchesState(draftPr, 'merged', true), false)
  // Issues: state is a plain OPEN/CLOSED string.
  const closedIssue = { state: 'CLOSED' }
  assert.equal(lookupMatchesState(closedIssue, 'open', false), false)
  assert.equal(lookupMatchesState(closedIssue, 'closed', false), true)
  assert.equal(lookupMatchesState(closedIssue, 'all', false), true)
  assert.equal(lookupMatchesState(null, 'all', true), false)
})

test('commentToChatText formats quote blocks for chat composer', () => {
  const text = commentToChatText({
    login: 'octocat',
    verb: 'commented',
    timestamp: '2026-08-19T00:00:00Z',
    body: 'Line 1\nLine 2',
    permalink: 'https://github.com/owner/repo/pull/1#issuecomment-1',
  })
  assert.ok(text.includes('> **@octocat** commented · 2026-08-19T00:00:00Z:'))
  assert.ok(text.includes('> Line 1\n> Line 2'))
  assert.ok(text.includes('> https://github.com/owner/repo/pull/1#issuecomment-1'))
})

test('livePollInterval keeps open resources live and slows terminal headers', () => {
  assert.equal(livePollInterval({ state: 'OPEN' }), 10_000)
  assert.equal(livePollInterval({ state: 'CLOSED' }), false)
  assert.equal(livePollInterval({ state: 'MERGED' }), false)
  assert.equal(livePollInterval({ merged: true }), false)
  assert.equal(livePollInterval(null), 10_000)
  assert.equal(livePollInterval({ state: 'CLOSED' }, { header: true }), 60_000)
  assert.equal(livePollInterval({ state: 'OPEN' }, { header: true }), 10_000)
})

test('commentBodyOk rejects empty and oversized comments', () => {
  assert.equal(commentBodyOk('hello'), true)
  assert.equal(commentBodyOk('  '), false)
  assert.equal(commentBodyOk('x'.repeat(65_536)), true)
  assert.equal(commentBodyOk('x'.repeat(65_537)), false)
})

test('loginOf coerces REST user objects and strips @', () => {
  assert.equal(loginOf('octocat'), 'octocat')
  assert.equal(loginOf('@octocat'), 'octocat')
  assert.equal(loginOf({ login: 'octocat' }), 'octocat')
  assert.equal(loginOf(null), '')
  assert.equal(loginOf('—'), '')
})

test('projectIssueComments projects user login safely and handles missing fields', () => {
  const raw = [
    { id: 10, user: { login: 'alice' }, created_at: '2026-08-22T00:00:00Z', html_url: 'https://github.com/a/b/issues/1#issuecomment-1', body: 'looks good' },
    { id: 11, user: null, created_at: '2026-08-22T01:00:00Z', html_url: 'https://github.com/a/b/issues/1#issuecomment-2', body: null },
    { id: 12, user: 'bot', body: 'automated' },
  ]
  const res = projectIssueComments(raw)
  assert.equal(res.length, 3)
  assert.deepEqual(res[0], {
    id: 10,
    user: 'alice',
    created_at: '2026-08-22T00:00:00Z',
    html_url: 'https://github.com/a/b/issues/1#issuecomment-1',
    body: 'looks good',
  })
  assert.deepEqual(res[1], {
    id: 11,
    user: '',
    created_at: '2026-08-22T01:00:00Z',
    html_url: 'https://github.com/a/b/issues/1#issuecomment-2',
    body: '',
  })
  assert.deepEqual(res[2], {
    id: 12,
    user: 'bot',
    created_at: '',
    html_url: '',
    body: 'automated',
  })
  assert.deepEqual(projectIssueComments(undefined), [])
})

test('mdBlocks parses GFM markdown into structured AST blocks', () => {
  const md = '# Title\n\n```js\nconst x = 1\n```\n\n- item 1\n- item 2'
  const blocks = mdBlocks(md)
  assert.equal(blocks[0].t, 'h')
  assert.equal(blocks[0].n, 1)
  assert.equal(blocks[0].text, 'Title')
  assert.equal(blocks[1].t, 'pre')
  assert.equal(blocks[1].text, 'const x = 1')
})

test('Issue #24: repoOk accepts owner/repo, rejects shell-hostile free text', () => {
  // Valid
  assert.ok(repoOk('claudioorjunior/githermes'))
  assert.ok(repoOk('owner.name/repo_name'))
  assert.ok(repoOk('a-b.c_d/efg'))
  assert.ok(repoOk('owner/.'))
  assert.ok(repoOk('owner/..'))
  // Invalid shapes
  assert.ok(!repoOk('foo bar'))            // space
  assert.ok(!repoOk('owner/repo/extra'))   // extra slash
  assert.ok(!repoOk('justname'))           // no owner
  assert.ok(!repoOk(''))                   // empty
  assert.ok(!repoOk('a;b rm -rf /'))       // shell metacharacters
  assert.ok(!repoOk('$(whoami)/x'))        // command substitution
  assert.ok(!repoOk('a\nb/c'))             // newline
  assert.ok(!repoOk('../repo'))
  assert.ok(!repoOk('./repo'))
  assert.ok(!repoOk(null))
  assert.ok(!repoOk(undefined))
  assert.ok(!repoOk(42))
})

test('repoApiPath encodes dot-only repository names as path components', () => {
  assert.equal(repoApiPath('owner/repo'), 'owner/repo')
  assert.equal(repoApiPath('owner/.'), 'owner/%2E')
  assert.equal(repoApiPath('owner/..'), 'owner/%2E%2E')
})

test('Issue #23: isNoChecksError matches gh "no checks reported" exit-1 message', () => {
  // Real gh wording
  assert.ok(isNoChecksError(new Error('no checks reported on the \'main\' branch')))
  // Loose match survives gh rewording / trailing context
  assert.ok(isNoChecksError(new Error('No Checks Reported On The Branch')))
  assert.ok(isNoChecksError({ message: 'gh: no checks reported yet' }))
  // Real errors must NOT be swallowed
  assert.ok(!isNoChecksError(new Error('exit 1: unknown revision ref/main')))
  // Collision regression (pullfrog review #38): outage-style stderr containing
  // "no checks" must NOT be swallowed — only the documented phrase matches.
  assert.ok(!isNoChecksError(new Error('API request failed: no checks service unavailable')))
  assert.ok(!isNoChecksError(null))
  assert.ok(!isNoChecksError(undefined))
})

test('Issue #32: isMergeConflict flags only the known-conflict mergeable state', () => {
  // GitHub normalized REST value for conflicting histories
  assert.ok(isMergeConflict('dirty'))
  // Unknown / computing / clean and any future state keep today's behavior
  assert.ok(!isMergeConflict('unknown'))
  assert.ok(!isMergeConflict('clean'))
  assert.ok(!isMergeConflict('blocked'))
  assert.ok(!isMergeConflict('unstable'))
  assert.ok(!isMergeConflict('behind'))
  assert.ok(!isMergeConflict(null))
  assert.ok(!isMergeConflict(undefined))
})

test('Issue #28: deriveChunkOffsets covers exact chunk boundaries', () => {
  assert.deepEqual(deriveChunkOffsets(0), [])
  assert.deepEqual(deriveChunkOffsets(1), [1])
  assert.deepEqual(deriveChunkOffsets(3800), [1])
  assert.deepEqual(deriveChunkOffsets(3801), [1, 3801])
  assert.deepEqual(deriveChunkOffsets(7600), [1, 3801])
})

test('Issue #28: readChunksConcurrently bounds overlapping reads and preserves byte order', async () => {
  const payload = `${'line 😀 with utf8\n'.repeat(80)}tail`
  const compact = Buffer.from(payload, 'utf8').toString('base64')
  const wrapped = compact.replace(/.{76}/g, '$&\n')
  const chunkSize = 97
  const chunkCount = Math.ceil(wrapped.length / chunkSize)
  let active = 0
  let peak = 0

  const output = await readChunksConcurrently(
    Buffer.byteLength(wrapped),
    async offset => {
      active += 1
      peak = Math.max(peak, active)
      const index = (offset - 1) / chunkSize
      await new Promise(resolve => setTimeout(resolve, 12 - (index % 4) * 3))
      const chunk = wrapped.slice(offset - 1, offset - 1 + chunkSize).trim()
      active -= 1
      return chunk
    },
    { chunkSize },
  )

  assert.ok(chunkCount >= 8)
  assert.ok(peak > 1)
  assert.ok(peak <= 4)
  assert.equal(Buffer.from(output.replace(/\s+/g, ''), 'base64').toString('utf8'), payload)
})
