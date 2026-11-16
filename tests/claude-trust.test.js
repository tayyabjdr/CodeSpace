// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { trustFolder, forgetFolder, claudeConfigPath, projectKey } from '../src/main/claude-trust.js'

let dir, cfg
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs trust '))
  cfg = join(dir, '.claude.json')
})
const read = () => JSON.parse(readFileSync(cfg, 'utf8'))
const AGENT = 'D:/PC Backup/ControlDeck/.codespace-worktrees/my app/aaaa-1111'
const AGENT_WIN = 'D:\\PC Backup\\ControlDeck\\.codespace-worktrees\\my app\\aaaa-1111'

describe('claude-trust', () => {
  it('uses CLAUDE_CONFIG_DIR when set (tests never touch the real file)', () => {
    expect(claudeConfigPath()).toBe(join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'))
  })

  it('keys a folder the way Claude does: forward slashes, upper-case drive', () => {
    expect(projectKey(AGENT_WIN)).toBe(AGENT)
    expect(projectKey('d:\\x\\.codespace-worktrees\\r\\a\\')).toBe('D:/x/.codespace-worktrees/r/a')
  })

  it('marks an agent folder trusted and keeps everything else in the file', () => {
    const before = { numStartups: 5, oauthAccount: { a: 1 }, projects: { 'D:/other': { hasTrustDialogAccepted: false, allowedTools: ['x'] } } }
    writeFileSync(cfg, JSON.stringify(before, null, 2))
    expect(trustFolder(AGENT_WIN, cfg)).toBe(true)
    const after = read()
    expect(after.projects[AGENT].hasTrustDialogAccepted).toBe(true)
    expect(after.numStartups).toBe(5)
    expect(after.oauthAccount).toEqual({ a: 1 })
    expect(after.projects['D:/other']).toEqual(before.projects['D:/other'])
  })

  it('keeps fields Claude already stored for that folder', () => {
    writeFileSync(cfg, JSON.stringify({ projects: { [AGENT]: { allowedTools: ['Bash'], hasTrustDialogAccepted: false } } }))
    trustFolder(AGENT_WIN, cfg)
    expect(read().projects[AGENT]).toEqual({ allowedTools: ['Bash'], hasTrustDialogAccepted: true })
  })

  it('creates the file when there is none', () => {
    expect(trustFolder(AGENT_WIN, cfg)).toBe(true)
    expect(read().projects[AGENT].hasTrustDialogAccepted).toBe(true)
  })

  it('never writes a file it cannot parse', () => {
    writeFileSync(cfg, '{ "projects": { broken')
    expect(trustFolder(AGENT_WIN, cfg)).toBe(false)
    expect(readFileSync(cfg, 'utf8')).toBe('{ "projects": { broken')
  })

  it('refuses any folder that is not a CodeSpace agent folder', () => {
    writeFileSync(cfg, JSON.stringify({ projects: {} }))
    expect(trustFolder('D:\\PC Backup\\ControlDeck\\some project', cfg)).toBe(false)
    expect(trustFolder('C:\\Users\\TJ', cfg)).toBe(false)
    expect(read().projects).toEqual({})
  })

  it('forgets an agent folder, and nothing else', () => {
    writeFileSync(cfg, JSON.stringify({ projects: { [AGENT]: { hasTrustDialogAccepted: true }, 'D:/keep': { hasTrustDialogAccepted: true } } }))
    expect(forgetFolder(AGENT_WIN, cfg)).toBe(true)
    expect(read().projects).toEqual({ 'D:/keep': { hasTrustDialogAccepted: true } })
  })

  it('never forgets a folder that is not a CodeSpace agent folder', () => {
    writeFileSync(cfg, JSON.stringify({ projects: { 'D:/keep': { hasTrustDialogAccepted: true } } }))
    expect(forgetFolder('D:\\keep', cfg)).toBe(false)
    expect(read().projects).toEqual({ 'D:/keep': { hasTrustDialogAccepted: true } })
  })

  it('forgetting a folder that is not listed leaves the file untouched', () => {
    const body = JSON.stringify({ projects: {} }, null, 2)
    writeFileSync(cfg, body)
    forgetFolder(AGENT_WIN, cfg)
    expect(readFileSync(cfg, 'utf8')).toBe(body)
    expect(existsSync(cfg + '.cs-tmp')).toBe(false)
  })
})
