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
    build: { sourcemap: false }
  }
})
