import '@testing-library/jest-dom'
import { vi } from 'vitest'

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Creating an agent folder marks it trusted in Claude's settings file. Point
// every test at a throwaway settings folder so the suite never writes the
// user's real ~/.claude.json.
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cs-claude-config-'))
