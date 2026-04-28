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
