#!/usr/bin/env node
/**
 * Bootstrap minimal module stubs so `npm test` works on a fresh clone.
 *
 * The desktop runtime loads this plugin from a blob URL and rewrites the
 * `@hermes/plugin-sdk` / `react` specifiers to its own in-app shims. Node's
 * test runner has no such rewrite, so we give the imports somewhere to resolve
 * to. These stubs live in repo-local node_modules (gitignored) and are never
 * seen by the desktop loader — they exist purely for `node --test`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = {
  'node_modules/@hermes/plugin-sdk/package.json': {
    name: '@hermes/plugin-sdk',
    type: 'module',
    main: './index.js',
  },
  'node_modules/@hermes/plugin-sdk/index.js': `export const host = { state: { activeSessionId: {} }, request: async () => ({ code: 0, stdout: '' }) }
export const atom = (init) => ({ get: () => init, set: () => {} })
export const useValue = () => null
export const useQuery = () => ({ isLoading: false, isError: false, data: null })
export const queryClient = { invalidateQueries: () => Promise.resolve() }
export const Button = () => null
export const Input = () => null
export const Badge = () => null
export const CopyButton = () => null
export const StatusDot = () => null
export const ScrollArea = () => null
export const EmptyState = () => null
export const ErrorState = () => null
export const GlyphSpinner = () => null
export const Skeleton = () => null
export const SearchField = () => null
export const SegmentedControl = () => null
export const Separator = () => null
export const Tabs = () => null
export const TabsList = () => null
export const TabsTrigger = () => null
export const Select = () => null
export const SelectContent = () => null
export const SelectItem = () => null
export const SelectTrigger = () => null
export const SelectValue = () => null
export const Codicon = () => null
export const icons = {}
export const cn = (...args) => args.filter(Boolean).join(' ')
export const relativeTime = () => ''
export const PALETTE_AREA = 'palette'
export const TITLEBAR_AREAS = 'titlebar'
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const Tip = () => null
`,
  'node_modules/react/package.json': {
    name: 'react',
    type: 'module',
    main: './index.js',
    exports: {
      '.': './index.js',
      './jsx-runtime': './jsx-runtime.js',
    },
  },
  'node_modules/react/index.js': `export const useState = (init) => [init, () => {}]
export const useEffect = () => {}
export const useRef = (init) => ({ current: init })
export default { useState, useEffect, useRef }
`,
  'node_modules/react/jsx-runtime.js': `export const jsx = (type, props, key) => ({ type, props, key })
export const jsxs = (type, props, key) => ({ type, props, key })
export const Fragment = Symbol.for('react.fragment')
`,
}

for (const [rel, content] of Object.entries(files)) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n')
}
console.log('stubs OK')
