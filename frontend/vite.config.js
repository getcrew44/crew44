import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = process.env.CREWAI_BACKEND_URL || process.env.CREWAI_BASE_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
