import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the UI on :5173 and forwards API calls to the LinkPulse server on :3000.
// `npm run build` writes the finished site into ../public, which the server already serves.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' } },
});
