// Type definitions for WASM modules

// A* Pathfinding module types
export interface WasmModuleAstar {
  memory: WebAssembly.Memory;
  wasm_init(debug: number, renderIntervalMs: number, windowWidth: number, windowHeight: number): void;
  tick(elapsedTime: number): void;
  key_down(keyCode: number): void;
  key_up(keyCode: number): void;
  mouse_move(x: number, y: number): void;
}

export interface Layer {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  setSize(width: number, height: number, quality: number): void;
  clearScreen(): void;
  drawRect(px: number, py: number, sx: number, sy: number, ch: number, cs: number, cl: number, ca: number): void;
  drawCircle(px: number, py: number, r: number, ch: number, cs: number, cl: number, ca: number): void;
  drawText(text: string, fontSize: number, px: number, py: number): void;
}

export interface WasmAstar {
  wasmModule: WasmModuleAstar | null;
  wasmModulePath: string;
  debug: boolean;
  renderIntervalMs: number;
  layers: Map<number, Layer>;
  layerWrapperEl: HTMLElement | null;
}

// Preprocessing module types
export interface WasmModulePreprocess {
  memory: WebAssembly.Memory;
  preprocess_image(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array;
  preprocess_image_crop(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array;
  preprocess_image_for_smolvlm(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Float32Array;
  apply_contrast(
    imageData: Uint8Array,
    width: number,
    height: number,
    contrast: number
  ): Uint8Array;
  apply_cinematic_filter(
    imageData: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ): Uint8Array;
  get_preprocess_stats(originalSize: number, targetSize: number): PreprocessStats;
  set_contrast(contrast: number): void;
  set_cinematic(intensity: number): void;
  get_contrast(): number;
  get_cinematic(): number;
}

// Preprocessing module types for image-captioning
export interface WasmModulePreprocessImageCaptioning {
  memory: WebAssembly.Memory;
  preprocess_image(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array;
  preprocess_image_crop(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array;
  apply_contrast(
    imageData: Uint8Array,
    width: number,
    height: number,
    contrast: number
  ): Uint8Array;
  apply_cinematic_filter(
    imageData: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ): Uint8Array;
  apply_sepia_filter(
    imageData: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ): Uint8Array;
  get_preprocess_stats(originalSize: number, targetSize: number): PreprocessStats;
  set_contrast(contrast: number): void;
  set_cinematic(intensity: number): void;
  set_sepia(intensity: number): void;
  get_contrast(): number;
  get_cinematic(): number;
  get_sepia(): number;
}

export interface PreprocessStats {
  original_size: number;
  target_size: number;
  scale_factor: number;
}

// Preprocessing module types for 256M
export interface WasmModulePreprocess256M {
  memory: WebAssembly.Memory;
  preprocess_image(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array;
  preprocess_image_crop(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array;
  preprocess_image_for_smolvlm_256m(
    imageData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Float32Array;
  apply_contrast(
    imageData: Uint8Array,
    width: number,
    height: number,
    contrast: number
  ): Uint8Array;
  apply_cinematic_filter(
    imageData: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ): Uint8Array;
  get_preprocess_stats(originalSize: number, targetSize: number): PreprocessStats;
  set_contrast(contrast: number): void;
  set_cinematic(intensity: number): void;
  get_contrast(): number;
  get_cinematic(): number;
}

// Agent tools module types
export interface WasmModuleAgentTools {
  memory: WebAssembly.Memory;
  calculate(expression: string): string;
  process_text(text: string, operation: string): string;
  get_stats(data: Uint8Array): string;
}

// Fractal chat module types
export interface WasmModuleFractalChat {
  memory: WebAssembly.Memory;
  generate_mandelbrot(width: number, height: number): Uint8Array;
  generate_julia(width: number, height: number): Uint8Array;
  generate_buddhabrot(width: number, height: number): Uint8Array;
  generate_orbit_trap(width: number, height: number): Uint8Array;
  generate_gray_scott(width: number, height: number): Uint8Array;
  generate_lsystem(width: number, height: number): Uint8Array;
  generate_fractal_flame(width: number, height: number): Uint8Array;
  generate_strange_attractor(width: number, height: number): Uint8Array;
}

