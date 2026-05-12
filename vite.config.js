import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'child_process';
import { platform } from 'os';

// Dev-only plugin: POST /dev/open-folder { path } opens the folder in the
// OS file manager. Not included in production builds.
function openFolderPlugin() {
  return {
    name: 'dev-open-folder',
    configureServer(server) {
      server.middlewares.use('/dev/open-folder', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { path } = JSON.parse(body);
            if (!path || typeof path !== 'string') {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'no path' }));
              return;
            }
            // execFile avoids shell injection — path is passed as a raw arg
            const cmd = platform() === 'win32' ? 'explorer' : platform() === 'darwin' ? 'open' : 'xdg-open';
            execFile(cmd, [path], (err) => {
              res.statusCode = err ? 500 : 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(err ? JSON.stringify({ error: err.message }) : '{"ok":true}');
            });
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

const backendTarget = process.env.CREWAI_BACKEND_URL || process.env.CREWAI_BASE_URL || 'http://localhost:8080';

export default defineConfig({
  base: './',
  plugins: [react(), openFolderPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}'],
  },
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
