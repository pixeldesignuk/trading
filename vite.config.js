import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../server/public', emptyOutDir: true },
  server: {
    // Overridable so multiple worktrees can run side by side without colliding.
    // VITE_PORT sets the dev-server port; VITE_API_TARGET points the proxy at the
    // matching backend (defaults keep the original 5283 → 8920 pairing).
    port: Number(process.env.VITE_PORT) || 5283,
    // Allow importing pure shared modules from ../server (e.g. portfolio/satellite-model.js
    // for the live derived pyramid in the targets editor). web/ is the Vite root.
    fs: { allow: ['..'] },
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://localhost:8920',
      '/media': process.env.VITE_API_TARGET || 'http://localhost:8920',
    },
  },
})
