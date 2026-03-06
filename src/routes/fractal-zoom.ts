import type { WasmFractalZoom, WasmModuleFractalZoom } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';

let wasmModuleExports: {
    default: () => Promise<unknown>;
    generate_fractal: (
        width: number,
        height: number,
        centerX: number,
        centerY: number,
        zoom: number,
        maxIters: number,
        paletteId: number
    ) => Uint8Array;
} | null = null;

const getInitWasm = async (): Promise<unknown> => {
    console.log('[FractalZoom] getInitWasm called');
    if (!wasmModuleExports) {
        console.log('[FractalZoom] importing WASM module...');
        const moduleUnknown: unknown = await import('../../pkg/wasm_fractal_zoom/wasm_fractal_zoom.js');
        console.log('[FractalZoom] import successful', moduleUnknown);

        if (typeof moduleUnknown !== 'object' || moduleUnknown === null) {
            throw new Error('Imported module is not an object');
        }

        // Validate required exports exist
        if (!('default' in moduleUnknown) || typeof (moduleUnknown as any).default !== 'function') {
            throw new Error('Module missing default export or it is not a function');
        }
        if (!('generate_fractal' in moduleUnknown) || typeof (moduleUnknown as any).generate_fractal !== 'function') {
            throw new Error('Module missing generate_fractal export');
        }

        wasmModuleExports = {
            default: (moduleUnknown as any).default as () => Promise<unknown>,
            generate_fractal: (moduleUnknown as any).generate_fractal as any,
        };
    }
    return wasmModuleExports.default();
};

function validateFractalZoomModule(exports: unknown): WasmModuleFractalZoom | null {
    if (!validateWasmModule(exports)) return null;
    if (!wasmModuleExports) return null;

    return {
        memory: (exports as any).memory,
        generate_fractal: wasmModuleExports.generate_fractal,
    };
}

const STATE: WasmFractalZoom & {
    centerX: f64;
    centerY: f64;
    zoom: f64;
    maxIters: number;
    paletteId: number;
    zoomSpeed: number;
    isAutoZooming: boolean;
    isDragging: boolean;
    lastMouseX: number;
    lastMouseY: number;
    canvas: HTMLCanvasElement | null;
    ctx: CanvasRenderingContext2D | null;
} = {
    wasmModule: null,
    wasmModulePath: '../pkg/wasm_fractal_zoom',
    centerX: -0.5,
    centerY: 0,
    zoom: 1.0,
    maxIters: 200,
    paletteId: 0,
    zoomSpeed: 1.1,
    isAutoZooming: false,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    canvas: null,
    ctx: null,
};

type f64 = number;

export const init = async (): Promise<void> => {
    console.log('[FractalZoom] init called');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const canvasEl = document.getElementById('fractal-canvas') as HTMLCanvasElement;
    const paletteSelect = document.getElementById('palette-select') as HTMLSelectElement;
    const iterSlider = document.getElementById('iter-slider') as HTMLInputElement;
    const iterValue = document.getElementById('iter-value');
    const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
    const zoomValue = document.getElementById('zoom-value');

    if (!canvasEl) {
        console.error('[FractalZoom] Canvas element "fractal-canvas" not found');
        return;
    }

    STATE.canvas = canvasEl;
    STATE.ctx = canvasEl.getContext('2d');

    try {
        console.log('[FractalZoom] Loading WASM module...');
        STATE.wasmModule = await loadWasmModule<WasmModuleFractalZoom>(
            getInitWasm,
            validateFractalZoomModule
        );
        if (loadingEl) loadingEl.style.display = 'none';
    } catch (err: any) {
        if (errorEl) errorEl.textContent = `Error: ${err.message}`;
        if (loadingEl) loadingEl.style.display = 'none';
        return;
    }

    // Handle Resize
    const resize = () => {
        canvasEl.width = window.innerWidth;
        canvasEl.height = window.innerHeight;
        render();
    };
    window.addEventListener('resize', resize);
    resize();

    // Controls
    paletteSelect.addEventListener('change', () => {
        STATE.paletteId = parseInt(paletteSelect.value);
        render();
    });

    iterSlider.addEventListener('input', () => {
        STATE.maxIters = parseInt(iterSlider.value);
        if (iterValue) iterValue.textContent = STATE.maxIters.toString();
        render();
    });

    zoomSlider.addEventListener('input', () => {
        STATE.zoomSpeed = parseFloat(zoomSlider.value);
        if (zoomValue) zoomValue.textContent = STATE.zoomSpeed.toFixed(2);
    });

    // Interaction
    canvasEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 1 / STATE.zoomSpeed : STATE.zoomSpeed;

        // Zoom towards mouse
        const rect = canvasEl.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const aspect = canvasEl.width / canvasEl.height;
        const worldX = (mouseX / canvasEl.width - 0.5) * 4.0 * aspect / STATE.zoom + STATE.centerX;
        const worldY = (mouseY / canvasEl.height - 0.5) * 4.0 / STATE.zoom + STATE.centerY;

        STATE.zoom *= zoomFactor;

        STATE.centerX = worldX - (mouseX / canvasEl.width - 0.5) * 4.0 * aspect / STATE.zoom;
        STATE.centerY = worldY - (mouseY / canvasEl.height - 0.5) * 4.0 / STATE.zoom;

        render();
    });

    canvasEl.addEventListener('mousedown', (e) => {
        STATE.isDragging = true;
        STATE.lastMouseX = e.clientX;
        STATE.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!STATE.isDragging) return;
        const dx = e.clientX - STATE.lastMouseX;
        const dy = e.clientY - STATE.lastMouseY;

        const aspect = canvasEl.width / canvasEl.height;
        STATE.centerX -= (dx / canvasEl.width) * 4.0 * aspect / STATE.zoom;
        STATE.centerY -= (dy / canvasEl.height) * 4.0 / STATE.zoom;

        STATE.lastMouseX = e.clientX;
        STATE.lastMouseY = e.clientY;
        render();
    });

    window.addEventListener('mouseup', () => {
        STATE.isDragging = false;
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            STATE.isAutoZooming = !STATE.isAutoZooming;
        }
    });

    // Loop
    const tick = () => {
        if (STATE.isAutoZooming) {
            STATE.zoom *= 1.01;
            render();
        }
        requestAnimationFrame(tick);
    };
    tick();
};

const render = () => {
    if (!STATE.wasmModule || !STATE.canvas || !STATE.ctx) return;

    const width = STATE.canvas.width;
    const height = STATE.canvas.height;

    const imageDataArray = STATE.wasmModule.generate_fractal(
        width,
        height,
        STATE.centerX,
        STATE.centerY,
        STATE.zoom,
        STATE.maxIters,
        STATE.paletteId
    );

    const imageData = new ImageData(
        new Uint8ClampedArray(imageDataArray),
        width,
        height
    );

    STATE.ctx.putImageData(imageData, 0, 0);

    const statsEl = document.getElementById('stats');
    if (statsEl) {
        statsEl.textContent = `Center: ${STATE.centerX.toFixed(4)}, ${STATE.centerY.toFixed(4)} | Zoom: ${STATE.zoom.toExponential(2)}`;
    }
};
