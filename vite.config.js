import { defineConfig } from 'vite';

// Proxy semua /api ke Node server (server/index.js) supaya API key 9inference
// tetap di sisi server dan tidak ikut ter-bundle ke browser.
export default defineConfig({
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
