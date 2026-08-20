import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' }
  },
  renderer: {
    plugins: [react()],
    build: { outDir: 'out/renderer' },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: false
    }
  }
})
