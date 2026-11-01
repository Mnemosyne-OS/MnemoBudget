import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standard cartridge configuration (copied from mnemo-crm).
// No fixed dev port: the host opens the BUILT page (renderer "index.html",
// doc 177), so this cartridge holds no entry in apps/dev-ports.json. The
// dev preview (preview.html) is started with `vite --port <free port>`.
export default defineConfig({
  plugins: [react()],
  base: './', // Vital for the mnemo-plugin:// protocol
  server: {
    host: '127.0.0.1',
    cors: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  // Both extensions on purpose: a .test.tsx collected by nobody keeps a suite
  // green while never running it (see the boilerplate's notes).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
} as UserConfig & { test: Record<string, unknown> });
