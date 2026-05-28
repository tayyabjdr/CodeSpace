import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import os from 'os'

// Mock electron `app.getPath('userData')` to a tmpdir per-test so each test
// writes to an isolated workspaces.json file.
let tmp
vi.mock('electron', () => ({
  app: {
    getPath: () => tmp
  }
}))

// Import AFTER the mock so the module captures the mocked `app`.
const importStore = () => import('../src/main/workspaces-store.js')

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(os.tmpdir(), 'cs-ws-store-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('sanitizeNickname (via loadWorkspaces)', () => {
  it.each([
    [null,              null],
    [undefined,         null],
    ['',                null],
    ['   ',             null],
    ['ok',              'ok'],
    [' ok ',            'ok'],
    ['x'.repeat(41),    'x'.repeat(40)],
    [123,               null],
    [{},                null],
  ])('coerces %p to %p', async (input, expected) => {
    const { saveWorkspaces, loadWorkspaces } = await importStore()
    await saveWorkspaces({
      workspaces: [{ id: 'w1', name: 'n', dir: 'd', agentCounts: { claude: 0, codex: 0 }, nickname: input }],
      activeWorkspaceId: 'w1'
    })
    const state = await loadWorkspaces()
    expect(state.workspaces[0].nickname).toBe(expected)
  })
})

describe('load/save round-trip', () => {
  it('preserves a valid nickname through save → load', async () => {
    const { saveWorkspaces, loadWorkspaces } = await importStore()
    await saveWorkspaces({
      workspaces: [{ id: 'w1', name: 'n', dir: 'd', agentCounts: { claude: 1, codex: 0 }, nickname: 'client redesign' }],
      activeWorkspaceId: 'w1'
    })
    const state = await loadWorkspaces()
    expect(state.workspaces[0].nickname).toBe('client redesign')
  })

  it('loads legacy JSON (no nickname field) with nickname: null', async () => {
    const path = join(tmp, 'workspaces.json')
    await fs.writeFile(path, JSON.stringify({
      version: 2,
      workspaces: [{ id: 'w1', name: 'old', dir: 'd', agentCounts: { claude: 1, codex: 0 } }],
      activeWorkspaceId: 'w1'
    }), 'utf8')
    const { loadWorkspaces } = await importStore()
    const state = await loadWorkspaces()
    expect(state.workspaces[0].nickname).toBe(null)
  })
})
