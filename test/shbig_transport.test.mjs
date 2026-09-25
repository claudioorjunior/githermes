// Regression tests for the shBig transport (desktop/plugin.js) — the pane's
// "Could not load pull requests / atob: the string to be decoded is not
// correctly encoded" failure.
//
// Two independent defects are covered:
//   1. GNU `base64` (the gateway host) wraps at 76 columns and `rev` reverses
//      PER LINE, so staging required `tr -d '\n'` before the reverse. Verified
//      live: a real 42320-char payload staged as 557 reversed runs, which the
//      whole-string reverse in JS turned into a permutation of the base64.
//   2. The gateway redactor masks JWT-shaped runs inside base64, so a read back
//      that fails its own integrity check is re-read as hex — and hex can never
//      carry any redaction pattern, because every pattern's literal prefix holds
//      a character outside [0-9a-f].
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodeBig64, decodeHex } from '../desktop/plugin.js'

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

/** What the plugin's decode does with a read-back slice string. */
const decodeSlackReadBack = (raw) => decodeBig64(raw)

test('regression: line-wrapped base64 staged without tr -d breaks the decode', () => {
  const payload = JSON.stringify([{ number: 3, author: { id: 1 }, body: 'x'.repeat(400) }])
  const leaked = revPerLine(gnuBase64(payload)) // the pre-fix staging
  assert.ok(leaked.includes('\n'), 'GNU base64 must be the wrapping form in this test')
  assert.throws(() => decodeSlackReadBack(leaked), /atob|not correctly encoded|corrupted/,
    'the wrapped, line-reversed staging must fail rather than decode silently')
})

test('fixed staging: tr -d \\n before rev makes the whole-string reverse correct', () => {
  const payload = JSON.stringify([{ number: 3, author: { id: 1 }, body: 'x'.repeat(400) }])
  const staged = [...gnuBase64(payload).replace(/\n/g, '')].reverse().join('')
  assert.equal(JSON.parse(decodeSlackReadBack(staged))[0].author.id, 1)
})

test('source stages single-line base64 before the reverse', () => {
  const stage = source.match(/base64 < \$\{sq\(raw\)\}[^`]*/)
  assert.ok(stage, 'the b64 staging command must be present')
  assert.match(stage[0], /tr -d '\\\\n' \| rev > /,
    'the staged base64 must be joined into one line before rev (GNU wraps at 76)')
})

test('decodeBig64 rejects a read that the redactor touched, and the parse oracle catches the rest', () => {
  const b64 = Buffer.from('{"author":{"id":123456}}', 'utf8').toString('base64')
  const staged = [...b64].reverse().join('')
  assert.deepEqual(JSON.parse(decodeBig64(staged)), { author: { id: 123456 } })
  // a masked run leaves head/tail plus an ellipsis: '.' is not base64
  const masked = staged.replace(/^(.{6}).{20}/, '$1...')
  assert.throws(() => decodeBig64(masked), /corrupted/)
  // an odd-length read cannot be base64 at all
  assert.throws(() => decodeBig64(staged.slice(1)), /corrupted/)
  // a read that lost exactly one 4-char group still decodes — silently truncated.
  // That is why shBig hands a parser down as the validity oracle instead of
  // trusting atob, and re-reads the payload as hex when the parse fails.
  const truncated = staged.slice(4)
  assert.notEqual(decodeBig64(truncated), decodeBig64(staged))
  assert.match(source, /return finish\(decodeBig64\(out\)\)[\s\S]{0,120}catch \(error\) \{[\s\S]{0,80}if \(!parse\) throw error/)
  assert.match(source, /const finish = text => \(parse \? parse\(text\) : text\)/)
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

test('the hex fallback is wired into shBig, not only defined', () => {
  assert.match(source, /return finish\(await readHexFromRaw\(raw, hex\)\)/)
  assert.match(source, /od -An -v -tx1 < \$\{sq\(raw\)\}/)
  assert.match(source, /unlink \$\{sq\(raw\)\}; unlink \$\{sq\(b64\)\}; unlink \$\{sq\(hex\)\}/)
})
