import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { sourcemap: false }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { sourcemap: false }
  },
  renderer: {
    plugins: [react()],
    build: { sourcemap: false },
    // When running dev inside a .codespace worktree, node_modules lives in the
    // parent repo. Vite's default fs.allow only includes the worktree, so font
    // assets from @fontsource-variable/* fail to load and the UI falls back to
    // system fonts. Allow the parent CodeSpace checkout too.
    server: {
      fs: {
        // When running dev inside a .codespace worktree, node_modules lives
        // in the parent repo, outside the worktree's serving allow list.
        // Disable strict checking so font assets from @fontsource-variable
        // resolve correctly. Dev-only — production builds bundle assets.
        strict: false
      }
    }
  }
})
