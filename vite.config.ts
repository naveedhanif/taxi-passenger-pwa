import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: true,
    },
    define: {
      // Bakes the deployed commit SHA + build time directly into the
      // bundle at build time, so the running app can show a version
      // badge — the exact thing missing during earlier debugging, where
      // it was never clear which commit a live deployment was actually
      // running. process.env.VERCEL_GIT_COMMIT_SHA is auto-populated by
      // Vercel on every deploy (no dashboard toggle needed — this reads
      // it in Node during the build, not through Vite's client-side
      // VITE_ prefix rules) and falls back to "local" for `npm run dev`.
      __APP_COMMIT_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local'),
      __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  };
});

