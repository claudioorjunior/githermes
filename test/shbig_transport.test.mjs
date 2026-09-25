// Regression tests for the shBig transport (desktop/plugin.js) — the pane's
// "Could not load pull requests / atob: the string to be decoded is not
// correctly encoded" failure.
//
// Three independent defects are covered:
//   1. GNU `base64` (the gateway host) wraps at 76 columns and `rev` reverses
//      PER LINE, so staging required `tr -d '\n'` before the reverse. Verified
//      live: a real 42320-char payload staged as 557 reversed runs, which the
//      whole-string reverse in JS turned into a permutation of the base64.
//   2. The gateway redactor masks JWT-shaped runs inside base64, so a read back
//      that fails its own integrity check is re-read as hex — and hex can never
//      carry any redaction pattern, because every pattern's literal prefix holds
//      a character outside [0-9a-f].
//   3. A read that is valid base64 but the wrong bytes (a redactor swapping
//      characters in place, or a dropped 4-char group) only shows up in the
//      parser, which therefore doubles as the oracle that triggers the re-read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { host } from '@hermes/plugin-sdk'
import { decodeBig64, decodeHex, shBig } from '../desktop/plugin.js'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'plugin.js'),
  'utf-8',
)

const WRAP = 76

/** What GNU coreutils `base64` writes to the staged file. */
const gnuBase64 = (text) => Buffer.from(text, 'utf8').toString('base64')
  .match(new RegExp(`.{1,${WRAP}}`, 'g')).join('\n')

/** What `rev` does to it: reverses EACH line, leaves the line breaks. */
const revPerLine = (staged) => staged.split('\n').map(l => [...l].reverse().join('')).join('\n')

test('regression: line-wrapped base64 staged without tr -d breaks the decode', () => {
  const payload = JSON.stringify([{ number: 3, author: { id: 1 }, body: 'x'.repeat(400) }])
  const leaked = revPerLine(gnuBase64(payload)) // the pre-fix staging
  assert.ok(leaked.includes('\n'), 'GNU base64 must be the wrapping form in this test')
  assert.throws(() => decodeBig64(leaked), /atob|not correctly encoded|corrupted/,
    'the wrapped, line-reversed staging must fail rather than decode silently')
})

test('fixed staging: tr -d \\n before rev makes the whole-string reverse correct', () => {
  const payload = JSON.stringify([{ number: 3, author: { id: 1 }, body: 'x'.repeat(400) }])
  const staged = [...gnuBase64(payload).replace(/\n/g, '')].reverse().join('')
  assert.equal(JSON.parse(decodeBig64(staged))[0].author.id, 1)
})

test('decodeBig64 rejects a read that the redactor touched', () => {
  const b64 = Buffer.from('{"author":{"id":123456}}', 'utf8').toString('base64')
  const staged = [...b64].reverse().join('')
  assert.deepEqual(JSON.parse(decodeBig64(staged)), { author: { id: 123456 } })
  // a masked run leaves head/tail plus an ellipsis: '.' is not base64
  assert.throws(() => decodeBig64(staged.replace(/^(.{6}).{20}/, '$1...')), /corrupted/)
  // an odd-length read cannot be base64 at all
  assert.throws(() => decodeBig64(staged.slice(1)), /corrupted/)
})

test('decodeHex round-trips the fallback encoding, including multi-byte text', () => {
  const payload = JSON.stringify({ title: 'héllo — 日本語', n: 42 })
  const hex = Buffer.from(payload, 'utf8').toString('hex')
  assert.equal(decodeHex(hex), payload)
  assert.equal(decodeHex(hex.replace(/(.{32})/g, '$1 ')), payload, 'od output keeps spaces')
  assert.throws(() => decodeHex(hex.slice(1)), /corrupt/)
  assert.throws(() => decodeHex('zz'), /corrupt/)
})

test('hex cannot carry any redaction pattern (why the fallback is safe)', () => {
  // Literal prefixes of agent/redact.py's _PREFIX_PATTERNS, plus the JWT anchor
  // and the assignment separator the ENV/JSON/YAML passes need.
  const anchors = [
    'sk-', 'ghp_', 'github_pat_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'xapp-', 'xox', 'AIza',
    'pplx-', 'fal_', 'fc-', 'bb_live_', 'gAAAA', 'AKIA', 'sk_live_', 'sk_test_', 'rk_live_',
    'SG.', 'hf_', 'r8_', 'npm_', 'pypi-', 'dop_v1_', 'doo_v1_', 'am_', 'sk_', 'tvly-',
    'exa_', 'gsk_', 'syt_', 'retaindb_', 'hsk-', 'mem0_', 'brv_', 'xai-', 'ntn_', 'fw-',
    'fw_', 'fpk_', 'glpat-', 'GR1348941', 'pk-lf-', 'eyJ', '=',
  ]
  for (const anchor of anchors) {
    assert.ok(/[^0-9a-fA-F]/.test(anchor),
      `hex output could carry the redaction anchor ${JSON.stringify(anchor)}`)
  }
})

test('slice size stays even so a hex pair never straddles a slice', () => {
  const declared = source.match(/const BIG_SLICE = (\d+)/)
  assert.ok(declared, 'BIG_SLICE must be a named constant')
  assert.equal(Number(declared[1]) % 2, 0)
  assert.ok(Number(declared[1]) <= 4000, 'a slice must survive the gateway 4000-char capture cap')
})

test('the hex fallback is wired into shBig and no longer gated on a parser', () => {
  assert.match(source, /return finish\(await readHexFromRaw\(raw, hex\)\)/)
  assert.match(source, /od -An -v -tx1 < \$\{sq\(raw\)\}/)
  assert.match(source, /unlink \$\{sq\(raw\)\}; unlink \$\{sq\(b64\)\}; unlink \$\{sq\(hex\)\}/)
  // a failed decode must fall through, not rethrow: the re-read is the contract
  assert.doesNotMatch(source, /if \(!parse\) throw error/)
})

// ---------------------------------------------------------------------------
// Transport-level tests: shBig driven through a mocked shell.exec, so staging,
// the chunk read, the integrity check and the hex re-read all run for real
// (decoder tests alone cannot catch a broken offset or a fallback that never
// fires).
// ---------------------------------------------------------------------------

const PR_LIST = JSON.stringify(Array.from({ length: 140 }, (_, i) => ({
  number: 1000 + i,
  title: `PR title ${i} with enough text to push the payload past one slice`,
  state: 'OPEN',
  author: { id: i, login: 'semirkabir' },
  updatedAt: '2026-09-25T00:00:00Z',
  statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
  labels: [{ name: 'bug' }],
})))

/** Emulates the exact shell vocabulary shBig uses; `corrupt` may mutate a slice. */
function mockShell(payload, corrupt) {
  const files = new Map()
  const calls = []
  const unquote = (s) => s.replace(/^'|'$/g, '')

  host.request = async (_method, params) => {
    const command = params.command
    calls.push(command)
    let m = command.match(/^(.+?) > ('[^']+') && base64 < ('[^']+') \| tr -d '\\n' \| rev > ('[^']+')$/)
    if (m) {
      files.set(unquote(m[2]), payload)
      files.set(unquote(m[4]), [...Buffer.from(payload, 'utf8').toString('base64')].reverse().join(''))
      return { code: 0, stdout: '', stderr: '' }
    }
    m = command.match(/^wc -c < ('[^']+')$/)
    if (m) return { code: 0, stdout: String((files.get(unquote(m[1])) ?? '').length), stderr: '' }
    m = command.match(/^tail -c \+(\d+) ('[^']+') \| head -c (\d+)$/)
    if (m) {
      const body = files.get(unquote(m[2])) ?? ''
      const start = Number(m[1]) - 1
      const slice = body.slice(start, start + Number(m[3]))
      return { code: 0, stdout: corrupt ? corrupt(unquote(m[2]), start, slice) : slice, stderr: '' }
    }
    m = command.match(/^od -An -v -tx1 < ('[^']+') \| tr -d ' \\n' > ('[^']+')$/)
    if (m) {
      files.set(unquote(m[2]), Buffer.from(files.get(unquote(m[1])) ?? '', 'utf8').toString('hex'))
      return { code: 0, stdout: '', stderr: '' }
    }
    if (/^unlink /.test(command)) return { code: 0, stdout: '', stderr: '' }
    throw new Error(`unexpected command: ${command}`)
  }

  return calls
}

const parseJson = (text) => (text ? JSON.parse(text) : null)
const isB64 = (p) => p.endsWith('.b64')
const isHex = (p) => p.endsWith('.hex')

test('transport: a clean read parses, and staging is single-line before the reverse', async () => {
  const calls = mockShell(PR_LIST)
  const parsed = await shBig('gh pr list --json x', parseJson)
  assert.equal(parsed.length, 140)
  assert.equal(parsed[7].author.login, 'semirkabir')
  const stage = calls.find(c => c.includes('base64 <'))
  assert.match(stage, /base64 < '.+\.raw' \| tr -d '\\n' \| rev > '.+\.b64'$/,
    'staging must join the wrapped base64 before reversing it')
  assert.equal(calls.filter(c => c.startsWith('od ')).length, 0, 'no re-read when the read is clean')
})

test('transport: a redacted slice falls back to the hex re-read, with and without a parser', async () => {
  // the redactor shortens what it masks; slice 2 is enough to desync the read
  const corrupt = (path, start, slice) => (isB64(path) && start === 3800
    ? slice.replace(/^(.{6}).{20}/, '$1...')
    : slice)

  mockShell(PR_LIST, corrupt)
  assert.equal(await shBig('gh pr list --json x'), PR_LIST,
    'the payload must survive a corrupted base64 read even with no parser')

  const calls = mockShell(PR_LIST, corrupt)
  const parsed = await shBig('gh pr list --json x', parseJson)
  assert.equal(parsed.length, 140)
  assert.equal(calls.filter(c => c.startsWith('od ')).length, 1, 'exactly one hex re-read')
})

test('transport: a silently truncated read is caught by the parser oracle', async () => {
  // a dropped 4-char group stays valid base64 and decodes to the wrong bytes;
  // only the parser can tell, and it must trigger the re-read
  const corrupt = (path, start, slice) => (isB64(path) && start === 0 ? slice.slice(0, -4) : slice)
  const calls = mockShell(PR_LIST, corrupt)
  const parsed = await shBig('gh pr list --json x', parseJson)
  assert.equal(parsed.length, 140)
  assert.equal(calls.filter(c => c.startsWith('od ')).length, 1)
})

test('transport: when both reads come back corrupt the call throws instead of returning junk', async () => {
  const corrupt = (path, start, slice) => {
    if (isHex(path) && start === 0) return `z${slice.slice(1)}`
    if (isB64(path) && start === 0) return slice.slice(0, -4)
    return slice
  }
  mockShell(PR_LIST, corrupt)
  await assert.rejects(() => shBig('gh pr list --json x', parseJson), /hex re-read came back corrupt/)
})
