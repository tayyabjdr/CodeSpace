// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { mentionsFolder, processesUsing, killProcessesIn, setProcessReaperImpl } from '../../src/main/process-reaper.js'

const WT = 'D:\\PC Backup\\ControlDeck\\.codespace-worktrees\\Hub\\b17a17b7-ce9b-4dfc-8cf0-312a5fdd8cd7'
const OTHER = 'D:\\PC Backup\\ControlDeck\\.codespace-worktrees\\Hub\\8919b47f-4661-47a7-84ec-7a4cab001a45'

// The shape seen on a real machine: an orphaned `next dev` whose parents had
// exited, next to another agent's dev server that must be left alone.
const LIST = [
  { ProcessId: 12372, ParentProcessId: 2360, ExecutablePath: 'C:\\WINDOWS\\system32\\cmd.exe', CommandLine: 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c next dev --webpack -p 3101' },
  { ProcessId: 8184, ParentProcessId: 12372, ExecutablePath: 'C:\\nvm4w\\nodejs\\node.exe', CommandLine: `"node"   "${WT}\\node_modules\\.bin\\\\..\\next\\dist\\bin\\next" dev --webpack -p 3101` },
  { ProcessId: 27608, ParentProcessId: 8184, ExecutablePath: 'C:\\nvm4w\\nodejs\\node.exe', CommandLine: 'C:\\nvm4w\\nodejs\\node.exe "D:\\PC Backup\\ControlDeck\\Hub\\node_modules\\next\\dist\\server\\lib\\start-server.js"' },
  { ProcessId: 14784, ParentProcessId: 21888, ExecutablePath: 'C:\\nvm4w\\nodejs\\node.exe', CommandLine: `"node"   "${OTHER}\\node_modules\\.bin\\\\..\\next\\dist\\bin\\next" dev -p 3100 --webpack` },
  { ProcessId: 500, ParentProcessId: 8184, ExecutablePath: `${WT}\\tools\\helper.exe`, CommandLine: 'helper.exe' },
]

describe('mentionsFolder', () => {
  it('matches the folder and paths inside it, any slash or case', () => {
    expect(mentionsFolder(`${WT}\\src\\x.js`, WT)).toBe(true)
    expect(mentionsFolder(`"${WT}"`, WT)).toBe(true)
    expect(mentionsFolder(WT.replace(/\\/g, '/').toUpperCase() + '/a', WT)).toBe(true)
    expect(mentionsFolder(`cd ${WT} && npm run dev`, WT)).toBe(true)
  })

  it('does not match a sibling whose name starts the same', () => {
    expect(mentionsFolder(`${WT}-old\\x.js`, WT)).toBe(false)
    expect(mentionsFolder(`${WT}abc`, WT)).toBe(false)
    expect(mentionsFolder(`${OTHER}\\x.js`, WT)).toBe(false)
  })

  it('ignores empty input and too-short folders', () => {
    expect(mentionsFolder(null, WT)).toBe(false)
    expect(mentionsFolder('C:\\x', 'C:\\')).toBe(false)
  })
})

describe('processesUsing', () => {
  it("picks this agent's processes, top-most only, and leaves other agents alone", () => {
    expect(processesUsing(LIST, WT, [])).toEqual([8184])
  })

  it('never returns CodeSpace itself', () => {
    expect(processesUsing(LIST, WT, [8184])).toEqual([500])
  })
})

describe('killProcessesIn', () => {
  afterEach(() => setProcessReaperImpl())

  it('kills each match and reports it', async () => {
    const killed = []
    setProcessReaperImpl({ list: async () => LIST, kill: async (pid) => { killed.push(pid) } })
    expect(await killProcessesIn(WT)).toEqual([8184])
    expect(killed).toEqual([8184])
  })

  it('never throws when listing or killing fails', async () => {
    setProcessReaperImpl({ list: async () => { throw new Error('boom') } })
    expect(await killProcessesIn(WT)).toEqual([])
    setProcessReaperImpl({ list: async () => LIST, kill: async () => { throw new Error('nope') } })
    expect(await killProcessesIn(WT)).toEqual([8184])
  })
})
