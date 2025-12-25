import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// Custom plugin for dev server routing
function devServerRouting(): Plugin {
  return {
    name: 'dev-server-routing',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (!url) {
          next();
          return;
        }

        // Only handle HTML requests (not assets)
        if (url.endsWith('.html') || (!url.includes('.') && !url.startsWith('/@'))) {
          // Rewrite /astar to /pages/astar.html
          if (url === '/astar' || url.startsWith('/astar?')) {
            req.url = '/pages/astar.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /preprocess-smolvlm-500m to /pages/preprocess-smolvlm-500m.html
          else if (url === '/preprocess-smolvlm-500m' || url.startsWith('/preprocess-smolvlm-500m?')) {
            req.url = '/pages/preprocess-smolvlm-500m.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /preprocess-smolvlm-256m to /pages/preprocess-smolvlm-256m.html
          else if (url === '/preprocess-smolvlm-256m' || url.startsWith('/preprocess-smolvlm-256m?')) {
            req.url = '/pages/preprocess-smolvlm-256m.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /image-captioning to /pages/image-captioning.html
          else if (url === '/image-captioning' || url.startsWith('/image-captioning?')) {
            req.url = '/pages/image-captioning.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /function-calling to /pages/function-calling.html
          else if (url === '/function-calling' || url.startsWith('/function-calling?')) {
            req.url = '/pages/function-calling.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
        }
        next();
      });
    },
  };
}

// Recursively copy directory
function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) {
    return;
  }

  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Plugin to copy pkg directory to dist/pkg during build
function copyWasmModules(): Plugin {
  return {
    name: 'copy-wasm-modules',
    buildEnd() {
      const pkgDir = resolve(__dirname, 'pkg');
      const distPkgDir = resolve(__dirname, 'dist', 'pkg');

      if (existsSync(pkgDir)) {
        copyDir(pkgDir, distPkgDir);
      }
    },
  };
}

export default defineConfig({
  plugins: [devServerRouting(), copyWasmModules()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 0, // Prevent WASM from being inlined as data URIs
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        astar: resolve(__dirname, 'pages/astar.html'),
        'preprocess-smolvlm-500m': resolve(__dirname, 'pages/preprocess-smolvlm-500m.html'),
        'preprocess-smolvlm-256m': resolve(__dirname, 'pages/preprocess-smolvlm-256m.html'),
        'image-captioning': resolve(__dirname, 'pages/image-captioning.html'),
        'function-calling': resolve(__dirname, 'pages/function-calling.html'),
      },
      output: {
        format: 'es',
      },
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  optimizeDeps: {
    exclude: ['../pkg'],
  },
  // Ensure WASM files are treated as static assets
  assetsInclude: ['**/*.wasm'],
});

