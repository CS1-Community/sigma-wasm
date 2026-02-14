// Simple client-side router
import { init as initAstar } from './routes/astar';
import { init as initPreprocessSmolvlm500m } from './routes/preprocess-smolvlm-500m';
import { init as initPreprocessSmolvlm256m } from './routes/preprocess-smolvlm-256m';
import { init as initImageCaptioning } from './routes/image-captioning';
import { init as initFunctionCalling } from './routes/function-calling';
import { init as initFractalChat } from './routes/fractal-chat';
import { init as initHelloWasm } from './routes/hello-wasm';
import { init as initBabylonWfc } from './routes/babylon-wfc';
import { init as initBabylonChunks } from './routes/babylon-chunks';
import { init as initMultilingualChat } from './routes/multilingual-chat';
import { init as initFractalZoom } from './routes/fractal-zoom';
import { registerServiceWorker, setupOfflineHandling } from './pwa/sw-register';

type RouteHandler = () => Promise<void>;

const routes: Map<string, RouteHandler> = new Map();

// Register routes
routes.set('/astar', initAstar);
routes.set('/preprocess-smolvlm-500m', initPreprocessSmolvlm500m);
routes.set('/preprocess-smolvlm-256m', initPreprocessSmolvlm256m);
routes.set('/image-captioning', initImageCaptioning);
routes.set('/function-calling', initFunctionCalling);
routes.set('/fractal-chat', initFractalChat);
routes.set('/hello-wasm', initHelloWasm);
routes.set('/babylon-wfc', initBabylonWfc);
routes.set('/babylon-chunks', initBabylonChunks);
routes.set('/multilingual-chat', initMultilingualChat);
routes.set('/fractal-zoom', initFractalZoom);

async function route(): Promise<void> {
  const path = window.location.pathname;

  // Root path shows landing page - no handler needed
  if (path === '/') {
    return;
  }

  // Try exact match first
  let handler = routes.get(path);

  // If no exact match, try to find a route that matches the start
  if (!handler) {
    for (const [routePath, routeHandler] of routes.entries()) {
      if (path.startsWith(routePath) && routePath !== '/') {
        handler = routeHandler;
        break;
      }
    }
  }

  // Also check for /pages/*.html paths (for direct HTML file access in dev)
  if (!handler) {
    if (path.includes('preprocess-smolvlm-500m')) {
      handler = routes.get('/preprocess-smolvlm-500m');
    } else if (path.includes('preprocess-smolvlm-256m')) {
      handler = routes.get('/preprocess-smolvlm-256m');
    } else if (path.includes('astar')) {
      handler = routes.get('/astar');
    } else if (path.includes('image-captioning')) {
      handler = routes.get('/image-captioning');
    } else if (path.includes('function-calling')) {
      handler = routes.get('/function-calling');
    } else if (path.includes('fractal-chat')) {
      handler = routes.get('/fractal-chat');
    } else if (path.includes('hello-wasm')) {
      handler = routes.get('/hello-wasm');
    } else if (path.includes('babylon-wfc')) {
      handler = routes.get('/babylon-wfc');
    } else if (path.includes('babylon-chunks')) {
      handler = routes.get('/babylon-chunks');
    } else if (path.includes('multilingual-chat')) {
      handler = routes.get('/multilingual-chat');
    } else if (path.includes('fractal-zoom')) {
      handler = routes.get('/fractal-zoom');
    }
  }

  if (handler) {
    try {
      await handler();
    } catch (error) {
      const errorDiv = document.getElementById('error');
      if (errorDiv) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errorDiv.textContent = `Error: ${message}`;
      }
    }
  }
}

// Initialize router when DOM is ready
const initRouter = (): void => {
  route().catch((error) => {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errorDiv.textContent = `Error: ${message}`;
    }
  });
};

// Initialize PWA service worker
const initPWA = (): void => {
  registerServiceWorker().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to initialize PWA:', errorMessage);
  });
  setupOfflineHandling();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initPWA();
  });
} else {
  initRouter();
  initPWA();
}
