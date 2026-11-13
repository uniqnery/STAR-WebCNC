import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const cameraStreamPath = /^\/api\/camera\/[^/?]+\/stream(?:\?|$)/;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (upstream, req, res) => {
            if (!cameraStreamPath.test(req.url ?? '')) return;
            const cancel = () => {
              if (!res.writableEnded) upstream.destroy();
            };
            // Vite handles disconnects after upstream headers arrive.
            if (res.destroyed) cancel();
            else res.once('close', cancel);
          });
          proxy.on('proxyRes', (upstream, req, res) => {
            if (cameraStreamPath.test(req.url ?? '')) {
              upstream.once('aborted', () => res.destroy());
            }
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
