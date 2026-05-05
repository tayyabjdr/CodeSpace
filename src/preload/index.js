import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  createPty: (shell, cwd) =>
    ipcRenderer.invoke('pty:create', { shell, cwd }),

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
  },

  windowMinimize:    () => ipcRenderer.send('win:minimize'),
  windowMaximize:    () => ipcRenderer.send('win:maximize'),
  windowClose:       () => ipcRenderer.send('win:close'),
  windowEnsureMaximized: () => ipcRenderer.send('win:ensureMaximized'),
  windowEnsureRestored:  () => ipcRenderer.send('win:ensureRestored'),
  selectDirectory:   () => ipcRenderer.invoke('dialog:selectDirectory'),
  getDesktopPath:    () => ipcRenderer.invoke('app:getDesktopPath'),
  loadWorkspaces:    () => ipcRenderer.invoke('workspaces:load'),
  saveWorkspaces:    (state) => ipcRenderer.invoke('workspaces:save', state),
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText'),
  writeClipboardText:(text) => ipcRenderer.send('clipboard:writeText', text),
})
