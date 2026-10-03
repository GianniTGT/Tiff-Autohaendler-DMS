import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Versionsnummer für «Über uns» — aus der package.json des Projekts, nicht von Hand gepflegt.
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    proxy: {
      '/api': 'http://localhost:3010',
    },
  },
})
