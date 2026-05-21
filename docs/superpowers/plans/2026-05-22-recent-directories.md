# Recent Directories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Recent" section to the CodeSpace onboarding screen showing recently-used project directories as a 2-column grid of clickable cards.

**Architecture:** A new main-process store (`recent-dirs-store.js`) persists an MRU list of directory paths to `recents.json` in `userData`, mirroring the existing `workspaces-store.js` pattern. Three `ipcMain.handle` channels expose get/add/remove. The renderer gets a small presentational `RecentDirectories` component; `Onboarding.jsx` owns the list state, records directories on Browse-select and Initialize, and renders the component in the left column.

**Tech Stack:** Electron (main/preload/renderer split), React, Vitest + @testing-library/react, plain CSS with `--cs-*` design tokens.

**Spec:** `docs/superpowers/specs/2026-05-22-recent-directories-design.md`

---

## File Structure

- **Create** `src/main/recent-dirs-store.js` — persistence + pure list helpers. One responsibility: own `recents.json`.
- **Create** `tests/main/recent-dirs-store.test.js` — store unit tests (follows `tests/main/settings-store.test.js`).
- **Create** `src/renderer/components/RecentDirectories.jsx` — presentational recent-list component.
- **Create** `tests/renderer/RecentDirectories.test.jsx` — component tests (follows `tests/renderer/RightToolbar.test.jsx`).
- **Modify** `src/main/index.js` — register 3 IPC handlers + 1 import.
- **Modify** `src/preload/index.js` — add `recents` namespace to the bridge.
- **Modify** `src/renderer/components/Onboarding.jsx` — own `recents` state, wire record/pick/remove, render the component.
- **Modify** `src/renderer/components/Onboarding.css` — styles for the recent card grid.

---

## Task 1: Main-process store (`recent-dirs-store.js`)

**Files:**
- Create: `src/main/recent-dirs-store.js`
- Test: `tests/main/recent-dirs-store.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/main/recent-dirs-store.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdtempSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let dir
vi.mock('electron', () => ({
  app: { getPath: () => dir }
}))

import {
  normalizePath, mergeRecent, loadRecents, addRecent, removeRecent, MAX_RECENTS
} from '../../src/main/recent-dirs-store.js'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-recents-'))
})

// Creates a real sub-directory under the temp dir and returns its absolute path.
// loadRecents() prunes paths that don't exist, so fs-backed tests need real dirs.
function realDir(name) {
  const p = join(dir, name)
  mkdirSync(p)
  return p
}

describe('mergeRecent', () => {
  it('adds a new directory to the front', () => {
    expect(mergeRecent(['a'], 'b', 6)).toEqual(['b', 'a'])
  })

  it('moves an existing directory to the front without duplicating', () => {
    expect(mergeRecent(['a', 'b', 'c'], 'c', 6)).toEqual(['c', 'a', 'b'])
  })

  it('collapses case-insensitive and trailing-separator variants', () => {
    expect(mergeRecent(['C:\\Foo'], 'c:\\foo\\', 6)).toEqual(['c:\\foo\\'])
  })

  it('caps the list at max, dropping the oldest', () => {
    expect(mergeRecent(['a', 'b', 'c', 'd', 'e', 'f'], 'g', 6))
      .toEqual(['g', 'a', 'b', 'c', 'd', 'e'])
  })

  it('handles an empty starting list', () => {
    expect(mergeRecent([], 'a', 6)).toEqual(['a'])
  })
})

describe('normalizePath', () => {
  it('lower-cases and strips trailing separators', () => {
    expect(normalizePath('C:\\Foo\\')).toBe('c:\\foo')
    expect(normalizePath('/home/x/')).toBe('/home/x')
  })
})

describe('recent-dirs-store (fs)', () => {
  it('returns [] when the file is missing', async () => {
    expect(await loadRecents()).toEqual([])
  })

  it('addRecent persists and round-trips', async () => {
    const a = realDir('a')
    await addRecent(a)
    expect(await loadRecents()).toEqual([a])
  })

  it('addRecent moves a repeated directory to the front', async () => {
    const a = realDir('a')
    const b = realDir('b')
    await addRecent(a)
    await addRecent(b)
    await addRecent(a)
    expect(await loadRecents()).toEqual([a, b])
  })

  it('loadRecents prunes directories that no longer exist', async () => {
    const a = realDir('a')
    const gone = join(dir, 'gone')   // never created
    await fs.writeFile(
      join(dir, 'recents.json'),
      JSON.stringify({ version: 1, dirs: [gone, a] }),
      'utf8'
    )
    expect(await loadRecents()).toEqual([a])
  })

  it('removeRecent drops the matching entry', async () => {
    const a = realDir('a')
    const b = realDir('b')
    await addRecent(a)
    await addRecent(b)
    const next = await removeRecent(a)
    expect(next).toEqual([b])
    expect(await loadRecents()).toEqual([b])
  })

  it('quarantines a corrupt file and returns []', async () => {
    await fs.writeFile(join(dir, 'recents.json'), '{ not json', 'utf8')
    expect(await loadRecents()).toEqual([])
    const files = await fs.readdir(dir)
    expect(files.some(f => f.startsWith('recents.json.corrupt-'))).toBe(true)
  })

  it('caps persisted history at MAX_RECENTS', async () => {
    const dirs = []
    for (let i = 0; i < MAX_RECENTS + 2; i++) dirs.push(realDir('d' + i))
    for (const d of dirs) await addRecent(d)
    const list = await loadRecents()
    expect(list.length).toBe(MAX_RECENTS)
    expect(list[0]).toBe(dirs[dirs.length - 1])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/recent-dirs-store.test.js`
Expected: FAIL — cannot resolve `../../src/main/recent-dirs-store.js` (module does not exist).

- [ ] **Step 3: Write the store implementation**

Create `src/main/recent-dirs-store.js`:

```js
import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'recents.json'
const SCHEMA_VERSION = 1
export const MAX_RECENTS = 6

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

// Comparison key for a path: lower-cased, trailing separators stripped.
// Windows paths are case-insensitive, so two casings of the same folder must
// collapse to one entry. The original-cased string is what gets stored.
export function normalizePath(p) {
  return String(p ?? '').replace(/[\\/]+$/, '').toLowerCase()
}

// Pure dedup + MRU + cap. Drops any existing entry equal to `dir` (by
// normalizePath), puts `dir` at the front, truncates to `max`.
export function mergeRecent(list, dir, max) {
  const key = normalizePath(dir)
  const rest = (Array.isArray(list) ? list : []).filter(d => normalizePath(d) !== key)
  return [dir, ...rest].slice(0, max)
}

async function quarantineCorrupt(path) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  try { await fs.rename(path, `${path}.corrupt-${ts}`) } catch {}
}

async function saveRecents(dirs) {
  const safe = { version: SCHEMA_VERSION, dirs: dirs.slice(0, MAX_RECENTS) }
  const path = filePath()
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

export async function loadRecents() {
  const path = filePath()
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    return []   // ENOENT or any read failure
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantineCorrupt(path)
    return []
  }

  if (!parsed || !Array.isArray(parsed.dirs)) {
    await quarantineCorrupt(path)
    return []
  }

  const dirs = parsed.dirs.filter(d => typeof d === 'string' && d.length > 0)

  // Prune entries whose directory no longer exists on disk.
  const checks = await Promise.all(dirs.map(async d => {
    try {
      const st = await fs.stat(d)
      return st.isDirectory()
    } catch {
      return false
    }
  }))
  const alive = dirs.filter((_, i) => checks[i])

  if (alive.length !== dirs.length) {
    try { await saveRecents(alive) } catch {}
  }
  return alive
}

export async function addRecent(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return loadRecents()
  const current = await loadRecents()
  const next = mergeRecent(current, dir, MAX_RECENTS)
  await saveRecents(next)
  return next
}

export async function removeRecent(dir) {
  const key = normalizePath(dir)
  const current = await loadRecents()
  const next = current.filter(d => normalizePath(d) !== key)
  await saveRecents(next)
  return next
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/recent-dirs-store.test.js`
Expected: PASS — all tests in both `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/main/recent-dirs-store.js tests/main/recent-dirs-store.test.js
git commit -m "feat: add recent-dirs store for onboarding recent directories"
```

---

## Task 2: IPC channels and preload bridge

**Files:**
- Modify: `src/main/index.js` (import near line 7; handlers near line 133)
- Modify: `src/preload/index.js` (after the `agents` namespace, ~line 79)

- [ ] **Step 1: Add the store import to `index.js`**

Find this line (around line 7):

```js
import { loadWorkspaces, saveWorkspaces, consumeCorruptBackupNotice } from './workspaces-store.js'
```

Add a new line directly after it:

```js
import { loadRecents, addRecent, removeRecent } from './recent-dirs-store.js'
```

- [ ] **Step 2: Register the IPC handlers in `index.js`**

Find this line (around line 133):

```js
  ipcMain.handle('workspaces:save', (_event, state) => saveWorkspaces(state))
```

Add three new lines directly after it:

```js

  ipcMain.handle('recents:get',    () => loadRecents())
  ipcMain.handle('recents:add',    (_event, dir) => addRecent(dir))
  ipcMain.handle('recents:remove', (_event, dir) => removeRecent(dir))
```

- [ ] **Step 3: Add the `recents` namespace to the preload bridge**

In `src/preload/index.js`, find the `agents` namespace block:

```js
  agents: {
    getAvailability: () => ipcRenderer.invoke('agents:availability'),
  },
```

Add a `recents` namespace directly after it:

```js
  agents: {
    getAvailability: () => ipcRenderer.invoke('agents:availability'),
  },

  recents: {
    get:    ()    => ipcRenderer.invoke('recents:get'),
    add:    (dir) => ipcRenderer.invoke('recents:add', dir),
    remove: (dir) => ipcRenderer.invoke('recents:remove', dir),
  },
```

- [ ] **Step 4: Verify the build still compiles**

Run: `npm run build`
Expected: Build completes with no errors for all three targets (`out/main`, `out/preload`, `out/renderer`).

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: expose recents IPC channels through the preload bridge"
```

---

## Task 3: `RecentDirectories` component

**Files:**
- Create: `src/renderer/components/RecentDirectories.jsx`
- Test: `tests/renderer/RecentDirectories.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/RecentDirectories.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecentDirectories from '../../src/renderer/components/RecentDirectories.jsx'

const RECENTS = ['D:\\Projects\\CodeSpace', 'C:\\Users\\TJ\\Desktop\\Socials']

describe('RecentDirectories', () => {
  it('renders nothing when the list is empty', () => {
    const { container } = render(
      <RecentDirectories recents={[]} currentDir="" onPick={() => {}} onRemove={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a card per recent directory showing its basename', () => {
    render(
      <RecentDirectories recents={RECENTS} currentDir="" onPick={() => {}} onRemove={() => {}} />
    )
    expect(screen.getByText('CodeSpace')).toBeTruthy()
    expect(screen.getByText('Socials')).toBeTruthy()
  })

  it('fires onPick with the directory when a card is clicked', async () => {
    const onPick = vi.fn()
    render(
      <RecentDirectories recents={RECENTS} currentDir="" onPick={onPick} onRemove={() => {}} />
    )
    await userEvent.click(screen.getByText('CodeSpace'))
    expect(onPick).toHaveBeenCalledWith('D:\\Projects\\CodeSpace')
  })

  it('fires onRemove (and not onPick) when the remove button is clicked', async () => {
    const onPick = vi.fn()
    const onRemove = vi.fn()
    render(
      <RecentDirectories recents={RECENTS} currentDir="" onPick={onPick} onRemove={onRemove} />
    )
    await userEvent.click(screen.getByRole('button', { name: /remove codespace/i }))
    expect(onRemove).toHaveBeenCalledWith('D:\\Projects\\CodeSpace')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('marks the card matching currentDir as active (case-insensitive)', () => {
    render(
      <RecentDirectories
        recents={RECENTS}
        currentDir="d:\\projects\\codespace\\"
        onPick={() => {}}
        onRemove={() => {}}
      />
    )
    const card = screen.getByText('CodeSpace').closest('.ob-recent-card')
    expect(card.classList.contains('active')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/RecentDirectories.test.jsx`
Expected: FAIL — cannot resolve `../../src/renderer/components/RecentDirectories.jsx`.

- [ ] **Step 3: Write the component**

Create `src/renderer/components/RecentDirectories.jsx`:

```jsx
const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

function basename(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p
}

// Case-insensitive, trailing-separator-tolerant path equality (Windows).
function samePath(a, b) {
  const norm = s => String(s ?? '').replace(/[\\/]+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

export default function RecentDirectories({ recents, currentDir, onPick, onRemove }) {
  if (!recents || recents.length === 0) return null

  return (
    <div className="ob-field">
      <label className="ob-label">Recent</label>
      <div className="ob-recent-grid">
        {recents.map(dir => {
          const active = currentDir && samePath(dir, currentDir)
          return (
            <div
              key={dir}
              role="button"
              tabIndex={0}
              className={`ob-recent-card${active ? ' active' : ''}`}
              title={dir}
              onClick={() => onPick(dir)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick(dir)
                }
              }}
            >
              <span className="ob-recent-folder"><FolderIcon /></span>
              <span className="ob-recent-text">
                <span className="ob-recent-name">{basename(dir)}</span>
                <span className="ob-recent-path">{dir}</span>
              </span>
              <button
                type="button"
                className="ob-recent-remove"
                aria-label={`Remove ${basename(dir)}`}
                onClick={e => {
                  e.stopPropagation()
                  onRemove(dir)
                }}
              >
                <XIcon />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/RecentDirectories.test.jsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/RecentDirectories.jsx tests/renderer/RecentDirectories.test.jsx
git commit -m "feat: add RecentDirectories presentational component"
```

---

## Task 4: Wire `RecentDirectories` into `Onboarding.jsx`

**Files:**
- Modify: `src/renderer/components/Onboarding.jsx`

There is no automated test for this task — `Onboarding` depends on the full
`window.electronAPI` surface. It is verified manually in Task 6.

- [ ] **Step 1: Import the component**

Find this line (around line 3):

```js
import AppIcon from './AppIcon.jsx'
```

Add directly after it:

```js
import RecentDirectories from './RecentDirectories.jsx'
```

- [ ] **Step 2: Add the `recents` state**

Find this line (around line 69):

```js
  const [codexShare, setCodexShare] = useState(0)
```

Add directly after it:

```js
  const [recents, setRecents] = useState([])
```

- [ ] **Step 3: Load recents on mount**

Find the availability effect (it ends with `}, [])` around line 81). Directly
after that effect's closing `}, [])`, add a new effect:

```js

  // Load the recent-directories list once when the onboarding form mounts.
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.recents?.get?.().then(list => {
      if (!cancelled) setRecents(Array.isArray(list) ? list : [])
    })
    return () => { cancelled = true }
  }, [])
```

- [ ] **Step 4: Record the directory on Browse and add pick/remove handlers**

Replace the existing `handleBrowse` function:

```js
  const handleBrowse = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setProjectDir(dir)
  }
```

with this — it records the chosen directory and refreshes the list, then adds
the pick and remove handlers:

```js
  const handleBrowse = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (!dir) return
    setProjectDir(dir)
    const list = await window.electronAPI.recents.add(dir)
    setRecents(Array.isArray(list) ? list : [])
  }

  const handlePickRecent = (dir) => {
    setProjectDir(dir)
  }

  const handleRemoveRecent = async (dir) => {
    const list = await window.electronAPI.recents.remove(dir)
    setRecents(Array.isArray(list) ? list : [])
  }
```

- [ ] **Step 5: Record the directory on Initialize**

Replace the existing `handleLaunch` function:

```js
  const handleLaunch = () => {
    if (!canLaunch) return
    setLaunching(true)
    const counts = { claude: claudeShare, codex: codexShare }
    setTimeout(() => onLaunch(counts, projectDir, name.trim(), isolated), ONBOARDING_BOOT_DELAY_MS)
  }
```

with this (adds the `recents.add` call — fire-and-forget; the fresh list is
picked up on the next onboarding mount):

```js
  const handleLaunch = () => {
    if (!canLaunch) return
    setLaunching(true)
    window.electronAPI?.recents?.add?.(projectDir)
    const counts = { claude: claudeShare, codex: codexShare }
    setTimeout(() => onLaunch(counts, projectDir, name.trim(), isolated), ONBOARDING_BOOT_DELAY_MS)
  }
```

- [ ] **Step 6: Render the component in the left column**

In the left column `<section className="ob-col">`, find the end of the Project
directory field — the `</div>` that closes its `ob-field`, immediately before
the `</section>` that ends the left column:

```jsx
                <button
                  type="button"
                  className="ob-browse-btn"
                  onClick={handleBrowse}
                >
                  Browse
                </button>
              </div>
            </div>
          </section>
```

Insert the `RecentDirectories` element between the `ob-field`'s closing `</div>`
and `</section>`:

```jsx
                <button
                  type="button"
                  className="ob-browse-btn"
                  onClick={handleBrowse}
                >
                  Browse
                </button>
              </div>
            </div>

            <RecentDirectories
              recents={recents}
              currentDir={projectDir}
              onPick={handlePickRecent}
              onRemove={handleRemoveRecent}
            />
          </section>
```

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`
Expected: Build completes with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/Onboarding.jsx
git commit -m "feat: surface recent directories in the onboarding screen"
```

---

## Task 5: Styling (`Onboarding.css`)

**Files:**
- Modify: `src/renderer/components/Onboarding.css` (append at end of file)

- [ ] **Step 1: Append the recent-directory styles**

Add this block to the very end of `src/renderer/components/Onboarding.css`:

```css

/* === Recent directories === */

.ob-recent-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ob-recent-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  background: hsl(0 0% 6%);
  border: 1px solid var(--cs-border-mid);
  border-radius: 8px;
  padding: 8px 9px;
  cursor: pointer;
  min-width: 0;
  transition:
    background var(--cs-transition),
    border-color var(--cs-transition),
    transform 0.18s ease;
}

.ob-recent-card:hover {
  background: hsl(0 0% 8%);
  border-color: var(--cs-border-hover);
  transform: translateY(-1px);
}

.ob-recent-card:focus-visible {
  outline: none;
  border-color: var(--cs-border-focus);
}

/* Active = the card whose path matches the selected project directory.
   The single accent-color use in this section. */
.ob-recent-card.active {
  background: hsl(0 0% 8%);
  border-color: var(--cs-cyan);
}

.ob-recent-folder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--cs-text-secondary);
  flex-shrink: 0;
}

.ob-recent-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.ob-recent-name {
  font-family: var(--cs-font-ui);
  font-size: 12px;
  font-weight: 500;
  color: var(--cs-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ob-recent-path {
  font-family: var(--cs-font-mono);
  font-size: 9px;
  color: var(--cs-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ob-recent-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--cs-icon-tertiary);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--cs-transition),
    background var(--cs-transition),
    color var(--cs-transition);
}

.ob-recent-card:hover .ob-recent-remove,
.ob-recent-card:focus-within .ob-recent-remove {
  opacity: 1;
}

.ob-recent-remove:hover {
  background: var(--cs-red-hover-bg);
  color: var(--cs-red-hover-fg);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/Onboarding.css
git commit -m "feat: style the recent directories card grid"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS — all suites green, including the new `recent-dirs-store` and
`RecentDirectories` files. No previously-passing test regresses.

- [ ] **Step 2: Manual check — standalone onboarding**

Run `npm run dev`. With no workspaces persisted, the onboarding screen appears.

Verify:
- On a clean profile (no `recents.json`), no "Recent" section is shown — the
  left column looks exactly as before.
- Click **Browse**, pick a folder. A "Recent" section appears under the Project
  directory field with that folder as a card (folder name bright, full path dim).
- The card matching the current Project directory has a cyan border.
- Browse to a second folder — it becomes the first card; the previous one is
  second. Re-Browsing to the first folder moves it back to the front (no
  duplicate).
- Hover a card — a "×" appears top-right. Click it — the card disappears and
  does not change the Project directory.
- Click a different recent card — the Project directory field and the workspace
  name update to that folder.

- [ ] **Step 3: Manual check — persistence and cap**

- Initialize a workspace. Reopen the onboarding (sidebar "+" for embedded mode):
  the directory used for Initialize is present in the Recent list.
- Confirm the embedded onboarding (sidebar "+") shows the same Recent section.
- Add directories until there are 7 distinct ones — the list holds only the 6
  most recent; the oldest drops off.
- Quit and relaunch the app — the Recent list is restored from `recents.json`.

- [ ] **Step 4: Commit (only if Steps 1–3 surfaced fixes)**

If any step required a code change, commit it:

```bash
git add -A
git commit -m "fix: address recent-directories verification findings"
```

If no fixes were needed, skip this step.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), store with `normalizePath` / `mergeRecent` / `loadRecents` / `addRecent` / `removeRecent` and missing-dir pruning (Task 1), IPC channels + preload namespace (Task 2), `RecentDirectories` component with empty-state `null` return (Task 3), `Onboarding` state/load/record-on-browse/record-on-initialize/pick/remove/render (Task 4), styling with cyan reserved for the active card (Task 5), `mergeRecent` tests plus broader store coverage (Task 1), component tests (Task 3). The default Desktop pre-fill is never recorded because directories are only added in `handleBrowse` and `handleLaunch`, never in the Desktop-path effect. The same `Onboarding` component renders in standalone and embedded mode, so the section appears in both with no extra work.
- **Test file locations:** the spec named `tests/recent-dirs-store.test.js`; this plan places tests at `tests/main/recent-dirs-store.test.js` and `tests/renderer/RecentDirectories.test.jsx` to match the existing `tests/main/` and `tests/renderer/` convention.
- **Type consistency:** `recents` is a `string[]` everywhere — store return values, IPC payloads, the `recents` prop. Handler names (`handleBrowse`, `handlePickRecent`, `handleRemoveRecent`, `handleLaunch`) and prop names (`recents`, `currentDir`, `onPick`, `onRemove`) are consistent across Tasks 3 and 4.
