# Right Toolbar + Skills Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flush full-height slim toolbar on the right edge of the CodeSpace window with multiple tool icons. Clicking the Skills icon opens a resizable full-height floating panel beside the toolbar showing `~/.claude/commands/*.md` entries. Users drag skill cards onto any terminal to inject the prompt body into that PTY.

**Architecture:** Toolbar is a permanent 40px-wide flex child rendered after `.body-main` in `App.jsx`. The Skills panel is **floating** (position: absolute) anchored to the toolbar's inside edge — it overlays the terminal grid without pushing layout. Skills are read from `~/.claude/commands/` in the main process via a new `src/main/skills-fs.js` module, surfaced through `electronAPI.skills.*`, and hot-reloaded via a `node:fs.watch` subscription. Drag/drop reuses the existing pane drop handler in `TerminalPane.jsx` with a new MIME type `application/x-codespace-skill`. Panel width is persisted to `localStorage`.

**Tech Stack:** Electron + React 18 + electron-vite, vitest + jsdom + @testing-library/react for tests, `node:fs.watch` (built-in) for hot reload, no new runtime dependencies.

**Supersedes:** `docs/superpowers/specs/2026-05-17-slash-commands-design.md` (v1 floating-pill design). The v2 mockups live at `.superpowers/brainstorm/45651-1778960893/v2-right-toolbar.html`.

## Design decisions locked in

| Decision | Choice |
|---|---|
| Toolbar shape | Flush 40px column on the right edge, full window height, **not** a floating pill |
| Toolbar icons | Skills, `/` commands (stub), Editor (stub), Search (stub); Settings docked at bottom |
| Panel anchor | Floating, full-height, anchored to the toolbar's inside edge |
| Panel open style | Overlay (no layout shift) — terminal grid stays full size and dims to opacity ~0.55 |
| Active icon affordance | Cyan tint background + cyan rail (2px) on the icon's **left** edge (mirrors how the workspace sidebar marks the active workspace) |
| Close interactions | Click ✕, click the active toolbar icon a second time. **No click-outside-to-close** — needed so users can drag skills onto terminals without the panel disappearing |
| Panel resize | Drag the panel's left edge to widen. Min 220px, max 50% of body width |
| Width persistence | `localStorage['cs-skills-panel-width']` |
| Source dir | `~/.claude/commands/*.md` (resolved via `os.homedir()`; no recursion) |
| File format | Plain markdown. Optional YAML-ish frontmatter `description:` field used as the card subtitle. Filename without `.md` becomes the displayed name |
| Drop payload type | `application/x-codespace-skill` carrying the full file body |
| Apply on drop | `ptyPool.writePty(ptyId, body)` — same mechanism the existing OS file-drop already uses |
| Hot reload | `node:fs.watch(commandsDir, { persistent: true, recursive: false })`, debounced 200ms → re-emit `skills:changed` IPC |

## File structure

**Create (main process):**
- `src/main/skills-fs.js` — pure FS module: `getCommandsDir()`, `listSkills()`, `readSkillBody(absPath)`, `createSkill(name, body)`, `watchSkills(callback)`, `parseFrontmatter(text)`. Returns `{ ok, ... }` shaped results to match the existing `editor-fs.js` style.

**Create (renderer):**
- `src/renderer/components/RightToolbar.jsx` + `RightToolbar.css` — slim 40px column with icon buttons, active rail indicator, settings docked at bottom.
- `src/renderer/components/SkillsPanel.jsx` + `SkillsPanel.css` — floating full-height panel: header, filter input, scrollable cards, footer, inline new-skill form.
- `src/renderer/components/SkillsPanelResizer.jsx` + `SkillsPanelResizer.css` — left-edge drag handle (mirror of `EditorResizer` but the drag flips because the panel grows leftward).
- `src/renderer/skills-state.js` — small util: `loadPanelWidth()`, `savePanelWidth(px)`, `clampPanelWidth(px, bodyWidth)`, constants.

**Create (tests):**
- `tests/main/skills-fs.test.js` — list, frontmatter parse, create, edge cases.
- `tests/renderer/SkillsPanel.test.jsx` — renders, filter, drag start, close.
- `tests/renderer/RightToolbar.test.jsx` — renders icons, active state, click fires handler.

**Modify:**
- `src/main/ipc-handlers.js` — add `skills:list`, `skills:read`, `skills:create`, `skills:revealDir`, push `skills:changed` events. Register/dispose watcher.
- `src/preload/index.js` — add `electronAPI.skills.*` surface and `onSkillsChanged` subscription helper.
- `src/renderer/App.jsx` — render `RightToolbar` + `SkillsPanel`, manage `activePanel` + `panelWidth` state.
- `src/renderer/App.css` — flex-row body with toolbar as last child; ensure `.body-main` is `position: relative` so the floating panel anchors correctly.
- `src/renderer/components/TerminalPane.jsx` — extend `handleDragOver` and `handleDrop` to recognize `application/x-codespace-skill` and write the body to the PTY.

---

## Task 1: Main process — `skills-fs.js` list + frontmatter parse

**Files:**
- Create: `src/main/skills-fs.js`
- Create: `tests/main/skills-fs.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/main/skills-fs.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, parseFrontmatter, readSkillBody } from '../../src/main/skills-fs.js'

let TMP

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cs-skills-test-'))
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('parseFrontmatter', () => {
  it('returns body when no frontmatter is present', () => {
    const r = parseFrontmatter('Just a body\nsecond line')
    expect(r.description).toBe(null)
    expect(r.body).toBe('Just a body\nsecond line')
  })

  it('extracts description and strips frontmatter from body', () => {
    const src = '---\ndescription: Refactor selected code\n---\nClean up this code'
    const r = parseFrontmatter(src)
    expect(r.description).toBe('Refactor selected code')
    expect(r.body).toBe('Clean up this code')
  })

  it('uses the first non-empty body line as description when no frontmatter', () => {
    const r = parseFrontmatter('\n\nFirst real line\nsecond')
    expect(r.description).toBe('First real line')
    expect(r.body).toBe('First real line\nsecond')
  })
})

describe('listSkills', () => {
  it('returns empty array when directory does not exist', async () => {
    const r = await listSkills(join(TMP, 'nope'))
    expect(r.ok).toBe(true)
    expect(r.skills).toEqual([])
  })

  it('lists .md files sorted by name', async () => {
    writeFileSync(join(TMP, 'zebra.md'), 'Z body')
    writeFileSync(join(TMP, 'alpha.md'), 'A body')
    writeFileSync(join(TMP, 'README.txt'), 'not a skill')
    const r = await listSkills(TMP)
    expect(r.ok).toBe(true)
    expect(r.skills.map(s => s.name)).toEqual(['alpha', 'zebra'])
    expect(r.skills[0].filePath).toBe(join(TMP, 'alpha.md'))
  })

  it('reads description from frontmatter when present', async () => {
    writeFileSync(join(TMP, 'review.md'), '---\ndescription: Find bugs\n---\nFull body here')
    const r = await listSkills(TMP)
    expect(r.skills[0].description).toBe('Find bugs')
  })

  it('skips entries that are not regular files (subdirs etc.)', async () => {
    mkdirSync(join(TMP, 'sub.md'))  // a directory named like a md file
    writeFileSync(join(TMP, 'real.md'), 'body')
    const r = await listSkills(TMP)
    expect(r.skills.map(s => s.name)).toEqual(['real'])
  })
})

describe('readSkillBody', () => {
  it('returns the full file content stripped of frontmatter', async () => {
    const p = join(TMP, 'x.md')
    writeFileSync(p, '---\ndescription: x\n---\nThe full prompt body')
    const r = await readSkillBody(p)
    expect(r.ok).toBe(true)
    expect(r.body).toBe('The full prompt body')
  })

  it('returns error when file is missing', async () => {
    const r = await readSkillBody(join(TMP, 'missing.md'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/skills-fs.test.js`
Expected: FAIL — module `../../src/main/skills-fs.js` does not exist.

- [ ] **Step 3: Implement `skills-fs.js`**

Create `src/main/skills-fs.js`:

```javascript
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { existsSync, watch as nodeWatch } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function getCommandsDir() {
  return join(homedir(), '.claude', 'commands')
}

export function parseFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE)
  if (!m) {
    const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) ?? null
    return { description: firstLine, body: text }
  }
  const block = m[1]
  let description = null
  for (const line of block.split(/\r?\n/)) {
    const dm = line.match(/^\s*description\s*:\s*(.*?)\s*$/i)
    if (dm) { description = dm[1]; break }
  }
  const body = text.slice(m[0].length)
  return { description, body }
}

export async function listSkills(dir = getCommandsDir()) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return { ok: false, reason: 'invalid-dir', skills: [] }
  }
  let entries
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, skills: [] }
    return { ok: false, reason: 'denied', message: err?.message, skills: [] }
  }
  const out = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.md')) continue
    const filePath = join(dir, entry)
    let st
    try { st = await stat(filePath) } catch { continue }
    if (!st.isFile()) continue
    let text = ''
    try { text = await readFile(filePath, 'utf8') } catch { continue }
    const { description } = parseFrontmatter(text)
    out.push({
      name: entry.slice(0, -3),
      description,
      filePath
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: true, skills: out }
}

export async function readSkillBody(absPath) {
  if (typeof absPath !== 'string' || !isAbsolute(absPath)) {
    return { ok: false, reason: 'invalid-path' }
  }
  let text
  try { text = await readFile(absPath, 'utf8') }
  catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'not-found' }
    return { ok: false, reason: 'denied', message: err?.message }
  }
  const { body } = parseFrontmatter(text)
  return { ok: true, body }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/skills-fs.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/skills-fs.js tests/main/skills-fs.test.js
git commit -m "feat: add skills-fs module for listing/reading ~/.claude/commands"
```

---

## Task 2: Main process — `skills-fs.js` create + watcher

**Files:**
- Modify: `src/main/skills-fs.js`
- Modify: `tests/main/skills-fs.test.js`

- [ ] **Step 1: Add failing tests for create + sanitize**

Append to `tests/main/skills-fs.test.js`:

```javascript
import { createSkill, sanitizeSkillName } from '../../src/main/skills-fs.js'
import { readFileSync, existsSync as fsExistsSync } from 'node:fs'

describe('sanitizeSkillName', () => {
  it('lowercases and replaces whitespace with hyphens', () => {
    expect(sanitizeSkillName(' Hello World ')).toBe('hello-world')
  })
  it('strips disallowed characters', () => {
    expect(sanitizeSkillName('foo/bar:baz*.md')).toBe('foobarbaz')
  })
  it('returns empty string when no valid characters remain', () => {
    expect(sanitizeSkillName('/// ')).toBe('')
  })
  it('passes through valid kebab-case names', () => {
    expect(sanitizeSkillName('refactor-code_v2')).toBe('refactor-code_v2')
  })
})

describe('createSkill', () => {
  it('writes a new .md file with the given body', async () => {
    const r = await createSkill('my-skill', 'do the thing', TMP)
    expect(r.ok).toBe(true)
    expect(r.filePath).toBe(join(TMP, 'my-skill.md'))
    expect(readFileSync(r.filePath, 'utf8')).toBe('do the thing')
  })

  it('refuses an empty sanitized name', async () => {
    const r = await createSkill('///', 'body', TMP)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-name')
  })

  it('refuses to overwrite an existing skill', async () => {
    writeFileSync(join(TMP, 'dup.md'), 'old')
    const r = await createSkill('dup', 'new', TMP)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('exists')
    expect(readFileSync(join(TMP, 'dup.md'), 'utf8')).toBe('old')
  })

  it('creates the commands directory if it does not exist', async () => {
    const sub = join(TMP, 'fresh')
    const r = await createSkill('first', 'body', sub)
    expect(r.ok).toBe(true)
    expect(fsExistsSync(join(sub, 'first.md'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/skills-fs.test.js`
Expected: FAIL — `createSkill` and `sanitizeSkillName` are not exported.

- [ ] **Step 3: Implement `sanitizeSkillName`, `createSkill`, `watchSkills`**

Append to `src/main/skills-fs.js`:

```javascript
const NAME_INVALID_RE = /[^a-zA-Z0-9_-]/g

export function sanitizeSkillName(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, '-').replace(NAME_INVALID_RE, '').toLowerCase()
}

export async function createSkill(name, body, dir = getCommandsDir()) {
  const safe = sanitizeSkillName(name)
  if (safe.length === 0) return { ok: false, reason: 'invalid-name' }
  if (typeof body !== 'string') return { ok: false, reason: 'invalid-body' }
  if (!existsSync(dir)) {
    try { await mkdir(dir, { recursive: true }) }
    catch (err) { return { ok: false, reason: 'denied', message: err?.message } }
  }
  const filePath = join(dir, `${safe}.md`)
  if (existsSync(filePath)) return { ok: false, reason: 'exists', filePath }
  try {
    await writeFile(filePath, body, 'utf8')
    return { ok: true, filePath, name: safe }
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message }
  }
}

export function watchSkills(callback, dir = getCommandsDir()) {
  // Returns a disposer. The watcher tolerates a missing directory by polling
  // for its creation; once it exists we attach a real fs.watch.
  let watcher = null
  let pollTimer = null
  let debounceTimer = null
  let disposed = false

  const fire = () => {
    if (disposed) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { if (!disposed) callback() }, 200)
  }

  const attach = () => {
    if (disposed || watcher) return
    try {
      watcher = nodeWatch(dir, { persistent: true, recursive: false }, (event, filename) => {
        if (!filename || filename.toLowerCase().endsWith('.md')) fire()
      })
      watcher.on('error', () => {
        try { watcher.close() } catch {}
        watcher = null
        if (!disposed) pollTimer = setTimeout(attach, 1000)
      })
    } catch {
      watcher = null
      if (!disposed) pollTimer = setTimeout(attach, 1000)
    }
  }

  if (existsSync(dir)) attach()
  else pollTimer = setInterval(() => { if (existsSync(dir)) { clearInterval(pollTimer); pollTimer = null; attach() } }, 1000)

  return () => {
    disposed = true
    clearTimeout(debounceTimer)
    clearInterval(pollTimer)
    clearTimeout(pollTimer)
    if (watcher) { try { watcher.close() } catch {} }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/skills-fs.test.js`
Expected: PASS, 16 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/main/skills-fs.js tests/main/skills-fs.test.js
git commit -m "feat: add createSkill + watchSkills with sanitization and ENOENT-safe watcher"
```

---

## Task 3: Wire IPC handlers + preload surface

**Files:**
- Modify: `src/main/ipc-handlers.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add imports and register skills handlers in `ipc-handlers.js`**

In `src/main/ipc-handlers.js`, add to the import block at top:

```javascript
import * as skillsFs from './skills-fs.js'
```

Inside `registerHandlers(mainWindow)`, after the `editor:*` handlers (around line 95, before the `shell:openExternal` handler), add:

```javascript
  // ── Skills (slash commands from ~/.claude/commands/*.md) ────────────────
  let skillsWatcherDispose = null

  ipcMain.handle('skills:list',  async () => skillsFs.listSkills())
  ipcMain.handle('skills:read',  async (_e, absPath) => {
    if (typeof absPath !== 'string' || !isAbsolute(absPath)) return { ok: false, reason: 'invalid-path' }
    return skillsFs.readSkillBody(absPath)
  })
  ipcMain.handle('skills:create', async (_e, args) => {
    if (!args || typeof args.name !== 'string' || typeof args.body !== 'string') {
      return { ok: false, reason: 'invalid-args' }
    }
    return skillsFs.createSkill(args.name, args.body)
  })
  ipcMain.on('skills:revealDir', () => {
    try { shell.openPath(skillsFs.getCommandsDir()) } catch {}
  })

  ipcMain.on('skills:startWatch', () => {
    if (skillsWatcherDispose) return
    skillsWatcherDispose = skillsFs.watchSkills(() => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send('skills:changed')
    })
  })
  ipcMain.on('skills:stopWatch', () => {
    if (skillsWatcherDispose) { try { skillsWatcherDispose() } catch {} ; skillsWatcherDispose = null }
  })
```

Then update the `webContents.on('destroyed', ...)` block at the bottom of the function to also dispose the watcher:

```javascript
  mainWindow.webContents.on('destroyed', () => {
    if (skillsWatcherDispose) { try { skillsWatcherDispose() } catch {} ; skillsWatcherDispose = null }
    for (const ptyId of Array.from(ptyDisposables.keys())) {
      disposeFor(ptyId)
    }
  })
```

- [ ] **Step 2: Add the preload surface**

In `src/preload/index.js`, inside the `api` object after the `editor: { ... }` block, add:

```javascript
  skills: {
    list:       () => ipcRenderer.invoke('skills:list'),
    read:       (absPath) => ipcRenderer.invoke('skills:read', absPath),
    create:     (args) => ipcRenderer.invoke('skills:create', args),
    revealDir:  () => ipcRenderer.send('skills:revealDir'),
    startWatch: () => ipcRenderer.send('skills:startWatch'),
    stopWatch:  () => ipcRenderer.send('skills:stopWatch'),
    onChanged:  (callback) => {
      const handler = () => callback()
      ipcRenderer.on('skills:changed', handler)
      return () => ipcRenderer.removeListener('skills:changed', handler)
    }
  },
```

- [ ] **Step 3: Manual smoke test from the renderer console**

Run: `npm run dev` and open DevTools in the renderer (Ctrl+Shift+I).

Paste in the console:
```javascript
await window.electronAPI.skills.list()
```

Expected: `{ ok: true, skills: [...] }` (empty array if `~/.claude/commands/` doesn't exist, otherwise populated).

Then:
```javascript
const off = window.electronAPI.skills.onChanged(() => console.log('skills changed!'))
window.electronAPI.skills.startWatch()
```

In another terminal, create a test file: `echo "test" > ~/.claude/commands/test-skill.md` (or PowerShell equivalent). The console should log `skills changed!` within ~200ms.

Cleanup: `off(); window.electronAPI.skills.stopWatch()`

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.js src/preload/index.js
git commit -m "feat: expose skills IPC surface (list/read/create/watch)"
```

---

## Task 4: `RightToolbar` component shell

**Files:**
- Create: `src/renderer/components/RightToolbar.jsx`
- Create: `src/renderer/components/RightToolbar.css`
- Create: `tests/renderer/RightToolbar.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `tests/renderer/RightToolbar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RightToolbar from '../../src/renderer/components/RightToolbar.jsx'

describe('RightToolbar', () => {
  it('renders the Skills icon button', () => {
    render(<RightToolbar activePanel={null} onSelectPanel={() => {}} onOpenSettings={() => {}} />)
    expect(screen.getByRole('button', { name: /skills/i })).toBeTruthy()
  })

  it('marks the active panel button with aria-pressed=true', () => {
    render(<RightToolbar activePanel="skills" onSelectPanel={() => {}} onOpenSettings={() => {}} />)
    const btn = screen.getByRole('button', { name: /skills/i })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('fires onSelectPanel with "skills" when the Skills icon is clicked', async () => {
    const onSelect = vi.fn()
    render(<RightToolbar activePanel={null} onSelectPanel={onSelect} onOpenSettings={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /skills/i }))
    expect(onSelect).toHaveBeenCalledWith('skills')
  })

  it('passes the same panel id again when clicking the already-active icon (toggle close)', async () => {
    const onSelect = vi.fn()
    render(<RightToolbar activePanel="skills" onSelectPanel={onSelect} onOpenSettings={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /skills/i }))
    // App.jsx is responsible for interpreting "click active → close"; the
    // toolbar's job is to fire the same id so the parent can compare.
    expect(onSelect).toHaveBeenCalledWith('skills')
  })

  it('renders the Settings button at the bottom and fires onOpenSettings', async () => {
    const onSettings = vi.fn()
    render(<RightToolbar activePanel={null} onSelectPanel={() => {}} onOpenSettings={onSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(onSettings).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/RightToolbar.test.jsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `RightToolbar.jsx`**

Create `src/renderer/components/RightToolbar.jsx`:

```jsx
import './RightToolbar.css'

const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 2l2.39 7.36H22l-6.19 4.49L18.2 21 12 16.51 5.8 21l2.39-7.15L2 9.36h7.61z"/>
  </svg>
)

const SlashIcon = () => (
  <span aria-hidden style={{ fontFamily: 'var(--cs-font-mono)', fontSize: 15, fontWeight: 700, lineHeight: 1 }}>/</span>
)

const FileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
)

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const PANELS = [
  { id: 'skills',   label: 'Skills',         icon: SparkleIcon, enabled: true  },
  { id: 'commands', label: 'Slash commands', icon: SlashIcon,   enabled: false },
  { id: 'editor',   label: 'Editor',         icon: FileIcon,    enabled: false },
  { id: 'search',   label: 'Search',         icon: SearchIcon,  enabled: false },
]

export default function RightToolbar({ activePanel, onSelectPanel, onOpenSettings }) {
  return (
    <div className="right-toolbar" role="toolbar" aria-orientation="vertical" aria-label="Tools">
      {PANELS.map(p => {
        const Icon = p.icon
        const isActive = activePanel === p.id
        return (
          <button
            key={p.id}
            type="button"
            className={`right-toolbar-btn${isActive ? ' is-active' : ''}${p.enabled ? '' : ' is-stub'}`}
            title={p.enabled ? p.label : `${p.label} (coming soon)`}
            aria-label={p.label}
            aria-pressed={isActive}
            disabled={!p.enabled}
            onClick={() => p.enabled && onSelectPanel(p.id)}
          >
            <Icon />
          </button>
        )
      })}
      <div className="right-toolbar-spacer" />
      <button
        type="button"
        className="right-toolbar-btn"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Implement `RightToolbar.css`**

Create `src/renderer/components/RightToolbar.css`:

```css
.right-toolbar {
  width: 40px;
  flex-shrink: 0;
  background: var(--cs-bg-elevated);
  border-left: 1px solid var(--cs-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  z-index: 30;
}

.right-toolbar-btn {
  position: relative;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--cs-icon-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background var(--cs-transition), border-color var(--cs-transition), color var(--cs-transition);
}

.right-toolbar-btn:hover:not(:disabled) {
  background: var(--cs-bg-hover);
  color: var(--cs-icon-secondary);
}

.right-toolbar-btn.is-active {
  background: rgba(103, 232, 249, 0.08);
  border-color: var(--cs-cyan);
  color: var(--cs-cyan);
}

.right-toolbar-btn.is-active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 1px;
  background: var(--cs-cyan);
}

.right-toolbar-btn.is-stub,
.right-toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.right-toolbar-spacer {
  flex: 1;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/RightToolbar.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/RightToolbar.jsx src/renderer/components/RightToolbar.css tests/renderer/RightToolbar.test.jsx
git commit -m "feat: add RightToolbar component (Skills active, others stubbed)"
```

---

## Task 5: Integrate `RightToolbar` into `App.jsx`

**Files:**
- Modify: `src/renderer/App.jsx`
- Modify: `src/renderer/App.css`

- [ ] **Step 1: Add import and state to `App.jsx`**

In `src/renderer/App.jsx`, add the import at the top with the other component imports:

```javascript
import RightToolbar from './components/RightToolbar.jsx'
```

Inside `AppInner()`, alongside the existing `useState` declarations (around line 98), add:

```javascript
  const [activePanel, setActivePanel] = useState(null) // null | 'skills'
```

Add the handler near `openPicker`/`closePicker`:

```javascript
  const handleSelectPanel = useCallback((panelId) => {
    setActivePanel(prev => prev === panelId ? null : panelId)
  }, [])
```

- [ ] **Step 2: Render the toolbar inside `.app-body`**

In `App.jsx`, find the existing `.app-body` block (around line 862). Wrap so `RightToolbar` becomes the **last** child of `.app-body`, after the `.body-main` div but inside `.app-body`:

```jsx
      <div className={`app-body${anyFullscreen ? ' is-fullscreen' : ''}`} ref={appBodyRef}>
        <Sidebar
          /* ... unchanged ... */
        />
        <div className={`body-main${fsTerminalId ? ' fs-terminal' : ''}${fsEditor ? ' fs-editor' : ''}`}>
          {/* ... unchanged grid-wrap + editor ... */}
        </div>
        <RightToolbar
          activePanel={activePanel}
          onSelectPanel={handleSelectPanel}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>
```

- [ ] **Step 3: Make `.body-main` a positioning context for the upcoming floating panel**

In `src/renderer/App.css`, update the `.body-main` rule:

```css
.body-main {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  background: var(--cs-bg-base);
  position: relative;  /* anchors the floating Skills panel (added in Task 7) */
}
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`. Verify:
- A 40px column appears flush against the right edge of the window
- Skills icon (sparkle) is active-colored when clicked, dimmed when clicked again
- `/`, file, search icons are visibly disabled (low opacity, not-allowed cursor)
- Settings icon at the bottom opens the existing settings modal
- Terminal grid still fills the remaining width

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx src/renderer/App.css
git commit -m "feat: integrate RightToolbar into App shell"
```

---

## Task 6: `SkillsPanel` component (skeleton)

**Files:**
- Create: `src/renderer/components/SkillsPanel.jsx`
- Create: `src/renderer/components/SkillsPanel.css`
- Create: `tests/renderer/SkillsPanel.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `tests/renderer/SkillsPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SkillsPanel from '../../src/renderer/components/SkillsPanel.jsx'

const SKILLS = [
  { name: 'refactor', description: 'Clean up code', filePath: '/u/.claude/commands/refactor.md' },
  { name: 'review',   description: 'Find bugs',    filePath: '/u/.claude/commands/review.md' },
  { name: 'tests',    description: null,           filePath: '/u/.claude/commands/tests.md' },
]

const baseProps = {
  width: 260,
  loadState: 'content',
  skills: SKILLS,
  onClose: () => {},
  onCreate: () => {},
  onRevealDir: () => {},
}

describe('SkillsPanel', () => {
  it('renders one card per skill in alphabetical order', () => {
    render(<SkillsPanel {...baseProps} />)
    const names = screen.getAllByTestId('skill-name').map(el => el.textContent)
    expect(names).toEqual(['refactor', 'review', 'tests'])
  })

  it('renders description when present and a placeholder when missing', () => {
    render(<SkillsPanel {...baseProps} />)
    expect(screen.getByText('Clean up code')).toBeTruthy()
    expect(screen.getByText('Find bugs')).toBeTruthy()
    // 'tests' has no description — confirm the card still renders
    const testsCard = screen.getAllByTestId('skill-card')[2]
    expect(testsCard.textContent).toMatch(/tests/)
  })

  it('filters cards by the filter input value (case-insensitive substring)', async () => {
    render(<SkillsPanel {...baseProps} />)
    await userEvent.type(screen.getByPlaceholderText(/filter/i), 'rev')
    const names = screen.getAllByTestId('skill-name').map(el => el.textContent)
    expect(names).toEqual(['review'])
  })

  it('calls onClose when the ✕ button is clicked', async () => {
    const onClose = vi.fn()
    render(<SkillsPanel {...baseProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close skills/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a loading shimmer when loadState is "loading"', () => {
    render(<SkillsPanel {...baseProps} loadState="loading" skills={[]} />)
    expect(screen.getByTestId('skills-loading')).toBeTruthy()
  })

  it('renders an empty state when loadState is "content" and skills is empty', () => {
    render(<SkillsPanel {...baseProps} skills={[]} />)
    expect(screen.getByText(/no skills yet/i)).toBeTruthy()
  })

  it('shows the source path and count in the footer', () => {
    render(<SkillsPanel {...baseProps} sourcePath="~/.claude/commands/" />)
    expect(screen.getByText(/~\/\.claude\/commands\//)).toBeTruthy()
    expect(screen.getByText(/3 skills/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/SkillsPanel.test.jsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `SkillsPanel.jsx`**

Create `src/renderer/components/SkillsPanel.jsx`:

```jsx
import { useMemo, useState } from 'react'
import './SkillsPanel.css'

export default function SkillsPanel({
  width,
  loadState,         // 'loading' | 'content' | 'error'
  skills,
  sourcePath,
  onClose,
  onCreate,
  onRevealDir,
}) {
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    )
  }, [skills, filter])

  return (
    <aside
      className="skills-panel"
      style={{ width: `${width}px` }}
      role="complementary"
      aria-label="Skills"
    >
      <header className="skills-panel-header">
        <div className="skills-panel-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cs-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 2l2.39 7.36H22l-6.19 4.49L18.2 21 12 16.51 5.8 21l2.39-7.15L2 9.36h7.61z"/>
          </svg>
          <span>Skills</span>
        </div>
        <div className="skills-panel-actions">
          <button type="button" className="skills-panel-newbtn" onClick={onCreate}>+ new</button>
          <button type="button" className="skills-panel-closebtn" aria-label="Close Skills" onClick={onClose}>✕</button>
        </div>
      </header>

      <div className="skills-panel-filter">
        <input
          type="text"
          placeholder="Filter skills…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="skills-panel-body">
        {loadState === 'loading' && (
          <div className="skills-panel-loading" data-testid="skills-loading">
            <div className="skills-panel-loading-bar" />
          </div>
        )}

        {loadState === 'content' && visible.length === 0 && skills.length === 0 && (
          <div className="skills-panel-empty">
            <p className="skills-panel-empty-title">No skills yet</p>
            <p className="skills-panel-empty-hint">Create one with <strong>+ new</strong>, or add an <code>.md</code> file to <code>~/.claude/commands/</code></p>
          </div>
        )}

        {loadState === 'content' && visible.length === 0 && skills.length > 0 && (
          <div className="skills-panel-empty">
            <p className="skills-panel-empty-title">No matches</p>
          </div>
        )}

        {loadState === 'content' && visible.length > 0 && (
          <ul className="skills-panel-list">
            {visible.map(skill => (
              <li
                key={skill.filePath}
                className="skills-panel-card"
                data-testid="skill-card"
                draggable={true}
                onDragStart={e => {
                  e.dataTransfer.setData('application/x-codespace-skill', skill.filePath)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <div className="skills-panel-card-row">
                  <span className="skills-panel-card-name" data-testid="skill-name">{skill.name}</span>
                  <span className="skills-panel-card-grip" aria-hidden>⠿</span>
                </div>
                {skill.description && (
                  <div className="skills-panel-card-desc">{skill.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="skills-panel-footer">
        <button
          type="button"
          className="skills-panel-footer-path"
          onClick={onRevealDir}
          title="Open in file explorer"
        >
          {sourcePath ?? '~/.claude/commands/'}
        </button>
        <span className="skills-panel-footer-count">
          {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
        </span>
      </footer>
    </aside>
  )
}
```

- [ ] **Step 4: Implement `SkillsPanel.css`**

Create `src/renderer/components/SkillsPanel.css`:

```css
.skills-panel {
  position: absolute;
  top: 6px;
  bottom: 6px;
  right: 6px;
  background: var(--cs-bg-elevated);
  border: 1px solid var(--cs-border-hover);
  border-radius: var(--cs-radius);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(103, 232, 249, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 25;
  animation: scaleIn 0.2s ease both;
  min-width: 220px;
}

.skills-panel-header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--cs-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.skills-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--cs-text-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.skills-panel-actions { display: flex; align-items: center; gap: 6px; }

.skills-panel-newbtn {
  background: transparent;
  border: 1px solid var(--cs-border-hover);
  border-radius: 4px;
  padding: 3px 8px;
  color: var(--cs-cyan);
  font-family: var(--cs-font-mono);
  font-size: 10px;
  cursor: pointer;
  transition: background var(--cs-transition), border-color var(--cs-transition);
}
.skills-panel-newbtn:hover {
  background: rgba(103, 232, 249, 0.06);
  border-color: var(--cs-cyan);
}

.skills-panel-closebtn {
  background: transparent;
  border: none;
  color: var(--cs-text-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}
.skills-panel-closebtn:hover {
  background: var(--cs-red-hover-bg);
  color: var(--cs-red-hover-fg);
}

.skills-panel-filter {
  padding: 8px 10px;
  border-bottom: 1px solid var(--cs-border);
  flex-shrink: 0;
}
.skills-panel-filter input {
  width: 100%;
  background: var(--cs-bg-base);
  border: 1px solid var(--cs-border);
  border-radius: 5px;
  padding: 5px 8px;
  color: var(--cs-text-secondary);
  font-family: var(--cs-font-ui);
  font-size: 11px;
  outline: none;
  transition: border-color var(--cs-transition);
}
.skills-panel-filter input:focus { border-color: var(--cs-border-hover); }

.skills-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  position: relative;
}

.skills-panel-loading {
  position: relative;
  height: 2px;
  margin: 4px 0;
}
.skills-panel-loading-bar {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, var(--cs-cyan) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: editor-shimmer 0.6s linear infinite;
}

.skills-panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 8px;
  text-align: center;
}
.skills-panel-empty-title {
  font-family: var(--cs-font-ui);
  font-size: 12px;
  color: var(--cs-text-tertiary);
}
.skills-panel-empty-hint {
  font-family: var(--cs-font-ui);
  font-size: 11px;
  color: var(--cs-text-muted);
  line-height: 1.6;
}
.skills-panel-empty-hint code {
  font-family: var(--cs-font-mono);
  font-size: 10px;
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
}

.skills-panel-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.skills-panel-card {
  background: var(--cs-bg-surface);
  border: 1px solid var(--cs-border-hover);
  border-radius: 6px;
  padding: 8px 9px;
  cursor: grab;
  transition: border-color var(--cs-transition), background var(--cs-transition);
}
.skills-panel-card:hover {
  border-color: var(--cs-cyan);
  background: rgba(103, 232, 249, 0.03);
}
.skills-panel-card:active { cursor: grabbing; }

.skills-panel-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
}
.skills-panel-card-name {
  color: var(--cs-cyan);
  font-family: var(--cs-font-mono);
  font-size: 11px;
  font-weight: 600;
}
.skills-panel-card-grip {
  color: var(--cs-text-dim);
  font-size: 11px;
}
.skills-panel-card-desc {
  color: var(--cs-text-tertiary);
  font-family: var(--cs-font-ui);
  font-size: 10.5px;
  line-height: 1.45;
}

.skills-panel-footer {
  padding: 7px 12px;
  border-top: 1px solid var(--cs-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.skills-panel-footer-path {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--cs-text-muted);
  font-family: var(--cs-font-mono);
  font-size: 9.5px;
  text-decoration: none;
  transition: color var(--cs-transition);
}
.skills-panel-footer-path:hover { color: var(--cs-text-tertiary); }

.skills-panel-footer-count {
  color: var(--cs-text-dim);
  font-family: var(--cs-font-mono);
  font-size: 9.5px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/SkillsPanel.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/SkillsPanel.jsx src/renderer/components/SkillsPanel.css tests/renderer/SkillsPanel.test.jsx
git commit -m "feat: add SkillsPanel component skeleton with filter and states"
```

---

## Task 7: Wire `SkillsPanel` to IPC (load on open, hot reload)

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Add skills state to `App.jsx`**

Inside `AppInner()`, alongside `activePanel`, add:

```javascript
  const [skillsLoadState, setSkillsLoadState] = useState('loading') // 'loading' | 'content' | 'error'
  const [skills, setSkills] = useState([])
```

- [ ] **Step 2: Add a load effect that runs when the panel opens**

Inside `AppInner()`, alongside other effects, add:

```javascript
  // Load skills + subscribe to changes while the Skills panel is open.
  useEffect(() => {
    if (activePanel !== 'skills') return
    let cancelled = false
    const load = () => {
      setSkillsLoadState(prev => (prev === 'content' ? prev : 'loading'))
      window.electronAPI.skills.list().then(r => {
        if (cancelled) return
        if (r?.ok) { setSkills(r.skills); setSkillsLoadState('content') }
        else { setSkills([]); setSkillsLoadState('error') }
      }).catch(() => {
        if (!cancelled) setSkillsLoadState('error')
      })
    }
    load()
    window.electronAPI.skills.startWatch()
    const off = window.electronAPI.skills.onChanged(load)
    return () => {
      cancelled = true
      off()
      window.electronAPI.skills.stopWatch()
    }
  }, [activePanel])
```

- [ ] **Step 3: Render `SkillsPanel` inside `.body-main`**

Add the import at the top:

```javascript
import SkillsPanel from './components/SkillsPanel.jsx'
```

Inside `.body-main`, **after** the editor block (and the closing `</> )` of that fragment), add the panel render so it floats inside the `.body-main` positioning context. Use a fixed default width of 260 for now — the resizer comes in Task 10:

```jsx
          {activePanel === 'skills' && (
            <SkillsPanel
              width={260}
              loadState={skillsLoadState}
              skills={skills}
              sourcePath="~/.claude/commands/"
              onClose={() => setActivePanel(null)}
              onCreate={() => { /* wired in Task 11 */ }}
              onRevealDir={() => window.electronAPI.skills.revealDir()}
            />
          )}
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`. Verify:
- Click Skills icon → panel slides in (scaleIn animation), starts in loading state, then shows your skills (or empty state if `~/.claude/commands/` is empty).
- Click Skills icon again → panel closes.
- Click ✕ inside the panel → panel closes.
- Click footer path → opens `~/.claude/commands/` in file explorer.
- With the panel open, create a new file `~/.claude/commands/zzz-test.md` from your shell. Within ~200ms the panel should re-render with the new entry (no manual refresh needed).
- Click on a terminal pane through the panel area — clicks pass through where there's no panel; clicks **on** the panel are absorbed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat: load skills + hot-reload while panel is open"
```

---

## Task 8: Drag source — skill cards write the body to the drop payload

**Files:**
- Modify: `src/renderer/components/SkillsPanel.jsx`

In Task 6 the card sets the **file path** in the drag payload. To avoid a second async round-trip on drop, prefetch each skill's body when the list loads OR read it lazily on `dragstart`. Lazy is simpler and keeps the list lightweight.

- [ ] **Step 1: Add an async dragstart that reads the body before the drop fires**

The issue: `dragstart` is synchronous; we can't `await` inside it. Solution: at panel-load time, alongside `setSkills`, prefetch each skill's body once. Cached in state alongside the skills list.

Update the load effect in `App.jsx` (Task 7, Step 2) so it also reads bodies in parallel:

```javascript
    const load = () => {
      setSkillsLoadState(prev => (prev === 'content' ? prev : 'loading'))
      window.electronAPI.skills.list().then(async (r) => {
        if (cancelled) return
        if (!r?.ok) { setSkills([]); setSkillsLoadState('error'); return }
        const withBodies = await Promise.all(r.skills.map(async s => {
          const b = await window.electronAPI.skills.read(s.filePath).catch(() => ({ ok: false }))
          return { ...s, body: b?.ok ? b.body : '' }
        }))
        if (cancelled) return
        setSkills(withBodies)
        setSkillsLoadState('content')
      }).catch(() => {
        if (!cancelled) setSkillsLoadState('error')
      })
    }
```

- [ ] **Step 2: Update `SkillsPanel` dragstart to put the body in the payload**

In `src/renderer/components/SkillsPanel.jsx`, change the `onDragStart` on the card `<li>`:

```jsx
              onDragStart={e => {
                e.dataTransfer.setData('application/x-codespace-skill', skill.body ?? '')
                e.dataTransfer.setData('application/x-codespace-skill-name', skill.name)
                e.dataTransfer.effectAllowed = 'copy'
              }}
```

- [ ] **Step 3: Add a test for the dragstart payload**

Append to `tests/renderer/SkillsPanel.test.jsx`:

```jsx
  it('sets the skill body on the drag payload', () => {
    const skill = { name: 'refactor', description: 'x', filePath: '/x/refactor.md', body: 'Clean up this code' }
    render(<SkillsPanel {...baseProps} skills={[skill]} />)
    const card = screen.getByTestId('skill-card')
    const data = new Map()
    const dataTransfer = {
      setData: (type, val) => data.set(type, val),
      effectAllowed: '',
    }
    fireEvent.dragStart(card, { dataTransfer })
    expect(data.get('application/x-codespace-skill')).toBe('Clean up this code')
    expect(data.get('application/x-codespace-skill-name')).toBe('refactor')
  })
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/SkillsPanel.test.jsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx src/renderer/components/SkillsPanel.jsx tests/renderer/SkillsPanel.test.jsx
git commit -m "feat: pre-fetch skill bodies and place them on the drag payload"
```

---

## Task 9: Drop target — `TerminalPane` accepts skill drops

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx`

- [ ] **Step 1: Extend `handleDragOver` to recognize skill drops**

In `src/renderer/components/TerminalPane.jsx`, replace the existing `handleDragOver` block (around line 88) with:

```javascript
  const handleDragOver = (e) => {
    const types = Array.from(e.dataTransfer.types)
    const isPaneSwap = types.includes('application/x-codespace-terminal')
    const isFileDrop = types.includes('Files')
    const isSkillDrop = types.includes('application/x-codespace-skill')
    if (!isPaneSwap && !isFileDrop && !isSkillDrop) return
    e.preventDefault()
    e.dataTransfer.dropEffect = isPaneSwap ? 'move' : 'copy'
    setDragOver(true)
  }
```

- [ ] **Step 2: Extend `handleDrop` to inject skill body into the PTY**

Replace the existing `handleDrop` (around line 101):

```javascript
  const handleDrop = (e) => {
    const types = Array.from(e.dataTransfer.types)
    const isPaneSwap = types.includes('application/x-codespace-terminal')
    const isFileDrop = types.includes('Files')
    const isSkillDrop = types.includes('application/x-codespace-skill')
    if (!isPaneSwap && !isFileDrop && !isSkillDrop) return
    e.preventDefault()
    setDragOver(false)
    if (isPaneSwap) {
      const srcId = e.dataTransfer.getData('application/x-codespace-terminal')
      if (srcId && srcId !== id) onSwap?.(srcId, id)
      return
    }
    if (isSkillDrop) {
      if (!ptyId) return
      const body = e.dataTransfer.getData('application/x-codespace-skill')
      if (!body) return
      ptyPool.writePty(ptyId, body)
      onFocus?.(id)
      doneTracker.noteFocus(id)
      return
    }
    const paths = Array.from(e.dataTransfer.files)
      .map(f => f.path)
      .filter(p => typeof p === 'string' && p.length > 0)
    if (paths.length === 0 || !ptyId) return
    const text = paths.map(p => /[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p).join(' ')
    ptyPool.writePty(ptyId, text)
    onFocus?.(id)
    doneTracker.noteFocus(id)
  }
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`. Make sure at least one skill exists in `~/.claude/commands/`. Verify:
- Open the Skills panel.
- Drag a skill card from the panel onto any terminal pane.
- The terminal pane shows the cyan dashed drag-over border while the drag is over it.
- On drop, the skill's body is typed into the terminal (visible at the prompt). The pane gains focus.
- Drop on an empty area outside any pane — nothing happens, no error.
- Pane swap and OS file drag-and-drop still work as before.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPane.jsx
git commit -m "feat: TerminalPane accepts skill drops and injects body into PTY"
```

---

## Task 10: `SkillsPanelResizer` + width persistence

**Files:**
- Create: `src/renderer/skills-state.js`
- Create: `src/renderer/components/SkillsPanelResizer.jsx`
- Create: `src/renderer/components/SkillsPanelResizer.css`
- Modify: `src/renderer/components/SkillsPanel.jsx`
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Implement `skills-state.js`**

Create `src/renderer/skills-state.js`:

```javascript
export const SKILLS_PANEL_MIN_PX     = 220
export const SKILLS_PANEL_DEFAULT_PX = 260
export const SKILLS_PANEL_MAX_FRAC   = 0.5
const STORAGE_KEY = 'cs-skills-panel-width'

export function clampPanelWidth(px, bodyWidth) {
  const n = Number(px)
  if (!Number.isFinite(n)) return SKILLS_PANEL_DEFAULT_PX
  const max = Math.max(SKILLS_PANEL_MIN_PX, Math.floor(bodyWidth * SKILLS_PANEL_MAX_FRAC))
  if (n < SKILLS_PANEL_MIN_PX) return SKILLS_PANEL_MIN_PX
  if (n > max) return max
  return Math.round(n)
}

export function loadPanelWidth() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : SKILLS_PANEL_DEFAULT_PX
  } catch {
    return SKILLS_PANEL_DEFAULT_PX
  }
}

export function savePanelWidth(px) {
  try { window.localStorage.setItem(STORAGE_KEY, String(Math.round(px))) } catch {}
}
```

- [ ] **Step 2: Implement `SkillsPanelResizer.jsx`**

Create `src/renderer/components/SkillsPanelResizer.jsx`. **Note the sign flip** — dragging left grows the panel because the panel's right edge is pinned:

```jsx
import { useCallback, useRef, useState } from 'react'
import { clampPanelWidth } from '../skills-state.js'
import './SkillsPanelResizer.css'

export default function SkillsPanelResizer({ width, bodyWidth, onResize, onResizeEnd, onReset }) {
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
    const delta = startRef.current.x - e.clientX  // moving left → positive delta → wider
    onResize?.(clampPanelWidth(startRef.current.w + delta, bodyWidth))
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
      className={`skills-panel-resizer${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  )
}
```

- [ ] **Step 3: Implement `SkillsPanelResizer.css`**

Create `src/renderer/components/SkillsPanelResizer.css`:

```css
.skills-panel-resizer {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 6px;
  cursor: col-resize;
  z-index: 26;
}
.skills-panel-resizer::after {
  content: '';
  position: absolute;
  inset: 0 2px;
  background: transparent;
  transition: background var(--cs-transition);
}
.skills-panel-resizer:hover::after,
.skills-panel-resizer.dragging::after {
  background: rgba(103, 232, 249, 0.45);
}
```

- [ ] **Step 4: Drop the fixed `min-width` from `SkillsPanel.css`**

In `src/renderer/components/SkillsPanel.css`, remove the `min-width: 220px;` line from `.skills-panel` — the clamp in `skills-state.js` handles minimum bounds and a hardcoded CSS minimum would fight resizing.

- [ ] **Step 5: Wire width state in `App.jsx`**

In `src/renderer/App.jsx`, add the imports:

```javascript
import SkillsPanelResizer from './components/SkillsPanelResizer.jsx'
import { loadPanelWidth, savePanelWidth, clampPanelWidth } from './skills-state.js'
```

Inside `AppInner()`, alongside the other skills state:

```javascript
  const [skillsPanelWidth, setSkillsPanelWidth] = useState(() => loadPanelWidth())

  const handleSkillsResize = useCallback((px) => {
    setSkillsPanelWidth(clampPanelWidth(px, bodyWidthRef.current || 1400))
  }, [])
  const handleSkillsResizeEnd = useCallback(() => {
    savePanelWidth(skillsPanelWidth)
  }, [skillsPanelWidth])
  const handleSkillsResetWidth = useCallback(() => {
    const px = clampPanelWidth(260, bodyWidthRef.current || 1400)
    setSkillsPanelWidth(px)
    savePanelWidth(px)
  }, [])
```

- [ ] **Step 6: Render the resizer next to the panel in `App.jsx`**

Replace the existing render in Task 7 Step 3 with both resizer + panel. The resizer must be positioned so it sits on the panel's left edge — its `right` offset equals the panel's width:

```jsx
          {activePanel === 'skills' && (
            <>
              <SkillsPanelResizer
                width={skillsPanelWidth}
                bodyWidth={bodyWidthRef.current || 1400}
                onResize={handleSkillsResize}
                onResizeEnd={handleSkillsResizeEnd}
                onReset={handleSkillsResetWidth}
              />
              <SkillsPanel
                width={skillsPanelWidth}
                loadState={skillsLoadState}
                skills={skills}
                sourcePath="~/.claude/commands/"
                onClose={() => setActivePanel(null)}
                onCreate={() => { /* wired in Task 11 */ }}
                onRevealDir={() => window.electronAPI.skills.revealDir()}
              />
            </>
          )}
```

- [ ] **Step 7: Position the resizer dynamically**

The `SkillsPanelResizer.css` rule uses no `right:` value. Add an inline style on the JSX so the resizer sits at the panel's left edge:

```jsx
              <SkillsPanelResizer
                width={skillsPanelWidth}
                bodyWidth={bodyWidthRef.current || 1400}
                onResize={handleSkillsResize}
                onResizeEnd={handleSkillsResizeEnd}
                onReset={handleSkillsResetWidth}
                style={{ right: `${skillsPanelWidth + 6}px` }}
              />
```

Update `SkillsPanelResizer.jsx` to accept and apply the `style` prop:

```jsx
export default function SkillsPanelResizer({ width, bodyWidth, onResize, onResizeEnd, onReset, style }) {
  /* ... unchanged ... */
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`skills-panel-resizer${dragging ? ' dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  )
}
```

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`. Verify:
- Open Skills panel. Hover the left edge of the panel — cursor changes to col-resize, a cyan tint appears.
- Drag the left edge leftward → panel widens. Drag rightward → panel narrows.
- Min width ~220px is enforced; max width is ~50% of the body.
- Double-click the resizer → width snaps back to 260px.
- Close + reopen the panel: width persists. Restart the app: width persists.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/skills-state.js src/renderer/components/SkillsPanelResizer.jsx src/renderer/components/SkillsPanelResizer.css src/renderer/components/SkillsPanel.css src/renderer/components/SkillsPanel.jsx src/renderer/App.jsx
git commit -m "feat: add resizable Skills panel width with localStorage persistence"
```

---

## Task 11: "+ new" inline form

**Files:**
- Modify: `src/renderer/components/SkillsPanel.jsx`
- Modify: `src/renderer/App.jsx`
- Modify: `tests/renderer/SkillsPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/SkillsPanel.test.jsx`:

```jsx
  it('switches to the create form when + new is clicked', async () => {
    render(<SkillsPanel {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    expect(screen.getByLabelText(/skill name/i)).toBeTruthy()
    expect(screen.getByLabelText(/prompt/i)).toBeTruthy()
  })

  it('calls onCreate with {name, body} when the form is submitted', async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: true })
    render(<SkillsPanel {...baseProps} onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    await userEvent.type(screen.getByLabelText(/skill name/i), 'audit')
    await userEvent.type(screen.getByLabelText(/prompt/i), 'Audit branch readiness')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'audit', body: 'Audit branch readiness' })
  })

  it('returns to the list when Cancel is clicked', async () => {
    render(<SkillsPanel {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/skill name/i)).toBeNull()
    expect(screen.getByTestId('skill-name')).toBeTruthy()
  })

  it('shows an error message when onCreate resolves with { ok: false }', async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: false, reason: 'exists' })
    render(<SkillsPanel {...baseProps} onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    await userEvent.type(screen.getByLabelText(/skill name/i), 'refactor')
    await userEvent.type(screen.getByLabelText(/prompt/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/already exists/i)).toBeTruthy()
  })
```

- [ ] **Step 2: Implement the form in `SkillsPanel.jsx`**

Replace the contents of `SkillsPanel.jsx`'s `return (...)` body so the panel toggles between list and create modes. Add a state hook at the top of the component:

```jsx
import { useMemo, useState } from 'react'
/* ... unchanged imports ... */

export default function SkillsPanel({ width, loadState, skills, sourcePath, onClose, onCreate, onRevealDir }) {
  const [filter, setFilter] = useState('')
  const [mode, setMode] = useState('list')  // 'list' | 'create'
  const [draftName, setDraftName] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [createError, setCreateError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const visible = useMemo(() => {
    /* unchanged */
    const q = filter.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    )
  }, [skills, filter])

  const openCreate = () => {
    setDraftName('')
    setDraftBody('')
    setCreateError(null)
    setMode('create')
  }
  const cancelCreate = () => {
    setMode('list')
    setCreateError(null)
  }
  const submitCreate = async (e) => {
    e?.preventDefault()
    setSubmitting(true)
    setCreateError(null)
    const r = await onCreate({ name: draftName, body: draftBody })
    setSubmitting(false)
    if (r?.ok) {
      setMode('list')
    } else if (r?.reason === 'exists') {
      setCreateError(`A skill named "${draftName}" already exists`)
    } else if (r?.reason === 'invalid-name') {
      setCreateError('Name must contain letters, numbers, hyphens, or underscores')
    } else {
      setCreateError(r?.message ?? 'Could not save the skill')
    }
  }

  return (
    <aside className="skills-panel" style={{ width: `${width}px` }} role="complementary" aria-label="Skills">
      <header className="skills-panel-header">
        <div className="skills-panel-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cs-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 2l2.39 7.36H22l-6.19 4.49L18.2 21 12 16.51 5.8 21l2.39-7.15L2 9.36h7.61z"/>
          </svg>
          <span>{mode === 'create' ? 'New skill' : 'Skills'}</span>
        </div>
        <div className="skills-panel-actions">
          {mode === 'list' && <button type="button" className="skills-panel-newbtn" onClick={openCreate}>+ new</button>}
          <button type="button" className="skills-panel-closebtn" aria-label="Close Skills" onClick={onClose}>✕</button>
        </div>
      </header>

      {mode === 'list' && (
        <>
          <div className="skills-panel-filter">
            <input type="text" placeholder="Filter skills…" value={filter} onChange={e => setFilter(e.target.value)} spellCheck={false} autoComplete="off" />
          </div>
          <div className="skills-panel-body">
            {/* unchanged loading / empty / list rendering from Task 6 + Task 8 */}
            {loadState === 'loading' && (
              <div className="skills-panel-loading" data-testid="skills-loading"><div className="skills-panel-loading-bar" /></div>
            )}
            {loadState === 'content' && visible.length === 0 && skills.length === 0 && (
              <div className="skills-panel-empty">
                <p className="skills-panel-empty-title">No skills yet</p>
                <p className="skills-panel-empty-hint">Create one with <strong>+ new</strong>, or add an <code>.md</code> file to <code>~/.claude/commands/</code></p>
              </div>
            )}
            {loadState === 'content' && visible.length === 0 && skills.length > 0 && (
              <div className="skills-panel-empty"><p className="skills-panel-empty-title">No matches</p></div>
            )}
            {loadState === 'content' && visible.length > 0 && (
              <ul className="skills-panel-list">
                {visible.map(skill => (
                  <li
                    key={skill.filePath}
                    className="skills-panel-card"
                    data-testid="skill-card"
                    draggable={true}
                    onDragStart={e => {
                      e.dataTransfer.setData('application/x-codespace-skill', skill.body ?? '')
                      e.dataTransfer.setData('application/x-codespace-skill-name', skill.name)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <div className="skills-panel-card-row">
                      <span className="skills-panel-card-name" data-testid="skill-name">{skill.name}</span>
                      <span className="skills-panel-card-grip" aria-hidden>⠿</span>
                    </div>
                    {skill.description && <div className="skills-panel-card-desc">{skill.description}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {mode === 'create' && (
        <form className="skills-panel-form" onSubmit={submitCreate}>
          <label className="skills-panel-field">
            <span>Skill name</span>
            <input
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder="my-skill"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="skills-panel-field skills-panel-field-grow">
            <span>Prompt</span>
            <textarea
              value={draftBody}
              onChange={e => setDraftBody(e.target.value)}
              placeholder="The instruction to inject into the terminal when this skill is dropped on it."
              spellCheck={false}
            />
          </label>
          {createError && <div className="skills-panel-form-error">{createError}</div>}
          <div className="skills-panel-form-actions">
            <button type="button" className="skills-panel-cancelbtn" onClick={cancelCreate} disabled={submitting}>Cancel</button>
            <button type="submit" className="skills-panel-savebtn" disabled={submitting || draftName.trim().length === 0 || draftBody.trim().length === 0}>Save</button>
          </div>
        </form>
      )}

      <footer className="skills-panel-footer">
        <button type="button" className="skills-panel-footer-path" onClick={onRevealDir} title="Open in file explorer">{sourcePath ?? '~/.claude/commands/'}</button>
        <span className="skills-panel-footer-count">{skills.length} {skills.length === 1 ? 'skill' : 'skills'}</span>
      </footer>
    </aside>
  )
}
```

- [ ] **Step 3: Add form styles to `SkillsPanel.css`**

Append to `src/renderer/components/SkillsPanel.css`:

```css
.skills-panel-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  min-height: 0;
}
.skills-panel-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skills-panel-field > span {
  font-family: var(--cs-font-ui);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cs-text-muted);
}
.skills-panel-field input,
.skills-panel-field textarea {
  background: var(--cs-bg-base);
  border: 1px solid var(--cs-border);
  border-radius: 5px;
  padding: 6px 8px;
  color: var(--cs-text-secondary);
  font-family: var(--cs-font-mono);
  font-size: 11px;
  outline: none;
  resize: none;
  transition: border-color var(--cs-transition);
}
.skills-panel-field textarea { font-family: var(--cs-font-ui); font-size: 12px; line-height: 1.5; }
.skills-panel-field input:focus,
.skills-panel-field textarea:focus { border-color: var(--cs-cyan); }
.skills-panel-field-grow { flex: 1; min-height: 0; }
.skills-panel-field-grow textarea { flex: 1; height: 100%; min-height: 80px; }

.skills-panel-form-error {
  background: var(--cs-red-hover-bg);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 5px;
  padding: 6px 8px;
  color: var(--cs-red-hover-fg);
  font-family: var(--cs-font-ui);
  font-size: 11px;
}

.skills-panel-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.skills-panel-cancelbtn,
.skills-panel-savebtn {
  background: var(--cs-bg-surface);
  border: 1px solid var(--cs-border-hover);
  border-radius: 5px;
  padding: 5px 11px;
  color: var(--cs-text-secondary);
  font-family: var(--cs-font-ui);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--cs-transition), border-color var(--cs-transition), color var(--cs-transition);
}
.skills-panel-cancelbtn:hover:not(:disabled) { background: var(--cs-bg-hover); }
.skills-panel-savebtn { color: var(--cs-cyan); border-color: rgba(103, 232, 249, 0.4); }
.skills-panel-savebtn:hover:not(:disabled) { background: rgba(103, 232, 249, 0.06); border-color: var(--cs-cyan); }
.skills-panel-cancelbtn:disabled,
.skills-panel-savebtn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 4: Wire `onCreate` in `App.jsx`**

Replace the placeholder `onCreate={() => {}}` in `App.jsx` with:

```jsx
              onCreate={async ({ name, body }) => {
                return window.electronAPI.skills.create({ name, body })
              }}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/renderer/SkillsPanel.test.jsx`
Expected: PASS, 12 tests total.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`. Verify:
- Click + new → header changes to "New skill", filter + list are replaced by name + prompt form.
- Type name and prompt → Save is enabled.
- Submit → file is created, panel returns to list, new skill appears (via the watcher).
- Try creating a skill with the same name twice → see "already exists" error inline.
- Try creating a skill with only special characters → "Name must contain letters..." error.
- Cancel returns to list without saving.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/SkillsPanel.jsx src/renderer/components/SkillsPanel.css src/renderer/App.jsx tests/renderer/SkillsPanel.test.jsx
git commit -m "feat: add inline new-skill form with validation"
```

---

## Task 12: Polish — empty toolbar state, dim grid while open, keyboard

**Files:**
- Modify: `src/renderer/App.jsx`
- Modify: `src/renderer/App.css`

- [ ] **Step 1: Dim the terminal grid when a panel is open**

In `src/renderer/App.css`, append:

```css
.body-main.has-panel > .grid-wrap {
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
```

In `src/renderer/App.jsx`, on the `.body-main` div, add the class:

```jsx
        <div className={`body-main${fsTerminalId ? ' fs-terminal' : ''}${fsEditor ? ' fs-editor' : ''}${activePanel ? ' has-panel' : ''}`}>
```

- [ ] **Step 2: Make sure the panel does NOT close on Escape**

The user explicitly wanted the panel to stay open during drag operations. Confirm no global Escape handler closes it. Look at the existing `keydown` effect in `App.jsx` (around line 779) — it only handles Ctrl+T/W/E. No change required, but verify by manually pressing Escape while the panel is open: it should stay open.

If the user wants Escape to close the panel later, that's a future enhancement.

- [ ] **Step 3: Manual full-flow smoke test**

Run: `npm run dev`. Walk through the complete flow:
1. App starts with the right toolbar visible, no panel open.
2. Click Skills icon → panel opens, terminal grid dims to ~55% opacity.
3. Drag a skill card → over a terminal pane the cyan dashed border appears. Drop → text is injected into the PTY.
4. Click ✕ → panel closes, grid returns to full opacity.
5. Click Skills again → panel opens with the same width as before.
6. Resize the panel by dragging its left edge.
7. Click + new → fill form → Save. The new skill appears immediately in the list (watcher fired).
8. Drag the new skill onto a terminal → its body is injected.
9. Click the footer path → file explorer opens at `~/.claude/commands/`.
10. Click the Skills icon (while panel is open) → panel closes.
11. Close the app and reopen → panel width preserved.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, all skill-related tests plus any existing tests.

Also run a production build to catch any vite/electron-vite issues:
Run: `npm run build`
Expected: clean build, no errors. Inspect `out/` to confirm `skills-fs.js` is bundled into `out/main/index.js`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx src/renderer/App.css
git commit -m "feat: dim terminal grid while right panel is open"
```

---

## Self-review checklist

- [x] **Spec coverage:** All v2 design decisions (locked-in table at top) have a corresponding task. Right toolbar (Task 4-5), full-height floating panel (Task 6-7), drag-to-terminal (Task 8-9), resizable (Task 10), new-skill form (Task 11), close interactions (toolbar toggle in Task 5, ✕ in Task 6, no click-outside by design), source dir from `~/.claude/commands/` (Task 1), hot reload (Task 2-3), frontmatter description (Task 1), settings docked at bottom (Task 4), other icons as stubs (Task 4).
- [x] **No placeholders:** Every step has either an explicit code block or an exact command + expected output.
- [x] **Type consistency:** `skills` array shape is `{ name, description, filePath, body? }` throughout. `skills.create` always takes `{ name, body }`. `loadState` is the string union `'loading' | 'content' | 'error'`. `activePanel` is `null | 'skills'` everywhere.
- [x] **TDD order:** Tests precede implementation in each task.
- [x] **Commits:** Every task ends with a focused commit; no batching across logical units.

---

## Out of scope (deferred follow-ups)

- Editing or deleting skills from within the panel.
- Surfacing project-level `.claude/commands/` separately from global.
- Wiring the `/` commands, Editor, and Search toolbar icons to their own panels (currently stubbed/disabled).
- Showing a skill preview on hover.
- Esc-to-close (could be added if drag interactions don't conflict).
- Reading from `~/.claude/skills/` (Claude Code's true "skills" directory with sub-skills). v1 reuses `~/.claude/commands/` per the prior brainstorm.
