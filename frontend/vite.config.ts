import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only ever talks to our own backend (backend/, port 4000). It holds the
// tokens and calls myCRMSIM; the dev server forwards these paths to it.
const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/oauth': { target: BACKEND, changeOrigin: true },
    },
  },
});
