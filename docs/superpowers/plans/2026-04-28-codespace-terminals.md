# CodeSpace — Vibecoding Terminal App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Electron desktop app that opens a flexible grid of real terminal sessions (PowerShell / cmd) rendered by xterm.js, arranged in a 4-column CSS Grid that grows rows as terminals are added.

**Architecture:** Electron main process manages node-pty shell sessions and routes data over IPC; a contextBridge preload script is the only communication bridge; a React renderer mounts xterm.js instances into a CSS Grid, with toolbar buttons and keyboard shortcuts to add/remove terminals.

**Tech Stack:** Electron 31, electron-vite 2, React 18, @xterm/xterm 5, @xterm/addon-fit, @xterm/addon-web-gl, node-pty 1, vitest 2, @testing-library/react 16, jsdom

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | dependencies, scripts, electron-builder config |
| `electron.vite.config.js` | unified build config for main, preload, renderer |
| `vitest.config.js` | vitest with jsdom environment + react plugin |
| `tests/setup.js` | jest-dom matchers, ResizeObserver mock |
| `src/main/index.js` | BrowserWindow bootstrap, loads renderer, calls registerHandlers |
| `src/main/pty-manager.js` | node-pty session lifecycle: create / write / resize / kill |
| `src/main/ipc-handlers.js` | binds IPC channels to pty-manager, forwards pty output to renderer |
| `src/preload/index.js` | contextBridge: exposes `window.electronAPI` to renderer |
| `src/renderer/index.html` | HTML entry point |
| `src/renderer/main.jsx` | React root mount, xterm CSS import |
| `src/renderer/App.jsx` | terminal list state, grid layout, keyboard shortcuts, focused pane tracking |
| `src/renderer/App.css` | app chrome, CSS Grid |
| `src/renderer/components/Toolbar.jsx` | shell picker select + Add Terminal button |
| `src/renderer/components/Toolbar.css` | toolbar styles |
| `src/renderer/components/TerminalPane.jsx` | pane header (shell label, × button), xterm.js container, error/exit state |
| `src/renderer/components/TerminalPane.css` | pane styles |
| `src/renderer/hooks/useTerminal.js` | xterm init, IPC wiring, ResizeObserver, full cleanup on unmount |
| `tests/pty-manager.test.js` | unit tests for pty-manager (node env) |
| `tests/ipc-handlers.test.js` | unit tests for IPC handlers (node env, mocked pty-manager) |
| `tests/components/App.test.jsx` | unit tests for App (mocked TerminalPane) |
| `tests/components/Toolbar.test.jsx` | unit tests for Toolbar |
| `tests/components/TerminalPane.test.jsx` | unit tests for TerminalPane (mocked useTerminal) |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.js`
- Create: `vitest.config.js`
- Create: `tests/setup.js`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "codespace",
  "version": "1.0.0",
  "description": "Vibecoding terminal workspace",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-builder",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "electron-rebuild -f -w node-pty"
  },
  "dependencies": {
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.19.0",
    "@xterm/xterm": "^5.5.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.13.0",
    "electron-rebuild": "^3.2.9",
    "electron-vite": "^2.3.0",
    "jsdom": "^24.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "vitest": "^2.0.0"
  },
  "build": {
    "appId": "com.controlDeck.codespace",
    "productName": "CodeSpace",
    "win": {
      "target": "nsis"
    },
    "files": ["out/**/*"],
    "extraResources": []
  }
}
```

- [ ] **Step 2: Create electron.vite.config.js**

```js
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
```

- [ ] **Step 3: Create vitest.config.js**

```js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    globals: true,
    css: true
  }
})
```

- [ ] **Step 4: Create tests/setup.js**

```js
import '@testing-library/jest-dom'
import { vi } from 'vitest'

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
out/
dist/
.DS_Store
```

- [ ] **Step 6: Install dependencies**

```bash
cd C:/Users/TJ/Desktop/ControlDeck/CodeSpace
npm install
```

Expected: packages install, then `electron-rebuild` runs automatically to compile node-pty for Electron. This may take 1-2 minutes. There will be native compilation output. If `electron-rebuild` fails, run it manually: `npx electron-rebuild -f -w node-pty`

- [ ] **Step 7: Commit**

```bash
git init
git add package.json electron.vite.config.js vitest.config.js tests/setup.js .gitignore
git commit -m "chore: project scaffold — electron-vite, react, xterm.js, node-pty"
```

---

## Task 2: Electron Main Window

**Files:**
- Create: `src/main/index.js`
- Create: `src/renderer/index.html`

- [ ] **Step 1: Create src/main/index.js**

```js
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
```

- [ ] **Step 2: Create src/renderer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CodeSpace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify the window opens**

Run: `npm run dev`

Expected: An Electron window opens with a white/empty page (no renderer content yet). No errors in terminal. Close the window.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/renderer/index.html
git commit -m "feat: electron main window with BrowserWindow bootstrap"
```

---

## Task 3: Preload Bridge

**Files:**
- Create: `src/preload/index.js`

- [ ] **Step 1: Create src/preload/index.js**

```js
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  createPty: (shell) =>
    ipcRenderer.invoke('pty:create', { shell }),

  writePty: (ptyId, data) =>
    ipcRenderer.send('pty:write', { ptyId, data }),

  resizePty: (ptyId, cols, rows) =>
    ipcRenderer.send('pty:resize', { ptyId, cols, rows }),

  killPty: (ptyId) =>
    ipcRenderer.send('pty:kill', { ptyId }),

  onPtyData: (ptyId, callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on(`pty:data:${ptyId}`, handler)
    return () => ipcRenderer.removeListener(`pty:data:${ptyId}`, handler)
  },

  onPtyExit: (ptyId, callback) => {
    const handler = (_event, exitCode) => callback(exitCode)
    ipcRenderer.on(`pty:exit:${ptyId}`, handler)
    return () => ipcRenderer.removeListener(`pty:exit:${ptyId}`, handler)
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.js
git commit -m "feat: contextBridge preload — exposes window.electronAPI to renderer"
```

---

## Task 4: pty-manager (TDD)

**Files:**
- Create: `src/main/pty-manager.js`
- Create: `tests/pty-manager.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/pty-manager.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-pty', () => ({
  default: { spawn: vi.fn() }
}))

import pty from 'node-pty'
import { createSession, writeSession, resizeSession, killSession } from '../src/main/pty-manager.js'

describe('pty-manager', () => {
  let mockProc

  beforeEach(() => {
    vi.clearAllMocks()
    mockProc = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 1234
    }
    pty.spawn.mockReturnValue(mockProc)
  })

  it('createSession spawns powershell.exe and returns id and proc', () => {
    const { id, proc } = createSession('powershell')
    expect(pty.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      [],
      expect.objectContaining({ cols: 80, rows: 24 })
    )
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(proc).toBe(mockProc)
  })

  it('createSession spawns cmd.exe when shell is cmd', () => {
    createSession('cmd')
    expect(pty.spawn).toHaveBeenCalledWith('cmd.exe', [], expect.any(Object))
  })

  it('createSession defaults to powershell for unknown shell', () => {
    createSession('zsh')
    expect(pty.spawn).toHaveBeenCalledWith('powershell.exe', [], expect.any(Object))
  })

  it('writeSession writes data to the proc', () => {
    const { id } = createSession('powershell')
    writeSession(id, 'ls\n')
    expect(mockProc.write).toHaveBeenCalledWith('ls\n')
  })

  it('writeSession is a no-op for unknown id', () => {
    writeSession('nonexistent', 'data')
    expect(mockProc.write).not.toHaveBeenCalled()
  })

  it('resizeSession resizes the proc', () => {
    const { id } = createSession('powershell')
    resizeSession(id, 120, 40)
    expect(mockProc.resize).toHaveBeenCalledWith(120, 40)
  })

  it('killSession kills the proc and removes it', () => {
    const { id } = createSession('powershell')
    killSession(id)
    expect(mockProc.kill).toHaveBeenCalled()
    writeSession(id, 'test')
    expect(mockProc.write).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify all tests fail**

Run: `npm test -- tests/pty-manager.test.js`

Expected: FAIL — "Cannot find module '../src/main/pty-manager.js'"

- [ ] **Step 3: Create src/main/pty-manager.js**

```js
import pty from 'node-pty'
import { randomUUID } from 'crypto'

const SHELLS = {
  powershell: { file: 'powershell.exe', args: [] },
  cmd: { file: 'cmd.exe', args: [] }
}

const sessions = new Map()

export function createSession(shell = 'powershell') {
  const { file, args } = SHELLS[shell] ?? SHELLS.powershell
  const id = randomUUID()
  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.USERPROFILE ?? process.cwd(),
    env: process.env
  })
  sessions.set(id, proc)
  return { id, proc }
}

export function writeSession(id, data) {
  sessions.get(id)?.write(data)
}

export function resizeSession(id, cols, rows) {
  sessions.get(id)?.resize(cols, rows)
}

export function killSession(id) {
  sessions.get(id)?.kill()
  sessions.delete(id)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pty-manager.test.js`

Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/pty-manager.js tests/pty-manager.test.js
git commit -m "feat: pty-manager — create/write/resize/kill node-pty sessions"
```

---

## Task 5: IPC Handlers (TDD)

**Files:**
- Create: `src/main/ipc-handlers.js`
- Create: `tests/ipc-handlers.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/ipc-handlers.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('../src/main/pty-manager.js', () => ({
  createSession: vi.fn(),
  writeSession: vi.fn(),
  resizeSession: vi.fn(),
  killSession: vi.fn()
}))

import { ipcMain } from 'electron'
import { createSession, writeSession, resizeSession, killSession } from '../src/main/pty-manager.js'
import { registerHandlers } from '../src/main/ipc-handlers.js'

describe('ipc-handlers', () => {
  let mockWindow

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow = { webContents: { send: vi.fn() } }
  })

  function getHandler(method, channel) {
    return ipcMain[method].mock.calls.find(c => c[0] === channel)?.[1]
  }

  it('registers pty:create, pty:write, pty:resize, pty:kill', () => {
    registerHandlers(mockWindow)
    expect(ipcMain.handle).toHaveBeenCalledWith('pty:create', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('pty:write', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('pty:resize', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('pty:kill', expect.any(Function))
  })

  it('pty:create returns ptyId', async () => {
    const mockProc = { onData: vi.fn(), onExit: vi.fn() }
    createSession.mockReturnValue({ id: 'abc-123', proc: mockProc })
    registerHandlers(mockWindow)

    const handler = getHandler('handle', 'pty:create')
    const result = await handler({}, { shell: 'powershell' })

    expect(createSession).toHaveBeenCalledWith('powershell')
    expect(result).toEqual({ ptyId: 'abc-123' })
  })

  it('pty:create forwards proc data to renderer via pty:data:<id>', async () => {
    const mockProc = { onData: vi.fn(), onExit: vi.fn() }
    createSession.mockReturnValue({ id: 'abc-123', proc: mockProc })
    registerHandlers(mockWindow)

    const handler = getHandler('handle', 'pty:create')
    await handler({}, { shell: 'powershell' })

    const dataCallback = mockProc.onData.mock.calls[0][0]
    dataCallback('output text')
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:data:abc-123', 'output text')
  })

  it('pty:create forwards exit code to renderer via pty:exit:<id>', async () => {
    const mockProc = { onData: vi.fn(), onExit: vi.fn() }
    createSession.mockReturnValue({ id: 'abc-123', proc: mockProc })
    registerHandlers(mockWindow)

    const handler = getHandler('handle', 'pty:create')
    await handler({}, { shell: 'powershell' })

    const exitCallback = mockProc.onExit.mock.calls[0][0]
    exitCallback({ exitCode: 0 })
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:exit:abc-123', 0)
  })

  it('pty:write calls writeSession', () => {
    registerHandlers(mockWindow)
    const handler = getHandler('on', 'pty:write')
    handler({}, { ptyId: 'abc-123', data: 'ls\n' })
    expect(writeSession).toHaveBeenCalledWith('abc-123', 'ls\n')
  })

  it('pty:resize calls resizeSession', () => {
    registerHandlers(mockWindow)
    const handler = getHandler('on', 'pty:resize')
    handler({}, { ptyId: 'abc-123', cols: 120, rows: 40 })
    expect(resizeSession).toHaveBeenCalledWith('abc-123', 120, 40)
  })

  it('pty:kill calls killSession', () => {
    registerHandlers(mockWindow)
    const handler = getHandler('on', 'pty:kill')
    handler({}, { ptyId: 'abc-123' })
    expect(killSession).toHaveBeenCalledWith('abc-123')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npm test -- tests/ipc-handlers.test.js`

Expected: FAIL — "Cannot find module '../src/main/ipc-handlers.js'"

- [ ] **Step 3: Create src/main/ipc-handlers.js**

```js
import { ipcMain } from 'electron'
import { createSession, writeSession, resizeSession, killSession } from './pty-manager.js'

export function registerHandlers(mainWindow) {
  ipcMain.handle('pty:create', async (_event, { shell }) => {
    const { id, proc } = createSession(shell)
    proc.onData(data => {
      mainWindow.webContents.send(`pty:data:${id}`, data)
    })
    proc.onExit(({ exitCode }) => {
      mainWindow.webContents.send(`pty:exit:${id}`, exitCode)
    })
    return { ptyId: id }
  })

  ipcMain.on('pty:write', (_event, { ptyId, data }) => {
    writeSession(ptyId, data)
  })

  ipcMain.on('pty:resize', (_event, { ptyId, cols, rows }) => {
    resizeSession(ptyId, cols, rows)
  })

  ipcMain.on('pty:kill', (_event, { ptyId }) => {
    killSession(ptyId)
  })
}
```

- [ ] **Step 4: Update src/main/index.js to call registerHandlers**

Replace the content of `src/main/index.js` with:

```js
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerHandlers } from './ipc-handlers.js'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerHandlers(win)
  return win
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npm test`

Expected: PASS — all tests in pty-manager.test.js and ipc-handlers.test.js

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-handlers.js src/main/index.js tests/ipc-handlers.test.js
git commit -m "feat: IPC handlers — route pty:create/write/resize/kill to pty-manager"
```

---

## Task 6: React Scaffold + CSS Grid

**Files:**
- Create: `src/renderer/main.jsx`
- Create: `src/renderer/App.jsx`
- Create: `src/renderer/App.css`
- Create: `tests/components/App.test.jsx`

- [ ] **Step 1: Write failing App tests**

Create `tests/components/App.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../../src/renderer/App.jsx'

// Mock TerminalPane so xterm.js never initialises in tests
vi.mock('../../src/renderer/components/TerminalPane.jsx', () => ({
  default: ({ id, shell, onClose, onFocus }) => (
    <div data-testid={`pane-${id}`} onClick={() => onFocus(id)}>
      <span className="pane-shell-label">{shell}</span>
      <button onClick={(e) => { e.stopPropagation(); onClose(id) }}>×</button>
    </div>
  )
}))

// Stub crypto.randomUUID so IDs are predictable
let uuidCounter = 0
vi.stubGlobal('crypto', { randomUUID: () => `id-${++uuidCounter}` })

describe('App', () => {
  beforeEach(() => {
    uuidCounter = 0
  })

  it('renders toolbar', () => {
    render(<App />)
    expect(screen.getByText('+ Add Terminal')).toBeInTheDocument()
  })

  it('starts with no terminal panes', () => {
    render(<App />)
    expect(screen.queryByTestId(/^pane-/)).not.toBeInTheDocument()
  })

  it('adds a terminal when + Add Terminal is clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    expect(screen.getByTestId('pane-id-1')).toBeInTheDocument()
  })

  it('removes a terminal when × is clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    fireEvent.click(screen.getByText('×'))
    expect(screen.queryByTestId('pane-id-1')).not.toBeInTheDocument()
  })

  it('sets grid to 1 column for 1 terminal', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    const grid = container.querySelector('.grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(1, 1fr)')
  })

  it('sets grid to 4 columns for 4 terminals', () => {
    const { container } = render(<App />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('+ Add Terminal'))
    const grid = container.querySelector('.grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 1fr)')
  })

  it('caps grid at 4 columns for 5+ terminals', () => {
    const { container } = render(<App />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('+ Add Terminal'))
    const grid = container.querySelector('.grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 1fr)')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npm test -- tests/components/App.test.jsx`

Expected: FAIL — "Cannot find module '../../src/renderer/App.jsx'"

- [ ] **Step 3: Create src/renderer/App.css**

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #1a1a1a;
  color: #fff;
  font-family: 'Consolas', 'Cascadia Code', monospace;
  overflow: hidden;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

.grid {
  flex: 1;
  display: grid;
  gap: 4px;
  padding: 4px;
  min-height: 0;
}
```

- [ ] **Step 4: Create src/renderer/App.jsx**

```jsx
import { useState, useCallback, useEffect } from 'react'
import Toolbar from './components/Toolbar.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import './App.css'

export default function App() {
  const [terminals, setTerminals] = useState([])
  const [focusedId, setFocusedId] = useState(null)

  const addTerminal = useCallback((shell) => {
    const id = crypto.randomUUID()
    setTerminals(prev => [...prev, { id, shell }])
  }, [])

  const removeTerminal = useCallback((id) => {
    setTerminals(prev => prev.filter(t => t.id !== id))
    setFocusedId(prev => prev === id ? null : prev)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        addTerminal('powershell')
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (focusedId) removeTerminal(focusedId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addTerminal, removeTerminal, focusedId])

  const cols = Math.min(terminals.length, 4) || 1

  return (
    <div className="app">
      <Toolbar onAdd={addTerminal} />
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {terminals.map(t => (
          <TerminalPane
            key={t.id}
            id={t.id}
            shell={t.shell}
            onClose={removeTerminal}
            onFocus={setFocusedId}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create src/renderer/main.jsx**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/components/App.test.jsx`

Expected: FAIL — "Cannot find module '../../src/renderer/components/TerminalPane.jsx'"

Create a stub so App tests can pass before TerminalPane is built. Create `src/renderer/components/TerminalPane.jsx` with just an empty export for now:

```jsx
export default function TerminalPane() { return null }
```

Run again: `npm test -- tests/components/App.test.jsx`

Expected: PASS — 7 tests

- [ ] **Step 7: Commit**

```bash
git add src/renderer/main.jsx src/renderer/App.jsx src/renderer/App.css src/renderer/components/TerminalPane.jsx tests/components/App.test.jsx
git commit -m "feat: react scaffold — App with CSS Grid, terminal list state, keyboard shortcuts"
```

---

## Task 7: Toolbar Component (TDD)

**Files:**
- Create: `src/renderer/components/Toolbar.jsx`
- Create: `src/renderer/components/Toolbar.css`
- Create: `tests/components/Toolbar.test.jsx`

- [ ] **Step 1: Write failing Toolbar tests**

Create `tests/components/Toolbar.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from '../../src/renderer/components/Toolbar.jsx'

describe('Toolbar', () => {
  it('renders Add Terminal button', () => {
    render(<Toolbar onAdd={vi.fn()} />)
    expect(screen.getByText('+ Add Terminal')).toBeInTheDocument()
  })

  it('renders PowerShell and cmd options', () => {
    render(<Toolbar onAdd={vi.fn()} />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('powershell')
    expect(screen.getByRole('option', { name: 'PowerShell' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'cmd.exe' })).toBeInTheDocument()
  })

  it('calls onAdd with powershell by default', () => {
    const onAdd = vi.fn()
    render(<Toolbar onAdd={onAdd} />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    expect(onAdd).toHaveBeenCalledWith('powershell')
  })

  it('calls onAdd with cmd when cmd selected', () => {
    const onAdd = vi.fn()
    render(<Toolbar onAdd={onAdd} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cmd' } })
    fireEvent.click(screen.getByText('+ Add Terminal'))
    expect(onAdd).toHaveBeenCalledWith('cmd')
  })

  it('shows keyboard shortcut hints', () => {
    render(<Toolbar onAdd={vi.fn()} />)
    expect(screen.getByText(/Ctrl\+T/)).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+W/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npm test -- tests/components/Toolbar.test.jsx`

Expected: FAIL — Toolbar renders null (not yet implemented)

- [ ] **Step 3: Create src/renderer/components/Toolbar.css**

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #111;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.toolbar select {
  background: #2a2a2a;
  color: #fff;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 8px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.toolbar button {
  background: #2a7a2a;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.toolbar button:hover {
  background: #3a9a3a;
}

.hint {
  margin-left: auto;
  font-size: 12px;
  color: #666;
}
```

- [ ] **Step 4: Create src/renderer/components/Toolbar.jsx**

```jsx
import { useState } from 'react'
import './Toolbar.css'

export default function Toolbar({ onAdd }) {
  const [shell, setShell] = useState('powershell')

  return (
    <div className="toolbar">
      <select value={shell} onChange={e => setShell(e.target.value)}>
        <option value="powershell">PowerShell</option>
        <option value="cmd">cmd.exe</option>
      </select>
      <button onClick={() => onAdd(shell)}>+ Add Terminal</button>
      <span className="hint">Ctrl+T add · Ctrl+W close focused</span>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/components/Toolbar.test.jsx`

Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Toolbar.jsx src/renderer/components/Toolbar.css tests/components/Toolbar.test.jsx
git commit -m "feat: Toolbar — shell picker and Add Terminal button with keyboard hints"
```

---

## Task 8: useTerminal Hook

**Files:**
- Create: `src/renderer/hooks/useTerminal.js`

No unit tests for this hook — it integrates xterm.js DOM rendering and live IPC, which are integration concerns. It is tested indirectly via manual smoke testing in Task 11.

- [ ] **Step 1: Create src/renderer/hooks/useTerminal.js**

```js
import { useEffect, useState, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-web-gl'

export default function useTerminal(id, shell, containerRef) {
  const [error, setError] = useState(null)
  const [exitCode, setExitCode] = useState(null)
  const ptyIdRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    try {
      const webglAddon = new WebglAddon()
      term.loadAddon(webglAddon)
    } catch {
      // WebGL not available — xterm.js falls back to canvas renderer
    }

    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    let cleanupData
    let cleanupExit

    window.electronAPI.createPty(shell)
      .then(({ ptyId }) => {
        ptyIdRef.current = ptyId

        cleanupData = window.electronAPI.onPtyData(ptyId, data => {
          term.write(data)
        })

        cleanupExit = window.electronAPI.onPtyExit(ptyId, code => {
          setExitCode(code)
        })

        term.onData(data => {
          window.electronAPI.writePty(ptyId, data)
        })

        window.electronAPI.resizePty(ptyId, term.cols, term.rows)
      })
      .catch(err => {
        setError(err.message ?? 'Failed to start shell')
      })

    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      if (ptyIdRef.current) {
        window.electronAPI.resizePty(ptyIdRef.current, term.cols, term.rows)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      cleanupData?.()
      cleanupExit?.()
      ro.disconnect()
      if (ptyIdRef.current) window.electronAPI.killPty(ptyIdRef.current)
      term.dispose()
    }
  }, []) // intentionally empty — runs once on mount, id/shell are stable

  return { error, exitCode }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/useTerminal.js
git commit -m "feat: useTerminal hook — xterm.js init, IPC wiring, ResizeObserver, cleanup"
```

---

## Task 9: TerminalPane Component (TDD)

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx` (replace the stub from Task 6)
- Create: `src/renderer/components/TerminalPane.css`
- Create: `tests/components/TerminalPane.test.jsx`

- [ ] **Step 1: Write failing TerminalPane tests**

Create `tests/components/TerminalPane.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUseTerminal = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/hooks/useTerminal.js', () => ({
  default: mockUseTerminal
}))

import TerminalPane from '../../src/renderer/components/TerminalPane.jsx'

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTerminal.mockReturnValue({ error: null, exitCode: null })
  })

  it('renders pane header with shell name', () => {
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByText('powershell')).toBeInTheDocument()
  })

  it('renders close button', () => {
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByTitle('Close terminal')).toBeInTheDocument()
  })

  it('calls onClose with id when × is clicked', () => {
    const onClose = vi.fn()
    render(<TerminalPane id="abc" shell="powershell" onClose={onClose} onFocus={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Close terminal'))
    expect(onClose).toHaveBeenCalledWith('abc')
  })

  it('calls onFocus with id when pane is clicked', () => {
    const onFocus = vi.fn()
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={onFocus} />)
    fireEvent.click(screen.getByText('powershell'))
    expect(onFocus).toHaveBeenCalledWith('abc')
  })

  it('shows error message when useTerminal returns an error', () => {
    mockUseTerminal.mockReturnValue({ error: 'spawn failed', exitCode: null })
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByText('spawn failed')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('adds exited class to header when exitCode is not null', () => {
    mockUseTerminal.mockReturnValue({ error: null, exitCode: 1 })
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByText(/exited: 1/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npm test -- tests/components/TerminalPane.test.jsx`

Expected: FAIL — TerminalPane is still the stub (renders null)

- [ ] **Step 3: Create src/renderer/components/TerminalPane.css**

```css
.pane {
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
  min-height: 0;
}

.pane-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background: #111;
  border-bottom: 1px solid #333;
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
  gap: 6px;
}

.pane-header.exited {
  background: #3a1a1a;
  color: #f88;
}

.pane-shell {
  font-family: inherit;
  font-weight: 600;
  color: #aaa;
}

.exit-label {
  color: #f66;
  font-size: 11px;
}

.pane-header .close-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}

.pane-header .close-btn:hover {
  color: #f66;
}

.xterm-container {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

.pane-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #f66;
  font-size: 13px;
}

.pane-error button {
  background: #2a2a2a;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 6px 16px;
  cursor: pointer;
  font-family: inherit;
}

.pane-error button:hover {
  background: #3a3a3a;
}
```

- [ ] **Step 4: Replace stub with real src/renderer/components/TerminalPane.jsx**

```jsx
import { useRef } from 'react'
import useTerminal from '../hooks/useTerminal.js'
import './TerminalPane.css'

export default function TerminalPane({ id, shell, onClose, onFocus }) {
  const containerRef = useRef(null)
  const { error, exitCode } = useTerminal(id, shell, containerRef)

  return (
    <div className="pane" onClick={() => onFocus(id)}>
      <div className={`pane-header${exitCode !== null ? ' exited' : ''}`}>
        <span className="pane-shell">{shell}</span>
        {exitCode !== null && (
          <span className="exit-label">exited: {exitCode}</span>
        )}
        <button
          className="close-btn"
          title="Close terminal"
          onClick={e => { e.stopPropagation(); onClose(id) }}
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="pane-error">
          <span>{error}</span>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : (
        <div className="xterm-container" ref={containerRef} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npm test`

Expected: PASS — all tests across all files

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/TerminalPane.jsx src/renderer/components/TerminalPane.css tests/components/TerminalPane.test.jsx
git commit -m "feat: TerminalPane — xterm container, pane header, error and exit states"
```

---

## Task 10: Verify Full Test Suite

**Files:**
- None

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS — all tests across pty-manager, ipc-handlers, App, Toolbar, TerminalPane

- [ ] **Step 2: Confirm test count**

Expected output includes at least 24 tests passing (7 pty-manager + 7 ipc-handlers + 7 App + 5 Toolbar + 6 TerminalPane). If any fail, fix before proceeding to smoke test.

---

## Task 11: Smoke Test End-to-End

**Files:**
- None

- [ ] **Step 1: Launch the app in dev mode**

Run: `npm run dev`

Expected: Electron window opens showing the dark toolbar with "PowerShell" dropdown and "+ Add Terminal" button.

- [ ] **Step 2: Add one terminal**

Click "+ Add Terminal".

Expected: A terminal pane fills the window. A PowerShell prompt appears within 2–3 seconds.

- [ ] **Step 3: Type a command**

Click inside the terminal and type `Get-Date` then Enter.

Expected: The current date/time is printed in the terminal.

- [ ] **Step 4: Add three more terminals**

Click "+ Add Terminal" three more times.

Expected: Four terminal panes arranged in a 4-column 1-row grid, each with an active PowerShell prompt.

- [ ] **Step 5: Add a fifth terminal**

Click "+ Add Terminal" once more.

Expected: Layout shifts to 4 columns × 2 rows. Five panes visible; the fifth is in the second row.

- [ ] **Step 6: Test cmd terminal**

Change the shell dropdown to "cmd.exe", click "+ Add Terminal".

Expected: A new pane opens with a `C:\Users\TJ>` cmd prompt.

- [ ] **Step 7: Test Ctrl+T**

Press Ctrl+T.

Expected: A new PowerShell terminal pane is added.

- [ ] **Step 8: Test Ctrl+W**

Click inside any terminal pane to focus it, then press Ctrl+W.

Expected: That pane is removed. Grid reflows to fill the space.

- [ ] **Step 9: Close a terminal with the × button**

Click the × button on any pane header.

Expected: That pane is removed.

- [ ] **Step 10: Test resize**

Resize the Electron window by dragging the edge.

Expected: All terminal panes resize proportionally, the xterm.js content reflows to fill the new column width.

- [ ] **Step 11: Final commit**

Close the app window. Confirm `npm test` still passes, then commit.

```bash
npm test
git add -A
git commit -m "feat: codespace terminal app — base complete, all smoke tests passing"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1 | Project scaffold, build config, test config |
| 2 | Electron window opens |
| 3 | Preload bridge wires renderer ↔ main securely |
| 4 | node-pty session management (tested) |
| 5 | IPC channel bindings (tested) |
| 6 | React app, CSS Grid, keyboard shortcuts (tested) |
| 7 | Toolbar with shell picker (tested) |
| 8 | useTerminal hook — xterm.js lifecycle |
| 9 | TerminalPane with error/exit states (tested) |
| 10 | All tests green check |
| 11 | Manual smoke test confirms the full app works |
