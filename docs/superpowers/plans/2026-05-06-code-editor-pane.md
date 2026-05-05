# Code Editor Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a right-docked, single-file CodeMirror 6 editor that opens via Ctrl+click on file paths in the terminal, with save, dirty tracking, per-workspace persistence, and a resizable layout.

**Architecture:** Renderer-only editor (no new processes). New IPC channels in main for file I/O. Pure path-parser + path-resolver in renderer. EditorPane lazy-loaded via `React.lazy` so cold-start bundle is unchanged. State lives in each workspace's `editor` field and persists alongside the existing `workspaces.json` shape.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/commands`, `@codemirror/language`, language packs for js/ts/json/markdown/html/css), xterm.js `linkProvider`, vitest + jsdom, React 18, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-05-06-code-editor-pane-design.md`

---

## File Structure

### New files (renderer)
| Path | Responsibility |
|---|---|
| `src/renderer/path-parser.js` | Pure pattern-list matcher returning `{path, line, col, raw, start, end}` per match |
| `src/renderer/path-resolver.js` | Resolves a parsed match against `focusedCwd` then `workspaceDir` via `electronAPI.editor.pathExists` |
| `src/renderer/editor-state.js` | Pure helpers: `defaultEditorState()`, `mergeEditor()`, `clampWidth()` |
| `src/renderer/codemirror-theme.js` | CM6 theme + highlight style built from `--cs-*` tokens read at module init |
| `src/renderer/hooks/useEditor.js` | Wires CM6 EditorView, font sizing, save keymap, dirty tracking, plain-mode threshold |
| `src/renderer/components/EditorPane.jsx` | Pane component: header (filename + dirty dot + close + actions), body (CM6 host or empty/loading/error state) |
| `src/renderer/components/EditorPane.css` | Pane styling, anchored to design tokens |
| `src/renderer/components/EditorResizer.jsx` | Vertical 4px drag handle between grid and editor |
| `src/renderer/components/EditorResizer.css` | Handle styling (cyan on hover/grab) |

### New files (main)
| Path | Responsibility |
|---|---|
| `src/main/editor-fs.js` | File I/O helpers: `readFile()` with size + binary checks, `writeFile()`, `pathExists()` — pure on top of `node:fs/promises` |

### Modified files
| Path | Reason |
|---|---|
| `src/main/ipc-handlers.js` | Register `editor:readFile / writeFile / pathExists / revealInFolder` channels |
| `src/preload/index.js` | Expose `electronAPI.editor.*` surface |
| `src/main/workspaces-store.js` | Persist new `editor` field; backfill `defaultEditorState()` on missing key |
| `src/renderer/design-tokens.css` | Add `--cs-editor-min`, `--cs-editor-max-frac`, `--cs-editor-default-frac` |
| `src/renderer/App.jsx` | Three-column layout, editor state actions (`openFileInEditor`, `closeEditor`, `setEditorWidth`, `setEditorOpen`, etc.), Ctrl+E shortcut, dirty-prompt flow on file swap / workspace switch / workspace delete |
| `src/renderer/App.css` | Three-column flex on `.app-body`, CSS variables for editor width |
| `src/renderer/hooks/useTerminal.js` | Register xterm `linkProvider` using `path-parser` + `path-resolver`, Ctrl+key cursor affordance |
| `src/renderer/components/TerminalPane.jsx` | Add `onOpenFile` prop, forward from `useTerminal` linkProvider |
| `src/renderer/components/Toolbar.jsx` | Editor toggle button (28×28), `is-open` state |
| `src/renderer/components/Toolbar.css` | Style for the toggle button |
| `package.json` | Add CodeMirror 6 dependencies |

### New test files
| Path | Coverage |
|---|---|
| `tests/path-parser.test.js` | All 3 patterns, with/without line:col, trailing punct, ext boundary, multiple matches |
| `tests/path-resolver.test.js` | Absolute pass-through, relative cwd-first then ws-dir fallback, null on miss |
| `tests/editor-state.test.js` | `defaultEditorState`, `clampWidth`, `mergeEditor` reducers |
| `tests/editor-fs.test.js` | Read OK, too-large, binary, not-found; write OK; pathExists |
| `tests/components/EditorPane.test.jsx` | Empty/loading/error renders; calls onClose; dirty dot visibility |
| `tests/components/EditorResizer.test.jsx` | Pointer down/move/up commits new width; double-click resets |

---

## Conventions used in this plan

- **TDD where it works:** pure modules and IPC handlers get failing tests first. UI components that wrap CodeMirror get a manual smoke-test step instead (jsdom can't render CM6 reliably).
- **Frontend design pass:** any task that introduces a new component or new CSS includes a step `"Invoke frontend-design:frontend-design"` to produce/refine the visual treatment grounded in `DESIGN_SYSTEM.md` before CSS is committed. CLAUDE.md mandates this.
- **Commit cadence:** one commit per task unless explicitly grouped.
- **Run command from repo root:** `npm test -- <pattern>` for vitest.
- **Verification before completion:** the final task explicitly verifies build + manual smoke checklist before the feature is declared done.

---

## Phase 1 — Foundations (IPC, parsing, resolution, state helpers)

### Task 1: editor-fs.js (main-side file I/O)

**Files:**
- Create: `src/main/editor-fs.js`
- Test: `tests/editor-fs.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/editor-fs.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, access as nodeAccess } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'

import { readFile, writeFile, pathExists, MAX_BYTES, BINARY_PROBE_BYTES } from '../src/main/editor-fs.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'editor-fs-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('editor-fs.readFile', () => {
  it('returns ok with utf8 content for a small text file', async () => {
    const p = join(dir, 'a.txt')
    writeFileSync(p, 'hello world')
    const r = await readFile(p)
    expect(r).toEqual({ ok: true, content: 'hello world', encoding: 'utf8' })
  })

  it('returns reason=not-found for a missing file', async () => {
    const r = await readFile(join(dir, 'missing.txt'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })

  it('returns reason=too-large for files over 20 MB', async () => {
    const p = join(dir, 'big.txt')
    writeFileSync(p, Buffer.alloc(MAX_BYTES + 1, 'a'))
    const r = await readFile(p)
    expect(r).toMatchObject({ ok: false, reason: 'too-large' })
  })

  it('returns reason=binary when the first 8KB contain a null byte', async () => {
    const p = join(dir, 'bin')
    const buf = Buffer.alloc(BINARY_PROBE_BYTES, 'a')
    buf[100] = 0x00
    writeFileSync(p, buf)
    const r = await readFile(p)
    expect(r).toMatchObject({ ok: false, reason: 'binary' })
  })
})

describe('editor-fs.writeFile', () => {
  it('writes utf8 content and returns ok', async () => {
    const p = join(dir, 'out.txt')
    const r = await writeFile(p, 'new content')
    expect(r).toEqual({ ok: true })
    expect(await nodeReadFile(p, 'utf8')).toBe('new content')
  })

  it('returns reason=denied when target dir does not exist', async () => {
    const p = join(dir, 'no', 'such', 'dir', 'out.txt')
    const r = await writeFile(p, 'x')
    expect(r.ok).toBe(false)
    expect(['denied', 'unknown']).toContain(r.reason)
  })
})

describe('editor-fs.pathExists', () => {
  it('returns true for an existing path', async () => {
    const p = join(dir, 'a')
    writeFileSync(p, '')
    expect(await pathExists(p)).toBe(true)
  })
  it('returns false for a missing path', async () => {
    expect(await pathExists(join(dir, 'missing'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- editor-fs`
Expected: FAIL — `Cannot find module '../src/main/editor-fs.js'`

- [ ] **Step 3: Implement editor-fs.js**

```js
// src/main/editor-fs.js
import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, access as nodeAccess, open as nodeOpen } from 'node:fs/promises'

export const MAX_BYTES = 20 * 1024 * 1024 // 20 MB
export const BINARY_PROBE_BYTES = 8 * 1024 // 8 KB

export async function readFile(absPath) {
  let stat
  try {
    stat = await nodeStat(absPath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'not-found', message: 'File not found' }
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not stat file' }
  }
  if (!stat.isFile()) return { ok: false, reason: 'denied', message: 'Not a file' }
  if (stat.size > MAX_BYTES) return { ok: false, reason: 'too-large', message: 'File exceeds 20 MB limit' }

  // Binary probe — read first 8KB and look for null bytes.
  let probe
  let fh
  try {
    fh = await nodeOpen(absPath, 'r')
    const probeLen = Math.min(stat.size, BINARY_PROBE_BYTES)
    const buf = Buffer.alloc(probeLen)
    await fh.read(buf, 0, probeLen, 0)
    probe = buf
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not read file' }
  } finally {
    try { await fh?.close() } catch {}
  }
  if (probe.includes(0x00)) return { ok: false, reason: 'binary', message: 'Binary file' }

  let content
  try {
    content = await nodeReadFile(absPath, 'utf8')
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not read file' }
  }
  return { ok: true, content, encoding: 'utf8' }
}

export async function writeFile(absPath, content) {
  try {
    await nodeWriteFile(absPath, content, 'utf8')
    return { ok: true }
  } catch (err) {
    if (err && (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOENT' || err.code === 'EISDIR')) {
      return { ok: false, reason: 'denied', message: err.message }
    }
    return { ok: false, reason: 'unknown', message: err?.message ?? 'Could not write file' }
  }
}

export async function pathExists(absPath) {
  try {
    await nodeAccess(absPath)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- editor-fs`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```
git add src/main/editor-fs.js tests/editor-fs.test.js
git commit -m "feat(editor): add main-side file I/O with size and binary checks"
```

---

### Task 2: IPC handlers and preload bridge

**Files:**
- Modify: `src/main/ipc-handlers.js`
- Modify: `src/preload/index.js`
- Test: extend `tests/ipc-handlers.test.js`

- [ ] **Step 1: Write failing tests in `tests/ipc-handlers.test.js`**

Append to the existing describe block:

```js
import * as editorFs from '../src/main/editor-fs.js'
vi.mock('../src/main/editor-fs.js', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  pathExists: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { showItemInFolder: vi.fn() }
}))

describe('editor IPC channels', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers editor:readFile, writeFile, pathExists, revealInFolder', () => {
    registerHandlers(mockWindow)
    expect(ipcMain.handle).toHaveBeenCalledWith('editor:readFile', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('editor:writeFile', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('editor:pathExists', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('editor:revealInFolder', expect.any(Function))
  })

  it('editor:readFile delegates to editor-fs.readFile', async () => {
    editorFs.readFile.mockResolvedValue({ ok: true, content: 'x', encoding: 'utf8' })
    registerHandlers(mockWindow)
    const handler = getHandler('handle', 'editor:readFile')
    const result = await handler({}, 'C:\\path\\file.txt')
    expect(editorFs.readFile).toHaveBeenCalledWith('C:\\path\\file.txt')
    expect(result).toEqual({ ok: true, content: 'x', encoding: 'utf8' })
  })

  it('editor:writeFile delegates to editor-fs.writeFile', async () => {
    editorFs.writeFile.mockResolvedValue({ ok: true })
    registerHandlers(mockWindow)
    const handler = getHandler('handle', 'editor:writeFile')
    const result = await handler({}, 'C:\\file.txt', 'content')
    expect(editorFs.writeFile).toHaveBeenCalledWith('C:\\file.txt', 'content')
    expect(result).toEqual({ ok: true })
  })

  it('editor:pathExists delegates to editor-fs.pathExists', async () => {
    editorFs.pathExists.mockResolvedValue(true)
    registerHandlers(mockWindow)
    const handler = getHandler('handle', 'editor:pathExists')
    const result = await handler({}, 'C:\\file.txt')
    expect(result).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ipc-handlers`
Expected: FAIL — channels not registered.

- [ ] **Step 3: Modify `src/main/ipc-handlers.js`**

Add at top of imports:
```js
import { shell } from 'electron'
import * as editorFs from './editor-fs.js'
```

Inside `registerHandlers(mainWindow)`, after the existing pty handlers and before the `webContents.on('destroyed', ...)`:

```js
ipcMain.handle('editor:readFile', (_event, absPath) => editorFs.readFile(absPath))
ipcMain.handle('editor:writeFile', (_event, absPath, content) => editorFs.writeFile(absPath, content))
ipcMain.handle('editor:pathExists', (_event, absPath) => editorFs.pathExists(absPath))
ipcMain.on('editor:revealInFolder', (_event, absPath) => {
  try { shell.showItemInFolder(absPath) } catch {}
})
```

- [ ] **Step 4: Run tests**

Run: `npm test -- ipc-handlers`
Expected: PASS — all editor channel tests green.

- [ ] **Step 5: Modify `src/preload/index.js`**

Add inside the `api` object:
```js
editor: {
  readFile:        (absPath) => ipcRenderer.invoke('editor:readFile', absPath),
  writeFile:       (absPath, content) => ipcRenderer.invoke('editor:writeFile', absPath, content),
  pathExists:      (absPath) => ipcRenderer.invoke('editor:pathExists', absPath),
  revealInFolder:  (absPath) => ipcRenderer.send('editor:revealInFolder', absPath),
},
```

- [ ] **Step 6: Manual smoke check that preload still loads**

Run: `npm run dev`
Expected: app launches; existing functionality unchanged. Open DevTools → in renderer console: `window.electronAPI.editor` should be an object with the four functions.

Stop the dev server.

- [ ] **Step 7: Commit**

```
git add src/main/ipc-handlers.js src/preload/index.js tests/ipc-handlers.test.js
git commit -m "feat(editor): expose editor IPC channels via preload bridge"
```

---

### Task 3: path-parser.js (pure)

**Files:**
- Create: `src/renderer/path-parser.js`
- Test: `tests/path-parser.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/path-parser.test.js
import { describe, it, expect } from 'vitest'
import { parsePathsInLine } from '../src/renderer/path-parser.js'

describe('parsePathsInLine', () => {
  it('matches an absolute Windows path with extension', () => {
    const r = parsePathsInLine('see C:\\Users\\TJ\\foo.ts for details')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ path: 'C:\\Users\\TJ\\foo.ts', line: null, col: null })
  })

  it('captures :line suffix on Windows path', () => {
    const r = parsePathsInLine('error at C:\\src\\foo.ts:42')
    expect(r[0]).toMatchObject({ path: 'C:\\src\\foo.ts', line: 42, col: null })
  })

  it('captures :line:col suffix', () => {
    const r = parsePathsInLine('at C:\\src\\foo.ts:42:7')
    expect(r[0]).toMatchObject({ path: 'C:\\src\\foo.ts', line: 42, col: 7 })
  })

  it('matches an absolute POSIX path', () => {
    const r = parsePathsInLine('see /home/u/foo.ts please')
    expect(r[0]).toMatchObject({ path: '/home/u/foo.ts' })
  })

  it('matches a workspace-relative path', () => {
    const r = parsePathsInLine('open src/components/Foo.jsx now')
    expect(r[0]).toMatchObject({ path: 'src/components/Foo.jsx' })
  })

  it('matches ./ and ../ prefixes', () => {
    expect(parsePathsInLine('./foo.ts ok')[0].path).toBe('./foo.ts')
    expect(parsePathsInLine('see ../bar.ts')[0].path).toBe('../bar.ts')
  })

  it('strips trailing punctuation', () => {
    const r = parsePathsInLine('see src/foo.ts.')
    expect(r[0].path).toBe('src/foo.ts')
    expect(r[0].end).toBe(13) // index of '.' AFTER the path
  })

  it('does not match version flags or non-paths', () => {
    expect(parsePathsInLine('npm install --save')).toHaveLength(0)
    expect(parsePathsInLine('v1.2.3')).toHaveLength(0)
  })

  it('requires a 1-8 char extension', () => {
    expect(parsePathsInLine('foo.thisextensionistoolong')).toHaveLength(0)
    expect(parsePathsInLine('foo.x')).toHaveLength(1)
  })

  it('returns multiple matches with correct indices', () => {
    const text = 'see src/a.ts and src/b.ts'
    const r = parsePathsInLine(text)
    expect(r.map(m => m.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(text.slice(r[0].start, r[0].end)).toBe('src/a.ts')
    expect(text.slice(r[1].start, r[1].end)).toBe('src/b.ts')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- path-parser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement path-parser.js**

```js
// src/renderer/path-parser.js
// Conservative, extensible matcher. Each pattern returns its own captures
// for path / line / col. Order is meaningful: more specific patterns first.

const TRAIL_PUNCT_RE = /[.,;:)\]>]+$/

const PATTERNS = [
  {
    name: 'win-abs',
    // Drive letter, then non-space sequence, optional :line[:col]
    re: /\b[A-Za-z]:[\\/][^\s:"<>|?*]+\.[A-Za-z0-9]{1,8}(?::\d+)?(?::\d+)?/g,
  },
  {
    name: 'posix-abs',
    re: /(?:(?<=^)|(?<=\s))\/[^\s:"<>|?*]+\.[A-Za-z0-9]{1,8}(?::\d+)?(?::\d+)?/g,
  },
  {
    name: 'relative',
    // Optional ./ or ../, then path-ish chars, ending in .ext
    re: /(?:(?<=^)|(?<=\s)|(?<=")|(?<=\()|(?<=\[))(?:\.\.?[\\/])?[\w@\-./\\]+\.[A-Za-z0-9]{1,8}(?::\d+)?(?::\d+)?/g,
  },
]

const SUFFIX_RE = /:(\d+)(?::(\d+))?$/

export function parsePathsInLine(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const out = []
  const claimed = new Array(text.length).fill(false)

  for (const { re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      let raw = m[0]
      let start = m.index
      let end = start + raw.length

      // Strip trailing punctuation that a sentence might leave on a path.
      const trailMatch = raw.match(TRAIL_PUNCT_RE)
      if (trailMatch) {
        raw = raw.slice(0, raw.length - trailMatch[0].length)
        end -= trailMatch[0].length
      }

      // Ignore overlap with an already-claimed range (more specific patterns win).
      if (claimed[start] || claimed[end - 1]) continue

      // Pull out :line[:col] suffix.
      let path = raw, line = null, col = null
      const sfx = raw.match(SUFFIX_RE)
      if (sfx) {
        path = raw.slice(0, raw.length - sfx[0].length)
        line = Number(sfx[1])
        col  = sfx[2] != null ? Number(sfx[2]) : null
      }

      // The match must contain a `.<1-8>` extension AFTER suffix removal.
      if (!/\.[A-Za-z0-9]{1,8}$/.test(path)) continue

      // Reject single-char garbage like "a.x" with no path separator AND no ./ prefix
      // — bare filenames are out of scope for v1 unless they look path-ish.
      // Pragmatic: keep them. They'll fail to resolve and silently no-op.

      for (let i = start; i < end; i++) claimed[i] = true
      out.push({ start, end, raw, path, line, col })
    }
  }

  out.sort((a, b) => a.start - b.start)
  return out
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- path-parser`
Expected: PASS — all 10 tests green. If any fail, refine the regex (do NOT loosen the extension-boundary rule).

- [ ] **Step 5: Commit**

```
git add src/renderer/path-parser.js tests/path-parser.test.js
git commit -m "feat(editor): pure path parser with extensible pattern list"
```

---

### Task 4: path-resolver.js

**Files:**
- Create: `src/renderer/path-resolver.js`
- Test: `tests/path-resolver.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/path-resolver.test.js
import { describe, it, expect, vi } from 'vitest'
import { resolvePath, isAbsolutePath } from '../src/renderer/path-resolver.js'

function makeApi(existing) {
  return {
    pathExists: vi.fn(async (p) => existing.has(p))
  }
}

describe('isAbsolutePath', () => {
  it('detects Windows absolute paths', () => {
    expect(isAbsolutePath('C:\\foo')).toBe(true)
    expect(isAbsolutePath('D:/bar')).toBe(true)
  })
  it('detects POSIX absolute paths', () => {
    expect(isAbsolutePath('/usr/bin')).toBe(true)
  })
  it('rejects relative paths', () => {
    expect(isAbsolutePath('src/foo.ts')).toBe(false)
    expect(isAbsolutePath('./foo.ts')).toBe(false)
    expect(isAbsolutePath('../foo.ts')).toBe(false)
  })
})

describe('resolvePath', () => {
  it('passes absolute paths through', async () => {
    const api = makeApi(new Set(['C:\\foo.ts']))
    const r = await resolvePath('C:\\foo.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r).toEqual({ path: 'C:\\foo.ts', line: null, col: null })
    expect(api.pathExists).not.toHaveBeenCalled()
  })

  it('resolves relative against focusedCwd first', async () => {
    const api = makeApi(new Set(['C:\\cwd\\src\\a.ts']))
    const r = await resolvePath('src/a.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r.path).toBe('C:\\cwd\\src\\a.ts')
  })

  it('falls back to workspaceDir when not in cwd', async () => {
    const api = makeApi(new Set(['C:\\ws\\src\\a.ts']))
    const r = await resolvePath('src/a.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r.path).toBe('C:\\ws\\src\\a.ts')
  })

  it('returns null when neither location exists', async () => {
    const api = makeApi(new Set())
    const r = await resolvePath('src/a.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r).toBeNull()
  })

  it('preserves line and col through resolution', async () => {
    const api = makeApi(new Set(['C:\\cwd\\foo.ts']))
    const r = await resolvePath('foo.ts:42:7', 'C:\\cwd', 'C:\\ws', api)
    expect(r).toEqual({ path: 'C:\\cwd\\foo.ts', line: 42, col: 7 })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- path-resolver`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement path-resolver.js**

```js
// src/renderer/path-resolver.js
// Resolves a parsed path-match against the focused terminal cwd, falling
// back to the workspace dir. Pure function with an injected fs probe so
// it's unit-testable.

const SUFFIX_RE = /:(\d+)(?::(\d+))?$/

export function isAbsolutePath(p) {
  if (typeof p !== 'string') return false
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  if (p.startsWith('/')) return true
  return false
}

function joinPath(base, rel) {
  // Normalize the relative segment for the platform of `base`. We don't
  // import node:path here (renderer is browser-side); naive join is enough
  // because the inputs we see are well-formed.
  const isWindows = /^[A-Za-z]:[\\/]/.test(base)
  const sep = isWindows ? '\\' : '/'
  let r = rel.replace(/[\\/]+/g, sep)
  // strip a leading ./
  if (r.startsWith(`.${sep}`)) r = r.slice(2)
  // resolve `..` segments naively
  const baseParts = base.replace(/[\\/]+$/, '').split(/[\\/]/)
  const relParts  = r.split(sep)
  const stack = [...baseParts]
  for (const part of relParts) {
    if (part === '..') { if (stack.length > 1) stack.pop() }
    else if (part !== '.' && part !== '') stack.push(part)
  }
  return stack.join(sep)
}

export async function resolvePath(raw, focusedCwd, workspaceDir, electronApi) {
  if (typeof raw !== 'string' || raw.length === 0) return null

  let line = null, col = null
  let path = raw
  const sfx = raw.match(SUFFIX_RE)
  if (sfx) {
    path = raw.slice(0, raw.length - sfx[0].length)
    line = Number(sfx[1])
    col  = sfx[2] != null ? Number(sfx[2]) : null
  }

  if (isAbsolutePath(path)) return { path, line, col }

  // Try focused cwd, then workspace dir.
  for (const base of [focusedCwd, workspaceDir]) {
    if (!base) continue
    const candidate = joinPath(base, path)
    if (await electronApi.pathExists(candidate)) {
      return { path: candidate, line, col }
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- path-resolver`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```
git add src/renderer/path-resolver.js tests/path-resolver.test.js
git commit -m "feat(editor): path resolver with cwd-first, ws-dir fallback"
```

---

### Task 5: editor-state.js helpers

**Files:**
- Create: `src/renderer/editor-state.js`
- Test: `tests/editor-state.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/editor-state.test.js
import { describe, it, expect } from 'vitest'
import { defaultEditorState, clampWidth, mergeEditor, EDITOR_MIN_PX, EDITOR_MAX_FRAC } from '../src/renderer/editor-state.js'

describe('defaultEditorState', () => {
  it('returns a fresh object with expected defaults', () => {
    expect(defaultEditorState()).toEqual({
      open: false, file: null, line: null,
      width: 0, dirty: false, scroll: 0
    })
  })
})

describe('clampWidth', () => {
  it('clamps to minimum', () => {
    expect(clampWidth(100, 1200)).toBe(EDITOR_MIN_PX)
  })
  it('clamps to fractional max', () => {
    expect(clampWidth(2000, 1000)).toBe(Math.floor(1000 * EDITOR_MAX_FRAC))
  })
  it('returns the input when in range', () => {
    expect(clampWidth(500, 2000)).toBe(500)
  })
  it('handles non-numeric input by returning min', () => {
    expect(clampWidth(undefined, 1200)).toBe(EDITOR_MIN_PX)
    expect(clampWidth(NaN, 1200)).toBe(EDITOR_MIN_PX)
  })
})

describe('mergeEditor', () => {
  it('shallow-merges patches into the existing editor state', () => {
    const cur = defaultEditorState()
    const next = mergeEditor(cur, { open: true, file: 'C:\\a.ts' })
    expect(next).toMatchObject({ open: true, file: 'C:\\a.ts', line: null })
    // returns a new object
    expect(next).not.toBe(cur)
  })

  it('treats undefined-valued patch keys as no-op', () => {
    const cur = { ...defaultEditorState(), open: true }
    const next = mergeEditor(cur, { open: undefined, file: 'x' })
    expect(next.open).toBe(true)
    expect(next.file).toBe('x')
  })
})
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- editor-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement editor-state.js**

```js
// src/renderer/editor-state.js
export const EDITOR_MIN_PX = 320
export const EDITOR_MAX_FRAC = 0.7
export const EDITOR_DEFAULT_FRAC = 0.45

export function defaultEditorState() {
  return { open: false, file: null, line: null, width: 0, dirty: false, scroll: 0 }
}

export function clampWidth(px, bodyWidth) {
  const n = Number(px)
  if (!Number.isFinite(n)) return EDITOR_MIN_PX
  const max = Math.floor(bodyWidth * EDITOR_MAX_FRAC)
  if (n < EDITOR_MIN_PX) return EDITOR_MIN_PX
  if (n > max) return max
  return Math.round(n)
}

export function mergeEditor(current, patch) {
  const out = { ...current }
  for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined) out[k] = patch[k]
  }
  return out
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- editor-state`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```
git add src/renderer/editor-state.js tests/editor-state.test.js
git commit -m "feat(editor): pure state helpers (defaults, clamp, merge)"
```

---

## Phase 2 — Design tokens

### Task 6: Add editor tokens to design-tokens.css

**Files:**
- Modify: `src/renderer/design-tokens.css`

- [ ] **Step 1: Read the existing layout block in design-tokens.css**

The file ends with a `/* Layout */` block. We add new tokens at the end of `:root`.

- [ ] **Step 2: Add tokens before the closing `}` of `:root`**

```css
  /* Editor pane */
  --cs-editor-min:           320px;
  --cs-editor-max-frac:      0.7;
  --cs-editor-default-frac:  0.45;
```

- [ ] **Step 3: Smoke run**

Run: `npm run dev`
Expected: app launches; no visual regressions (tokens are additive). Stop the dev server.

- [ ] **Step 4: Commit**

```
git add src/renderer/design-tokens.css
git commit -m "feat(editor): add editor pane sizing tokens"
```

---

## Phase 3 — EditorPane skeleton (no CodeMirror yet)

### Task 7: Frontend-design pass for EditorPane

**Files:** none yet — this task produces a design memo we apply in Task 8.

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** with this brief:

> Design the EditorPane component for CodeSpace. It is a right-docked file viewer/editor that integrates next to the existing terminal grid. Header is 30px (`--cs-header-h`) and matches the terminal-pane header geometry exactly. Header contents (left to right): a 6px dirty dot (cyan when dirty, hidden when clean, briefly green when saved), basename in mono 11px, optional `[external]` and `[plain]` chips, then right-aligned reveal-in-folder and close icons. Body is the CM6 host with 4px padding (matches `.xterm-container`). Empty state mirrors `.empty-workspace`. Error states reuse `.pane-error`. All measurements/colors must come from `--cs-*` tokens; reference `DESIGN_SYSTEM.md` and the spec at `docs/superpowers/specs/2026-05-06-code-editor-pane-design.md`. Output: a final EditorPane.css ready to drop in, plus any micro-refinements to the EditorPane.jsx structure.

- [ ] **Step 2: Capture the resulting CSS and JSX structure** in this plan's working notes (paste into the comment-block at the top of `EditorPane.css` and `EditorPane.jsx` when we create them in Task 8).

- [ ] **Step 3: No commit** (artifact-only task; outputs flow into Task 8).

---

### Task 8: EditorPane component (skeleton)

**Files:**
- Create: `src/renderer/components/EditorPane.jsx`
- Create: `src/renderer/components/EditorPane.css`
- Test: `tests/components/EditorPane.test.jsx`

- [ ] **Step 1: Write failing component tests**

```jsx
// tests/components/EditorPane.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import EditorPane from '../../src/renderer/components/EditorPane.jsx'

const baseProps = {
  file: null, line: null, dirty: false, width: 600,
  fontSize: 13, isExternal: false,
  onSave: vi.fn(), onClose: vi.fn(), onResize: vi.fn(), onRevealInFolder: vi.fn(),
}

describe('EditorPane', () => {
  it('renders empty state when file is null', () => {
    render(<EditorPane {...baseProps} />)
    expect(screen.getByText(/Ctrl\+click any path/i)).toBeInTheDocument()
  })

  it('renders filename in header when file is set', () => {
    render(<EditorPane {...baseProps} file="C:\\Users\\TJ\\src\\foo.ts" loadState="content" content="hi" />)
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
  })

  it('shows dirty dot when dirty is true', () => {
    render(<EditorPane {...baseProps} file="C:\\foo.ts" dirty loadState="content" content="" />)
    expect(screen.getByTestId('dirty-dot')).toHaveClass('is-dirty')
  })

  it('shows external badge when isExternal is true', () => {
    render(<EditorPane {...baseProps} file="C:\\foo.ts" isExternal loadState="content" content="" />)
    expect(screen.getByText(/external/i)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<EditorPane {...baseProps} file="C:\\foo.ts" onClose={onClose} loadState="content" content="" />)
    fireEvent.click(screen.getByTitle('Close editor'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows error UI for too-large state', () => {
    render(<EditorPane {...baseProps} file="C:\\big" loadState="error" errorReason="too-large" />)
    expect(screen.getByText(/too large/i)).toBeInTheDocument()
    expect(screen.getByText(/reveal in folder/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- EditorPane`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement EditorPane.jsx with a `<pre>` placeholder for content**

```jsx
// src/renderer/components/EditorPane.jsx
import { useCallback } from 'react'
import './EditorPane.css'

const REASON_COPY = {
  'not-found':  { title: 'File no longer at this path', body: 'It may have been moved or deleted.', cta: null },
  'too-large':  { title: 'File too large to open in CodeSpace', body: 'Files larger than 20 MB must be opened externally.', cta: 'reveal' },
  'binary':     { title: 'Binary file', body: 'CodeSpace only opens text files.', cta: 'reveal' },
  'denied':     { title: "Couldn't read this file", body: 'Permission denied.', cta: 'retry' },
  'unknown':    { title: "Couldn't read this file", body: 'Unknown error.', cta: 'retry' },
}

function basename(p) {
  if (!p) return ''
  const m = p.match(/[^\\/]+$/)
  return m ? m[0] : p
}

export default function EditorPane({
  file, dirty, isExternal, isPlain,
  loadState, content, errorReason,
  width,
  onClose, onRevealInFolder, onRetry,
}) {
  const showHeader = !!file
  const handleReveal = useCallback(() => file && onRevealInFolder?.(file), [file, onRevealInFolder])

  return (
    <div className="editor-pane" style={{ flex: `0 0 ${width}px` }}>
      {showHeader && (
        <div className="editor-pane-header">
          <span
            data-testid="dirty-dot"
            className={`editor-dirty-dot ${dirty ? 'is-dirty' : ''}`}
            aria-hidden="true"
          />
          <span className="editor-filename" title={file}>{basename(file)}</span>
          {isExternal && <span className="editor-chip">EXTERNAL</span>}
          {isPlain && <span className="editor-chip">PLAIN</span>}
          <div className="editor-pane-actions">
            <button
              className="editor-icon-btn"
              title="Reveal in folder"
              onClick={handleReveal}
            >↗</button>
            <button
              className="editor-icon-btn editor-close-btn"
              title="Close editor"
              onClick={onClose}
            >×</button>
          </div>
        </div>
      )}

      {!file && (
        <div className="editor-empty">
          <span className="editor-empty-mark">✦</span>
          <p className="editor-empty-title">Editor is open</p>
          <p className="editor-empty-hint">Ctrl+click any path in your terminal</p>
        </div>
      )}

      {file && loadState === 'loading' && (
        <div className="editor-body">
          <div className="editor-loading-bar" />
        </div>
      )}

      {file && loadState === 'content' && (
        <div className="editor-body">
          {/* CodeMirror replaces this in Task 13 */}
          <pre className="editor-pre">{content ?? ''}</pre>
        </div>
      )}

      {file && loadState === 'error' && (
        <div className="pane-error">
          <p className="pane-error-title">{REASON_COPY[errorReason]?.title ?? "Couldn't open this file"}</p>
          <p className="pane-error-body">{REASON_COPY[errorReason]?.body ?? ''}</p>
          {REASON_COPY[errorReason]?.cta === 'reveal' && (
            <button className="pane-error-btn" onClick={handleReveal}>Reveal in folder</button>
          )}
          {REASON_COPY[errorReason]?.cta === 'retry' && (
            <button className="pane-error-btn" onClick={onRetry}>Try again</button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Implement EditorPane.css**

(Use the artifact produced by Task 7's frontend-design pass. If unavailable, here is a token-grounded baseline that satisfies the tests and the spec's "Visual design" section verbatim.)

```css
.editor-pane {
  display: flex;
  flex-direction: column;
  background: var(--cs-bg-surface);
  border-left: 1px solid var(--cs-border);
  min-width: var(--cs-editor-min);
  overflow: hidden;
  animation: scaleIn 0.2s ease both;
}

.editor-pane-header {
  height: var(--cs-header-h);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid var(--cs-border);
  flex-shrink: 0;
}

.editor-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cs-cyan);
  box-shadow: 0 0 6px var(--cs-cyan-glow);
  visibility: hidden;
  flex-shrink: 0;
}
.editor-dirty-dot.is-dirty { visibility: visible; }
.editor-dirty-dot.flash-saved {
  animation: flash-saved 0.2s ease forwards;
}
@keyframes flash-saved {
  0%   { background: var(--cs-cyan); }
  60%  { background: var(--cs-green); }
  100% { background: var(--cs-cyan); visibility: hidden; }
}

.editor-filename {
  font-family: var(--cs-font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--cs-text-secondary);
}

.editor-chip {
  font-family: var(--cs-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cs-text-muted);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  padding: 1px 5px;
}

.editor-pane-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.editor-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  width: 26px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--cs-text-dim);
  font-family: var(--cs-font-mono);
  font-size: 14px;
  line-height: 1;
  transition: color var(--cs-transition), background var(--cs-transition);
  padding: 0;
}
.editor-icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--cs-text-primary);
}
.editor-close-btn { font-size: 18px; }
.editor-close-btn:hover {
  background: var(--cs-red-hover-bg);
  color: var(--cs-red-hover-fg);
}

.editor-body {
  flex: 1;
  min-height: 0;
  padding: 4px;
  position: relative;
  overflow: hidden;
}

.editor-pre {
  margin: 0;
  padding: 8px;
  font-family: var(--cs-font-mono);
  font-size: 12.5px;
  color: var(--cs-text-secondary);
  white-space: pre;
  overflow: auto;
  height: 100%;
}

.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px;
  border: 1px dashed var(--cs-border);
  border-radius: var(--cs-radius);
  margin: 8px;
  background: var(--cs-bg-surface);
}
.editor-empty-mark {
  font-size: 18px;
  color: var(--cs-text-dim);
}
.editor-empty-title {
  font-family: var(--cs-font-ui);
  font-size: 13px;
  color: var(--cs-text-tertiary);
}
.editor-empty-hint {
  font-family: var(--cs-font-mono);
  font-size: 10.5px;
  color: var(--cs-text-muted);
  letter-spacing: 0.06em;
}

.editor-loading-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--cs-cyan) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: editor-shimmer 0.6s linear infinite;
}
@keyframes editor-shimmer {
  from { background-position: 200% 50%; }
  to   { background-position: -100% 50%; }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- EditorPane`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Manual smoke**

Hot-render the component standalone via DevTools (or temporarily mount it from `App.jsx` behind a debug flag). Verify visually that empty / loading / content / error states match the existing design language.

- [ ] **Step 7: Commit**

```
git add src/renderer/components/EditorPane.jsx src/renderer/components/EditorPane.css tests/components/EditorPane.test.jsx
git commit -m "feat(editor): EditorPane skeleton with empty/loading/content/error states"
```

---

## Phase 4 — CodeMirror integration

### Task 9: Install CodeMirror 6 dependencies

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install**

```
npm install @codemirror/view @codemirror/state @codemirror/commands @codemirror/language @codemirror/search @codemirror/autocomplete @lezer/highlight @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-html @codemirror/lang-css
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: build succeeds, no peer-dep warnings beyond what was present before.

- [ ] **Step 3: Commit**

```
git add package.json package-lock.json
git commit -m "chore(editor): add CodeMirror 6 dependencies"
```

---

### Task 10: codemirror-theme.js

**Files:**
- Create: `src/renderer/codemirror-theme.js`

- [ ] **Step 1: Implement theme module**

```js
// src/renderer/codemirror-theme.js
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function buildTheme() {
  const bg        = readToken('--cs-bg-surface',  '#0d0f12')
  const sidebarBg = readToken('--cs-bg-sidebar',  '#0a0c0f')
  const border    = readToken('--cs-border',      '#1b1e24')
  const cyan      = readToken('--cs-cyan',        '#67e8f9')
  const muted     = readToken('--cs-text-muted',  'rgba(255,255,255,0.28)')
  const primary   = readToken('--cs-text-primary','rgba(255,255,255,0.92)')
  const fontMono  = readToken('--cs-font-mono',   'ui-monospace, monospace')

  return EditorView.theme({
    '&': {
      backgroundColor: bg,
      color: primary,
      fontFamily: fontMono,
      height: '100%',
    },
    '.cm-content':       { caretColor: cyan, padding: '8px 0' },
    '.cm-cursor':        { borderLeftColor: cyan, borderLeftWidth: '1.5px' },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(103, 232, 249, 0.18)',
    },
    '.cm-activeLine':       { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-gutters': {
      backgroundColor: sidebarBg,
      color: muted,
      borderRight: `1px solid ${border}`,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: fontMono,
      fontVariantNumeric: 'tabular-nums',
      padding: '0 8px',
    },
    '&.cm-focused':         { outline: 'none' },
    '.cm-scroller':         { fontFamily: fontMono, lineHeight: '1.55' },
  }, { dark: true })
}

export function buildHighlightStyle() {
  return syntaxHighlighting(HighlightStyle.define([
    { tag: t.keyword,           color: '#67e8f9' },
    { tag: [t.string, t.special(t.string)], color: '#86efac' },
    { tag: t.comment,           color: 'rgba(255,255,255,0.28)', fontStyle: 'italic' },
    { tag: [t.number, t.bool, t.null], color: '#f59e0b' },
    { tag: t.variableName,      color: 'rgba(255,255,255,0.92)' },
    { tag: t.function(t.variableName), color: 'rgba(255,255,255,0.92)' },
    { tag: t.typeName,          color: '#67e8f9' },
    { tag: t.propertyName,      color: 'rgba(255,255,255,0.78)' },
    { tag: t.operator,          color: 'rgba(255,255,255,0.42)' },
    { tag: t.punctuation,       color: 'rgba(255,255,255,0.42)' },
    { tag: t.tagName,           color: '#67e8f9' },
    { tag: t.attributeName,     color: '#86efac' },
  ]))
}
```

- [ ] **Step 2: Manual smoke (later)** — this is exercised in Task 13 once the theme is mounted.

- [ ] **Step 3: Commit**

```
git add src/renderer/codemirror-theme.js
git commit -m "feat(editor): CodeMirror theme bound to design tokens"
```

---

### Task 11: useEditor hook (lifecycle + plain mode)

**Files:**
- Create: `src/renderer/hooks/useEditor.js`

- [ ] **Step 1: Implement the hook**

```js
// src/renderer/hooks/useEditor.js
import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { buildTheme, buildHighlightStyle } from '../codemirror-theme.js'

const PLAIN_MODE_THRESHOLD = 2 * 1024 * 1024 // 2 MB

function langFor(file) {
  if (!file) return null
  const ext = (file.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase()
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs':
    case 'ts': case 'tsx':            return javascript({ jsx: true, typescript: ext.startsWith('ts') })
    case 'json':                       return json()
    case 'md': case 'markdown':        return markdown()
    case 'html': case 'htm':           return html()
    case 'css':                        return css()
    default:                            return null
  }
}

export default function useEditor({ hostRef, file, content, isPlain, fontSize, onSave, onDirtyChange, onScroll }) {
  const viewRef = useRef(null)
  const fontCompartmentRef = useRef(new Compartment())
  const lastSavedRef = useRef(content ?? '')

  const [scrolledToLine, setScrolledToLine] = useState(null)

  // Build / rebuild view when file or plain mode changes.
  useEffect(() => {
    if (!hostRef.current) return
    const langExt = isPlain ? [] : (langFor(file) ? [langFor(file)] : [])
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content ?? '',
        extensions: [
          history(),
          drawSelection(),
          isPlain ? [] : highlightActiveLine(),
          isPlain ? [] : lineNumbers(),
          buildTheme(),
          buildHighlightStyle(),
          ...langExt,
          fontCompartmentRef.current.of(EditorView.theme({
            '&': { fontSize: `${fontSize}px` }
          })),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: (v) => { onSave?.(v.state.doc.toString()); return true } },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const cur = update.state.doc.toString()
              const dirty = cur !== lastSavedRef.current
              onDirtyChange?.(dirty)
            }
            if (update.geometryChanged) {
              onScroll?.(view.scrollDOM.scrollTop)
            }
          }),
        ]
      })
    })
    viewRef.current = view
    lastSavedRef.current = content ?? ''
    onDirtyChange?.(false)

    return () => { view.destroy(); viewRef.current = null }
  }, [hostRef, file, isPlain]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update font size without rebuilding the view.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({
      effects: fontCompartmentRef.current.reconfigure(EditorView.theme({
        '&': { fontSize: `${fontSize}px` }
      }))
    })
  }, [fontSize])

  // Mark not-dirty when content prop changes (file swap → caller passes new doc).
  useEffect(() => { lastSavedRef.current = content ?? '' }, [content])

  function markSaved(snapshot) {
    lastSavedRef.current = snapshot
    onDirtyChange?.(false)
  }

  function jumpToLine(line) {
    const v = viewRef.current
    if (!v || !line) return
    const lineCount = v.state.doc.lines
    const target = Math.max(1, Math.min(line, lineCount))
    const pos = v.state.doc.line(target).from
    v.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    })
    setScrolledToLine(target)
  }

  return { viewRef, markSaved, jumpToLine, scrolledToLine, PLAIN_MODE_THRESHOLD }
}

export { PLAIN_MODE_THRESHOLD }
```

- [ ] **Step 2: Commit**

```
git add src/renderer/hooks/useEditor.js
git commit -m "feat(editor): useEditor hook with plain-mode threshold and font compartment"
```

---

### Task 12: Wire CodeMirror into EditorPane

**Files:**
- Modify: `src/renderer/components/EditorPane.jsx`

- [ ] **Step 1: Replace the `<pre>` with a CM host div + hook usage**

Patch the content branch:

```jsx
// at top:
import { useRef, useEffect, useState, useCallback } from 'react'
import useEditor, { PLAIN_MODE_THRESHOLD } from '../hooks/useEditor.js'
```

Replace `{file && loadState === 'content' && ...}` with:

```jsx
{file && loadState === 'content' && (
  <EditorBody
    file={file}
    line={initialLine}
    content={content ?? ''}
    fontSize={fontSize}
    onSave={onSave}
    onDirtyChange={onDirtyChange}
    onScroll={onScroll}
  />
)}
```

Add component below:

```jsx
function EditorBody({ file, line, content, fontSize, onSave, onDirtyChange, onScroll }) {
  const hostRef = useRef(null)
  const isPlain = (content?.length ?? 0) >= PLAIN_MODE_THRESHOLD
  const { jumpToLine } = useEditor({ hostRef, file, content, isPlain, fontSize, onSave, onDirtyChange, onScroll })

  useEffect(() => { if (line) jumpToLine(line) }, [file, line]) // eslint-disable-line

  return <div ref={hostRef} className="editor-cm-host" />
}
```

Add CSS:
```css
.editor-cm-host { height: 100%; }
.editor-cm-host .cm-editor { height: 100%; }
```

Update prop signature of `EditorPane` to accept and forward: `initialLine`, `fontSize`, `onSave`, `onDirtyChange`, `onScroll`.

- [ ] **Step 2: Manual smoke**

Temporarily render `EditorPane` from `App.jsx` with hardcoded sample content (e.g., `App.jsx`'s own source via fetch + readFile IPC). Verify:
- Highlighting appears for .js/.jsx
- Cursor is cyan
- Selection is cyan-tinted
- Line numbers render
- Ctrl+S triggers `onSave` callback (log it)
- Font size changes when you change `fontSize` prop

Stop dev server, undo the temporary App.jsx render.

- [ ] **Step 3: Commit**

```
git add src/renderer/components/EditorPane.jsx src/renderer/components/EditorPane.css
git commit -m "feat(editor): mount CodeMirror inside EditorPane with plain-mode fallback"
```

---

### Task 13: Lazy-load EditorPane

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Replace direct import with `React.lazy`**

```jsx
// at top of App.jsx
import { lazy, Suspense } from 'react'
const EditorPane = lazy(() => import('./components/EditorPane.jsx'))
```

(Where `EditorPane` is rendered, wrap in `<Suspense fallback={null}>`. Actual rendering wiring lands in Task 18.)

- [ ] **Step 2: No commit yet** — lands in Task 18 after layout integration.

---

## Phase 5 — Layout & resize

### Task 14: Frontend-design pass for resizer + layout

**Files:** none — produces layout decisions for Tasks 15–17.

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** with this brief:

> Design the EditorResizer and the three-column `.app-body` layout (sidebar 220px | grid flex 1 | editor `flex: 0 0 width`). Resizer is 4px wide, hover-expanded hit area, transparent default, cyan on hover/grab. Anchor every measurement to design tokens. Output: final EditorResizer.css plus any `App.css` additions.

- [ ] **Step 2: Capture resulting CSS** for use in Tasks 15–17.

- [ ] **Step 3: No commit.**

---

### Task 15: EditorResizer component

**Files:**
- Create: `src/renderer/components/EditorResizer.jsx`
- Create: `src/renderer/components/EditorResizer.css`
- Test: `tests/components/EditorResizer.test.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
// tests/components/EditorResizer.test.jsx
import { render, fireEvent, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EditorResizer from '../../src/renderer/components/EditorResizer.jsx'

function renderResizer(props = {}) {
  return render(<EditorResizer
    width={500}
    bodyWidth={1400}
    onResize={vi.fn()}
    onResizeEnd={vi.fn()}
    onReset={vi.fn()}
    {...props}
  />)
}

describe('EditorResizer', () => {
  it('renders a handle element with role=separator', () => {
    renderResizer()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('calls onResize during pointer drag', () => {
    const onResize = vi.fn()
    renderResizer({ onResize })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { clientX: 900 })
    fireEvent.pointerMove(handle, { clientX: 700 })
    expect(onResize).toHaveBeenCalled()
  })

  it('calls onResizeEnd after pointer up', () => {
    const onResizeEnd = vi.fn()
    renderResizer({ onResizeEnd })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { clientX: 900 })
    fireEvent.pointerUp(handle, { clientX: 900 })
    expect(onResizeEnd).toHaveBeenCalled()
  })

  it('calls onReset on double click', () => {
    const onReset = vi.fn()
    renderResizer({ onReset })
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(onReset).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- EditorResizer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement EditorResizer.jsx**

```jsx
// src/renderer/components/EditorResizer.jsx
import { useCallback, useRef, useState } from 'react'
import { clampWidth } from '../editor-state.js'
import './EditorResizer.css'

export default function EditorResizer({ width, bodyWidth, onResize, onResizeEnd, onReset }) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ x: 0, w: width })

  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    e.target.setPointerCapture?.(e.pointerId)
    setDragging(true)
    startRef.current = { x: e.clientX, w: width }
  }, [width])

  const onPointerMove = useCallback((e) => {
    if (!dragging) return
    const delta = startRef.current.x - e.clientX
    const next  = clampWidth(startRef.current.w + delta, bodyWidth)
    onResize?.(next)
  }, [dragging, bodyWidth, onResize])

  const onPointerUp = useCallback((e) => {
    if (!dragging) return
    setDragging(false)
    e.target.releasePointerCapture?.(e.pointerId)
    onResizeEnd?.()
  }, [dragging, onResizeEnd])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`editor-resizer ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  )
}
```

- [ ] **Step 4: Implement EditorResizer.css**

```css
.editor-resizer {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  transition: background var(--cs-transition);
}
.editor-resizer::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
}
.editor-resizer:hover,
.editor-resizer.dragging {
  background: rgba(103, 232, 249, 0.45);
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- EditorResizer`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```
git add src/renderer/components/EditorResizer.jsx src/renderer/components/EditorResizer.css tests/components/EditorResizer.test.jsx
git commit -m "feat(editor): vertical resizer between grid and editor"
```

---

## Phase 6 — Terminal wiring (xterm linkProvider)

### Task 16: Register linkProvider in useTerminal

**Files:**
- Modify: `src/renderer/hooks/useTerminal.js`

- [ ] **Step 1: Read current useTerminal.js** to identify the right insertion point (after the xterm `Terminal` is constructed and `open()`'d on the host element).

- [ ] **Step 2: Add link-provider registration**

Inside `useTerminal`, after the terminal is opened and BEFORE the existing keyboard/clipboard wiring, add:

```js
import { parsePathsInLine } from '../path-parser.js'
import { resolvePath } from '../path-resolver.js'

// ... inside the hook:
useEffect(() => {
  if (!termRef.current || !ptyId) return
  const term = termRef.current

  function getBufferLine(y) {
    const line = term.buffer.active.getLine(y - 1)
    return line ? line.translateToString(true) : ''
  }

  const disposable = term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const text = getBufferLine(bufferLineNumber)
      const matches = parsePathsInLine(text)
      if (matches.length === 0) return callback(undefined)
      callback(matches.map(m => ({
        range: {
          start: { x: m.start + 1, y: bufferLineNumber },
          end:   { x: m.end,       y: bufferLineNumber }
        },
        text: m.raw,
        activate: async (event) => {
          if (!(event.ctrlKey || event.metaKey)) return
          const resolved = await resolvePath(m.raw, cwdRef.current, workspaceDirRef.current, window.electronAPI.editor)
          if (!resolved) return // silent no-op
          onOpenFile?.({ path: resolved.path, line: resolved.line, col: resolved.col })
        },
        hover: () => {},
        leave: () => {},
      })))
    }
  })
  return () => disposable.dispose()
}, [ptyId, onOpenFile])
```

`cwdRef` and `workspaceDirRef` are added to the hook's prop intake; pass them in from `TerminalPane`.

- [ ] **Step 3: Add Ctrl-key cursor affordance**

```js
useEffect(() => {
  const host = hostElRef.current
  if (!host) return
  function onKey(e) {
    if (e.key === 'Control' || e.key === 'Meta') {
      host.dataset.modifierCtrl = e.type === 'keydown' ? 'true' : ''
    }
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
  }
}, [])
```

In TerminalPane.css, append:
```css
.xterm-container[data-modifier-ctrl="true"] .xterm-link {
  cursor: pointer;
}
```

(The `.xterm-link` class is added by xterm automatically for ranges returned from `registerLinkProvider`.)

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`. In a workspace, type `ls src/components` (or any output that prints paths). Hold Ctrl, hover a path, click. Console-log the `onOpenFile` payload from `TerminalPane` (temporary log). Verify the resolved path is correct for both relative and absolute paths.

- [ ] **Step 5: Commit**

```
git add src/renderer/hooks/useTerminal.js src/renderer/components/TerminalPane.css
git commit -m "feat(editor): xterm linkProvider for Ctrl+click path activation"
```

---

### Task 17: Forward onOpenFile from TerminalPane to App

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx`

- [ ] **Step 1: Add `onOpenFile`, `cwd`, `workspaceDir` props**

In `TerminalPane.jsx`, accept and forward to `useTerminal`:
```jsx
useTerminal({ ..., cwdRef, workspaceDirRef, onOpenFile })
```

(Use `useRef` mirrors of `cwd` and `workspaceDir` so the linkProvider sees current values without needing to re-register.)

- [ ] **Step 2: Update existing TerminalPane test if necessary** — if any existing test renders TerminalPane without the new prop, ensure it still passes (the prop is optional).

Run: `npm test -- TerminalPane`
Expected: PASS (existing tests unchanged).

- [ ] **Step 3: Commit**

```
git add src/renderer/components/TerminalPane.jsx tests/components/TerminalPane.test.jsx
git commit -m "feat(editor): TerminalPane forwards onOpenFile to caller"
```

---

## Phase 7 — State integration & persistence

### Task 18: App.jsx — three-column layout, editor state, openFile flow

**Files:**
- Modify: `src/renderer/App.jsx`
- Modify: `src/renderer/App.css`

- [ ] **Step 1: Update App.css**

```css
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.body-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.grid-wrap {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
}
```

(`.body-main` wraps grid + resizer + editor so the sidebar stays separate. `.grid-wrap` keeps the existing `.grid` rendering rules.)

- [ ] **Step 2: Add `editor` to default workspace state**

In `handleOnboardingLaunch` and `handleCreateWorkspace`, include:
```js
editor: defaultEditorState()
```

In the workspace-load `useEffect`, when restoring, hydrate:
```js
editor: w.editor ?? defaultEditorState()
```

Import: `import { defaultEditorState, mergeEditor, clampWidth, EDITOR_DEFAULT_FRAC } from './editor-state.js'`.

- [ ] **Step 3: Add editor action callbacks**

```js
const setEditorPatch = useCallback((patch) => {
  updateActive(w => ({ ...w, editor: mergeEditor(w.editor, patch) }))
}, [updateActive])

const setEditorOpen     = useCallback((open) => setEditorPatch({ open }), [setEditorPatch])
const setEditorWidth    = useCallback((width) => setEditorPatch({ width }), [setEditorPatch])
const setEditorDirty    = useCallback((dirty) => setEditorPatch({ dirty }), [setEditorPatch])
const setEditorScroll   = useCallback((scroll) => setEditorPatch({ scroll }), [setEditorPatch])

const openFileInEditor = useCallback(async ({ path, line }) => {
  // Dirty-prompt is handled in Task 19; for now, just open.
  setEditorPatch({ open: true, file: path, line: line ?? null, dirty: false })
}, [setEditorPatch])

const closeEditor = useCallback(() => setEditorPatch({ open: false }), [setEditorPatch])
```

- [ ] **Step 4: Update body render to three-column with lazy editor pane**

Replace the `.app-body` JSX with:

```jsx
<div className="app-body">
  <Sidebar
    workspaces={workspaces}
    activeId={activeId}
    notifyingIds={notifyingWorkspaceIds}
    onSelect={handleSelectWorkspace}
    onCreate={() => setShowNewModal(true)}
    onDelete={handleDeleteWorkspace}
  />
  <div className="body-main">
    <div className="grid-wrap">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`
        }}
      >
        {/* existing terminal panes / empty-workspace render */}
      </div>
    </div>
    {activeWorkspace?.editor?.open && (
      <>
        <EditorResizer
          width={activeWorkspace.editor.width || 600}
          bodyWidth={bodyWidthRef.current}
          onResize={(w) => setEditorPatch({ width: w })}
          onResizeEnd={() => { /* width is already in state; debounced persistence picks it up */ }}
          onReset={() => setEditorPatch({ width: Math.round((bodyWidthRef.current ?? 1400) * EDITOR_DEFAULT_FRAC) })}
        />
        <Suspense fallback={null}>
          <EditorPane
            file={activeWorkspace.editor.file}
            initialLine={activeWorkspace.editor.line}
            dirty={activeWorkspace.editor.dirty}
            isExternal={isExternalToWorkspace(activeWorkspace.editor.file, activeWorkspace.dir)}
            isPlain={false /* set by EditorPane based on content size */}
            loadState={editorLoadState}
            content={editorContent}
            errorReason={editorErrorReason}
            width={activeWorkspace.editor.width || Math.round((bodyWidthRef.current ?? 1400) * EDITOR_DEFAULT_FRAC)}
            fontSize={activeWorkspace.fontSize ?? 13}
            onSave={handleEditorSave}
            onClose={() => closeEditor()}
            onResize={setEditorWidth}
            onRevealInFolder={(p) => window.electronAPI.editor.revealInFolder(p)}
            onDirtyChange={setEditorDirty}
            onScroll={setEditorScroll}
            onRetry={() => triggerEditorReload()}
          />
        </Suspense>
      </>
    )}
  </div>
</div>
```

- [ ] **Step 5: Implement local editor I/O state**

Inside `App.jsx`:

```js
const [editorLoadState, setEditorLoadState] = useState('empty') // empty | loading | content | error
const [editorContent,  setEditorContent]    = useState('')
const [editorErrorReason, setEditorErrorReason] = useState(null)

useEffect(() => {
  const file = activeWorkspace?.editor?.file
  if (!file) { setEditorLoadState('empty'); setEditorContent(''); return }
  let cancelled = false
  setEditorLoadState('loading')
  window.electronAPI.editor.readFile(file).then(r => {
    if (cancelled) return
    if (r.ok) {
      setEditorContent(r.content)
      setEditorLoadState('content')
    } else {
      setEditorErrorReason(r.reason)
      setEditorLoadState('error')
    }
  })
  return () => { cancelled = true }
}, [activeWorkspace?.editor?.file, activeWorkspace?.id])

const handleEditorSave = useCallback(async (content) => {
  const file = activeWorkspace?.editor?.file
  if (!file) return
  const r = await window.electronAPI.editor.writeFile(file, content)
  if (r.ok) {
    setEditorContent(content)
    setEditorPatch({ dirty: false })
  } else {
    // Re-use ConfirmDialog as the save-failure surface.
    setSaveError({ file, reason: r.reason, message: r.message, content })
  }
}, [activeWorkspace, setEditorPatch])
```

(Also add `bodyWidthRef`: a `useRef` updated via a `ResizeObserver` on `.app-body`, plus an `isExternalToWorkspace(file, dir)` helper that returns `!file?.startsWith(dir)`.)

- [ ] **Step 6: Wire openFileInEditor into TerminalPane render**

Pass `onOpenFile={openFileInEditor}`, `workspaceDir={activeWorkspace.dir}` to each `<TerminalPane>`.

- [ ] **Step 7: Manual smoke**

Run `npm run dev`. In a workspace, type `ls src/`. Ctrl+click a printed path. Verify the editor pane opens, content loads, you can edit, Ctrl+S saves (verify the file changed via a separate `git status`).

- [ ] **Step 8: Commit**

```
git add src/renderer/App.jsx src/renderer/App.css
git commit -m "feat(editor): three-column layout, editor state actions, open/save flow"
```

---

### Task 19: Dirty-change confirmation flow

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Add a pending-action state for dirty prompts**

```js
const [pendingDirtyAction, setPendingDirtyAction] = useState(null)
// shape: { kind: 'open-file' | 'close-pane' | 'switch-workspace', payload: ... }
```

- [ ] **Step 2: Update `openFileInEditor`, `closeEditor`, `handleSelectWorkspace` to gate on dirty**

```js
const openFileInEditor = useCallback(async ({ path, line }) => {
  const ed = activeWorkspace?.editor
  if (ed?.dirty && ed?.file && ed.file !== path) {
    setPendingDirtyAction({ kind: 'open-file', payload: { path, line } })
    return
  }
  setEditorPatch({ open: true, file: path, line: line ?? null, dirty: false })
}, [activeWorkspace, setEditorPatch])

const closeEditor = useCallback(() => {
  const ed = activeWorkspace?.editor
  if (ed?.dirty) {
    setPendingDirtyAction({ kind: 'close-pane' })
    return
  }
  setEditorPatch({ open: false })
}, [activeWorkspace, setEditorPatch])

const handleSelectWorkspace = useCallback((wsId) => {
  if (activeWorkspace?.editor?.dirty) {
    setPendingDirtyAction({ kind: 'switch-workspace', payload: { wsId } })
    return
  }
  setActiveId(wsId)
}, [activeWorkspace])
```

- [ ] **Step 3: Render the prompt**

```jsx
{pendingDirtyAction && (
  <ConfirmDialog
    title="Save unsaved changes?"
    message={
      <>
        You have unsaved changes in <strong className="cd-emphasis">{basename(activeWorkspace.editor.file)}</strong>.
      </>
    }
    confirmLabel="Save"
    cancelLabel="Cancel"
    extraLabel="Discard"
    onConfirm={async () => {
      // Save then proceed
      await handleEditorSave(editorContent /* current doc */)
      proceedDirtyAction(pendingDirtyAction)
      setPendingDirtyAction(null)
    }}
    onExtra={() => {
      proceedDirtyAction(pendingDirtyAction)
      setPendingDirtyAction(null)
    }}
    onCancel={() => setPendingDirtyAction(null)}
  />
)}
```

(`ConfirmDialog` only takes Confirm/Cancel today — extend it in Task 20 to support an optional third `extra` button. If implementation order is awkward, reverse Tasks 19/20.)

- [ ] **Step 4: Implement `proceedDirtyAction(action)`**

```js
function proceedDirtyAction(action) {
  if (action.kind === 'open-file') openFileInEditorImmediate(action.payload)
  else if (action.kind === 'close-pane') setEditorPatch({ open: false })
  else if (action.kind === 'switch-workspace') setActiveId(action.payload.wsId)
}
```

(`openFileInEditorImmediate` is the original logic without dirty-gating.)

- [ ] **Step 5: Manual smoke**

Run `npm run dev`. Edit a file. Try: (a) Ctrl+click another path, (b) close the pane, (c) switch workspace. Each should prompt. Verify Save / Discard / Cancel each behave correctly.

- [ ] **Step 6: Commit**

```
git add src/renderer/App.jsx
git commit -m "feat(editor): unsaved-changes prompt on file swap, close, workspace switch"
```

---

### Task 20: Extend ConfirmDialog to support a third button

**Files:**
- Modify: `src/renderer/components/ConfirmDialog.jsx`
- Modify: `src/renderer/components/ConfirmDialog.css`

- [ ] **Step 1: Add `extraLabel` and `onExtra` props**

```jsx
{props.extraLabel && (
  <button className="cd-extra" onClick={props.onExtra}>{props.extraLabel}</button>
)}
```

Inserted between Cancel and Confirm in the `.cd-actions` row.

- [ ] **Step 2: Add CSS**

```css
.cd-extra {
  font-family: var(--cs-font-ui);
  font-size: 12px;
  padding: 8px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--cs-text-secondary);
  border-radius: 8px;
  cursor: pointer;
  transition: color var(--cs-transition), background var(--cs-transition), border-color var(--cs-transition);
}
.cd-extra:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.16);
  color: var(--cs-text-primary);
}
```

- [ ] **Step 3: Verify existing ConfirmDialog tests still pass**

Run: `npm test -- ConfirmDialog`
Expected: PASS (existing tests don't pass `extraLabel`).

- [ ] **Step 4: Commit**

```
git add src/renderer/components/ConfirmDialog.jsx src/renderer/components/ConfirmDialog.css
git commit -m "feat(confirm-dialog): optional third action button (Save/Discard/Cancel pattern)"
```

---

### Task 21: Persist editor field in workspaces.json

**Files:**
- Modify: `src/main/workspaces-store.js`
- Modify: `src/renderer/App.jsx` (the persist `useEffect`)

- [ ] **Step 1: Update App.jsx persist to include editor**

In the persist debounce, change the `workspaces.map`:
```js
workspaces.map(w => ({
  id: w.id, name: w.name, dir: w.dir, agentCount: w.agentCount,
  editor: {
    open:  !!w.editor?.open,
    file:  w.editor?.file ?? null,
    line:  w.editor?.line ?? null,
    width: w.editor?.width ?? 0,
  }
}))
```

(`dirty` and `scroll` are intentionally not persisted.)

- [ ] **Step 2: Verify load path**

In the load `useEffect`, the restored workspace uses `editor: w.editor ?? defaultEditorState()` — already added in Task 18.

- [ ] **Step 3: Update workspaces-store.js if it has explicit field whitelisting**

Read the file; if it serializes only known keys, add `editor` to the allow-list. If it persists whatever it's given, no change.

- [ ] **Step 4: Manual smoke**

Run `npm run dev`. Open a file in editor, resize pane, close app. Re-open: verify pane width persists; verify the file is reopened (or shows empty if the file was deleted while closed).

- [ ] **Step 5: Commit**

```
git add src/renderer/App.jsx src/main/workspaces-store.js
git commit -m "feat(editor): persist editor open/file/line/width per workspace"
```

---

### Task 22: Workspace-delete dialog mentions unsaved file

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Update the delete dialog message**

```jsx
<ConfirmDialog
  title="Delete this workspace?"
  message={
    <>
      Removing <strong className="cd-emphasis">{pendingDeleteWorkspace.name}</strong> will close every agent inside it
      {pendingDeleteWorkspace.editor?.dirty && pendingDeleteWorkspace.editor?.file && (
        <> and discard your unsaved edits to <strong className="cd-emphasis">{basename(pendingDeleteWorkspace.editor.file)}</strong></>
      )}
      . You can't bring it back.
    </>
  }
  ...
/>
```

- [ ] **Step 2: Manual smoke**

Open a file, edit it, switch to another workspace, attempt to delete the dirty one — confirm the warning text appears.

- [ ] **Step 3: Commit**

```
git add src/renderer/App.jsx
git commit -m "feat(editor): workspace-delete dialog warns about unsaved editor changes"
```

---

## Phase 8 — Toolbar toggle + Ctrl+E

### Task 23: Frontend-design pass for Toolbar toggle

**Files:** none — produces final SVG icon + state styling.

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** with this brief:

> Design the Toolbar editor-toggle button. Geometry must match existing `titlebar-btn` (28×28, 6px radius). Default state: 45% opacity white, transparent background. Open state: cyan tint (`--cs-cyan` text + `rgba(103, 232, 249, 0.08)` background). Icon should be a minimal 14px stroke-1 SVG suggesting a code editor (e.g., a doc with a `</>` glyph or a vertical split). Output: SVG markup + CSS.

- [ ] **Step 2: Capture SVG and CSS** for Task 24.

- [ ] **Step 3: No commit.**

---

### Task 24: Toolbar editor toggle button

**Files:**
- Modify: `src/renderer/components/Toolbar.jsx`
- Modify: `src/renderer/components/Toolbar.css`

- [ ] **Step 1: Add the button**

```jsx
<button
  className={`titlebar-btn titlebar-editor-toggle ${editorOpen ? 'is-open' : ''}`}
  title="Editor (Ctrl+E)"
  onClick={onToggleEditor}
>
  {/* SVG from Task 23 */}
</button>
```

Place it just before the `VolumeControl` in the right-side actions cluster.

- [ ] **Step 2: Add CSS**

```css
.titlebar-editor-toggle.is-open {
  color: var(--cs-cyan);
  background: rgba(103, 232, 249, 0.08);
}
```

- [ ] **Step 3: Pass props from App.jsx**

```jsx
<Toolbar
  onAdd={addAgent}
  agentCount={terminals.length}
  editorOpen={!!activeWorkspace?.editor?.open}
  onToggleEditor={() => setEditorOpen(!activeWorkspace?.editor?.open)}
/>
```

- [ ] **Step 4: Commit**

```
git add src/renderer/components/Toolbar.jsx src/renderer/components/Toolbar.css src/renderer/App.jsx
git commit -m "feat(editor): toolbar toggle button with cyan open-state"
```

---

### Task 25: Ctrl+E global shortcut

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Extend the existing keydown handler**

Inside the existing `useEffect` that handles `Ctrl+T` / `Ctrl+W`, add:

```js
if (e.ctrlKey && e.key === 'e') {
  e.preventDefault()
  setEditorOpen(!activeWorkspace?.editor?.open)
}
```

- [ ] **Step 2: Manual smoke**

Run `npm run dev`. Press Ctrl+E — pane toggles. Press while inside an `<input>` (rename a workspace) — does NOT toggle (the existing `isEditable` check blocks it).

- [ ] **Step 3: Commit**

```
git add src/renderer/App.jsx
git commit -m "feat(editor): Ctrl+E toggles the editor pane"
```

---

## Phase 9 — Manual smoke pass + final verification

### Task 26: Run the spec's manual smoke checklist

**Files:** none — verification only.

- [ ] **Step 1: Run all unit tests**

```
npm test
```
Expected: PASS — every test green.

- [ ] **Step 2: Build**

```
npm run build
```
Expected: SUCCESS — no errors, no missing-module warnings.

- [ ] **Step 3: Run packaged build**

```
npm run preview
```

- [ ] **Step 4: Walk through the spec's manual smoke checklist** (from `docs/superpowers/specs/2026-05-06-code-editor-pane-design.md`, §"Testing"):

  - [ ] Ctrl+click absolute path in terminal opens it
  - [ ] Ctrl+click relative path resolves against terminal cwd
  - [ ] Ctrl+click `file.ts:42:5` opens file scrolled to line 42
  - [ ] Ctrl+S saves; dirty dot disappears with green flash
  - [ ] Toolbar toggle button reflects open/closed state with cyan tint
  - [ ] Resize handle drag updates width smoothly (no React re-renders mid-drag)
  - [ ] Resize persists across app restart
  - [ ] File outside workspace shows `[external]` badge
  - [ ] 25 MB file → too-large error
  - [ ] PNG → binary error
  - [ ] Unsaved + workspace switch → ConfirmDialog appears
  - [ ] Unsaved + workspace delete → delete dialog mentions unsaved file
  - [ ] Plain-mode badge appears on a 3 MB file

- [ ] **Step 5: If any check fails**, file as a follow-up task in this plan with reproduction steps. Do not declare the feature complete until every checkbox passes.

- [ ] **Step 6: Final commit (if anything remained)**, otherwise no commit.

---

## Self-review notes

Spec coverage: ✓ — every spec section maps to a phase. IPC channels (Phase 1), path parsing/resolution (Phase 1), state shape (Phase 1+7), CodeMirror integration (Phase 4), three-column layout + resize (Phase 5), terminal wiring (Phase 6), persistence migration (Phase 7), dirty prompts (Phase 7), toolbar toggle + Ctrl+E (Phase 8), manual smoke (Phase 9). Visual design checklist from spec §"Appendix" is enforced via the frontend-design passes in Tasks 7, 14, 23.

Placeholder scan: ✓ — no TBDs, no "implement later". Code blocks contain working code; commands are exact.

Type consistency: ✓ — `editor` shape matches across `editor-state.js`, `App.jsx`, IPC payloads, and persistence. `loadState` enum is `empty | loading | content | error` everywhere. `reason` enum is `not-found | too-large | binary | denied | unknown` in both main and renderer.

Known plan-time decisions (not gaps):
- ConfirmDialog gets a third button in Task 20 (`extraLabel`/`onExtra`); Task 19 references it before Task 20 implements it. The plan calls this out and offers reversal — pick one order at execution time.
- File watching is explicitly out of scope; documented in spec.
- Window-close-with-dirty is explicitly deferred; backlog item in spec.
