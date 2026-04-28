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
