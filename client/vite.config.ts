import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['localhost', '33d3-173-68-85-115.ngrok-free.app', 'bloombar.github.io', 'seriousdata.org'],
  },
})
