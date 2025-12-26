// Simple client-side router
import { init as initAstar } from './routes/astar';
import { init as initPreprocessSmolvlm500m } from './routes/preprocess-smolvlm-500m';
import { init as initPreprocessSmolvlm256m } from './routes/preprocess-smolvlm-256m';
import { init as initImageCaptioning } from './routes/image-captioning';
import { init as initFunctionCalling } from './routes/function-calling';
import { init as initFractalChat } from './routes/fractal-chat';

type RouteHandler = () => Promise<void>;

const routes: Map<string, RouteHandler> = new Map();

// Register routes
routes.set('/astar', initAstar);
routes.set('/preprocess-smolvlm-500m', initPreprocessSmolvlm500m);
routes.set('/preprocess-smolvlm-256m', initPreprocessSmolvlm256m);
routes.set('/image-captioning', initImageCaptioning);
routes.set('/function-calling', initFunctionCalling);
routes.set('/fractal-chat', initFractalChat);

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRouter);
} else {
  initRouter();
}
