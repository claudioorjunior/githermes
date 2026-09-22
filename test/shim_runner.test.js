import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdirSync, readFileSync } from 'node:fs'

const execFileP = promisify(execFile)

// The Windows runner decodes a base64 command inside bash and executes it from a
// $$-unique /tmp script. This exercises the real bash half of that path (decode,
// metachar survival, exit-code propagation, cleanup, concurrency isolation); the
// cmd.exe half is pinned by the source assertions in windows_shell.test.js.
const runner = b64 => `echo ${b64} | tr -d '\\r\\n' | base64 -d > /tmp/gt$$.sh; bash /tmp/gt$$.sh; e=$?; unlink /tmp/gt$$.sh; exit $e`
const b64Of = s => Buffer.from(s, 'utf8').toString('base64')

test('shell: runner template survives metachars, propagates exit codes and cleans up', { skip: process.platform === 'win32' }, async () => {
  const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  assert.ok(source.includes('| base64 -d > /tmp/gt$$.sh; bash /tmp/gt$$.sh'), 'plugin template drifted from the tested runner')
  const payloads = [
    `echo 'a|b&&c%d'`, // pipes, && and % must arrive verbatim
    'printf no_newline_ok',
    'echo bad && exit 7', // exit code must propagate through e=$?/exit $e
  ]
  const results = await Promise.all(payloads.map(p =>
    execFileP('/bin/bash', ['-c', runner(b64Of(p))], { encoding: 'utf8' }).catch(e => e)))
  assert.equal(results[0].stdout.trim(), 'a|b&&c%d')
  assert.equal(results[1].stdout, 'no_newline_ok')
  assert.equal(results[2].code, 7)
  const leftovers = readdirSync('/tmp').filter(f => /^gt\d+\.sh$/.test(f))
  assert.equal(leftovers.length, 0, `runner left temp scripts behind: ${leftovers.join(', ')}`)
})
