import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Shell invocation is platform-sensitive: the same command string crosses a
// POSIX login shell on macOS/Linux and cmd.exe on Windows. Everything the
// plugin pipes through `shBig` (base64 / wc / tail / printf / unlink / /tmp)
// only exists on the POSIX side.
const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')

test('shell: every gh/hermes invocation resolves the binary per platform', () => {
  // A hardcoded `PATH=/opt/homebrew/...:$PATH gh` prefix is a VARIABLE NAMES
  // assignment under cmd.exe: gh never runs and the call "succeeds" with empty
  // stdout, which is worse than a visible failure.
  assert.ok(!source.includes("const GH = 'PATH="), 'GH must not hardcode a POSIX PATH prefix')
  assert.ok(!source.includes("const HERMES = 'PATH="), 'HERMES must not hardcode a POSIX PATH prefix')
  assert.ok(source.includes('const POSIX_SHELL ='), 'platform detection is missing')
  assert.ok(source.includes('${POSIX_SHELL ? POSIX_PATH : \'\'}gh'), 'GH must be platform-gated')
  assert.ok(source.includes('${POSIX_SHELL ? POSIX_PATH : \'\'}hermes'), 'HERMES must be platform-gated')
})

test('shell: every shell.exec goes through the shCmd wrapper', () => {
  // A raw `host.request('shell.exec', { command: cmd })` call site bypasses the
  // Windows bash hop and reintroduces the cmd.exe bug for that one query.
  const calls = source.match(/host\.request\('shell\.exec', \{ command: [^}]*\}/g) || []
  assert.ok(calls.length >= 4, 'expected the wrapper plus the two bash probes')
  for (const call of calls) {
    const ok = call.includes('shellCommand(') || call.includes("'where git'") || call.includes('if exist')
    assert.ok(ok, `unwrapped shell.exec call site: ${call}`)
  }
})

test('shell: Windows routes through Git bash, not WSL bash', () => {
  // Windows ships WSL's bash.exe in System32; invoking it would run the command
  // against a different filesystem with no `gh` on PATH. Resolve bash from the
  // installed Git instead of trusting PATH.
  assert.ok(source.includes('function resolveBash'), 'resolveBash is missing')
  assert.ok(source.includes('command: \'where git\''), 'bash must be derived from the git install')
  assert.ok(source.includes("git.replaceAll('\\\\\\\\', '/')"), 'Windows paths must be normalized before parsing')
  assert.ok(source.includes('(?:cmd|mingw64\\/bin|usr\\/bin)'), 'all Git-for-Windows install layouts must resolve')
  assert.ok(source.includes('bin\\\\bash.exe'), 'expected Git-for-Windows bash candidates')
  assert.ok(!/const BASH = '[A-Z]:/.test(source), 'bash path must not be hardcoded to a drive letter')
  // The first command must wait for the Git-for-Windows probe; it must never
  // race into bare `bash` and accidentally launch System32's WSL shim.
  assert.ok(source.includes('let bashReady = null'), 'bash resolution must be shared')
  assert.ok(source.includes('await resolveBash()'), 'shell commands must await bash resolution')
  assert.ok(source.includes("Git for Windows bash.exe was not found"), 'missing Git Bash needs a clear recovery error')
})

test('shell: bash is resolved once at registration', () => {
  const register = source.slice(source.indexOf('register(ctx) {'))
  assert.ok(register.includes('resolveBash()'), 'register must start bash resolution')
})
