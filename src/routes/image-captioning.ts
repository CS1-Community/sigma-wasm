import type { WasmModulePreprocessImageCaptioning } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { WasmLoadError, WasmInitError } from '../wasm/types';
import { loadImageCaptioningModel, generateCaption, isImageCaptioningModelLoaded, getModelId } from '../models/image-captioning';

// Lazy WASM import - only load when init() is called
let wasmModuleExports: {
  default: () => Promise<unknown>;
  preprocess_image: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Uint8Array;
  preprocess_image_crop: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Uint8Array;
  apply_contrast: (imageData: Uint8Array, width: number, height: number, contrast: number) => Uint8Array;
  apply_cinematic_filter: (imageData: Uint8Array, width: number, height: number, intensity: number) => Uint8Array;
  apply_sepia_filter: (imageData: Uint8Array, width: number, height: number, intensity: number) => Uint8Array;
  get_preprocess_stats: (originalSize: number, targetSize: number) => PreprocessStats;
  set_contrast: (contrast: number) => void;
  set_cinematic: (intensity: number) => void;
  set_sepia: (intensity: number) => void;
  get_contrast: () => number;
  get_cinematic: () => number;
  get_sepia: () => number;
} | null = null;

const getInitWasm = async (): Promise<unknown> => {
  if (!wasmModuleExports) {
    const module = await import('../../pkg/wasm_preprocess_image_captioning/wasm_preprocess_image_captioning.js');
    wasmModuleExports = {
      default: module.default,
      preprocess_image: module.preprocess_image,
      preprocess_image_crop: module.preprocess_image_crop,
      apply_contrast: module.apply_contrast,
      apply_cinematic_filter: module.apply_cinematic_filter,
      apply_sepia_filter: module.apply_sepia_filter,
      get_preprocess_stats: module.get_preprocess_stats,
      set_contrast: module.set_contrast,
      set_cinematic: module.set_cinematic,
      set_sepia: module.set_sepia,
      get_contrast: module.get_contrast,
      get_cinematic: module.get_cinematic,
      get_sepia: module.get_sepia,
    };
  }
  if (!wasmModuleExports) {
    throw new Error('Failed to load WASM module exports');
  }
  return wasmModuleExports.default();
};

interface PreprocessStats {
  original_size: number;
  target_size: number;
  scale_factor: number;
}

let wasmModule: WasmModulePreprocessImageCaptioning | null = null;

// Logging function - accessible to all functions
let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;

// Filter state for real-time preview
interface FilterState {
  originalImageData: Uint8Array | null;
  originalWidth: number;
  originalHeight: number;
  contrast: number;
  cinematic: number;
  sepia: number;
}

const filterState: FilterState = {
  originalImageData: null,
  originalWidth: 0,
  originalHeight: 0,
  contrast: 0,
  cinematic: 0,
  sepia: 0,
};

// Debounce timer for filter updates
let filterUpdateTimer: number | null = null;

function validatePreprocessModule(exports: unknown): WasmModulePreprocessImageCaptioning | null {
  if (!validateWasmModule(exports)) {
    return null;
  }
  
  if (typeof exports !== 'object' || exports === null) {
    return null;
  }
  
  const getProperty = (obj: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    return descriptor ? descriptor.value : undefined;
  };
  
  const exportKeys = Object.keys(exports);
  const missingExports: string[] = [];
  
  const memoryValue = getProperty(exports, 'memory');
  if (!memoryValue || !(memoryValue instanceof WebAssembly.Memory)) {
    missingExports.push('memory (WebAssembly.Memory)');
  }
  if (!('preprocess_image' in exports)) {
    missingExports.push('preprocess_image');
  }
  if (!('preprocess_image_crop' in exports)) {
    missingExports.push('preprocess_image_crop');
  }
  if (!('apply_contrast' in exports)) {
    missingExports.push('apply_contrast');
  }
  if (!('apply_cinematic_filter' in exports)) {
    missingExports.push('apply_cinematic_filter');
  }
  if (!('get_preprocess_stats' in exports)) {
    missingExports.push('get_preprocess_stats');
  }
  if (!('set_contrast' in exports)) {
    missingExports.push('set_contrast');
  }
  if (!('set_cinematic' in exports)) {
    missingExports.push('set_cinematic');
  }
  if (!('get_contrast' in exports)) {
    missingExports.push('get_contrast');
  }
  if (!('get_cinematic' in exports)) {
    missingExports.push('get_cinematic');
  }
  if (!('apply_sepia_filter' in exports)) {
    missingExports.push('apply_sepia_filter');
  }
  if (!('set_sepia' in exports)) {
    missingExports.push('set_sepia');
  }
  // High-level functions are on the module object, not the init result
  // Only check for memory in exports, functions are checked in wasmModuleExports below
  if (missingExports.length > 0) {
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  // Get memory using proper type narrowing (already validated above)
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    return null;
  }
  
  // Use the high-level exported functions directly from the module, not from init result
  // The init result has low-level WASM functions, but the module exports high-level wrappers
  if (
    wasmModuleExports &&
    typeof wasmModuleExports.preprocess_image === 'function' &&
    typeof wasmModuleExports.preprocess_image_crop === 'function' &&
    typeof wasmModuleExports.apply_contrast === 'function' &&
    typeof wasmModuleExports.apply_cinematic_filter === 'function' &&
    typeof wasmModuleExports.apply_sepia_filter === 'function' &&
    typeof wasmModuleExports.get_preprocess_stats === 'function' &&
    typeof wasmModuleExports.set_contrast === 'function' &&
    typeof wasmModuleExports.set_cinematic === 'function' &&
    typeof wasmModuleExports.set_sepia === 'function' &&
    typeof wasmModuleExports.get_contrast === 'function' &&
    typeof wasmModuleExports.get_cinematic === 'function' &&
    typeof wasmModuleExports.get_sepia === 'function'
  ) {
    const module: WasmModulePreprocessImageCaptioning = {
      memory: memory,
      preprocess_image: wasmModuleExports.preprocess_image,
      preprocess_image_crop: wasmModuleExports.preprocess_image_crop,
      apply_contrast: wasmModuleExports.apply_contrast,
      apply_cinematic_filter: wasmModuleExports.apply_cinematic_filter,
      apply_sepia_filter: wasmModuleExports.apply_sepia_filter,
      get_preprocess_stats: wasmModuleExports.get_preprocess_stats,
      set_contrast: wasmModuleExports.set_contrast,
      set_cinematic: wasmModuleExports.set_cinematic,
      set_sepia: wasmModuleExports.set_sepia,
      get_contrast: wasmModuleExports.get_contrast,
      get_cinematic: wasmModuleExports.get_cinematic,
      get_sepia: wasmModuleExports.get_sepia,
    };
    return module;
  }
  
  return null;
}

export const init = async (): Promise<void> => {
  const errorDiv = document.getElementById('error');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const processImageBtn = document.getElementById('processImageBtn');
  const systemLogsContent = document.getElementById('systemLogsContent');
  const modelCheckmark = document.getElementById('checkmark-model');
  
  // Logging function for operations
  addLogEntry = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    if (systemLogsContent) {
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.textContent = `[${timestamp}] ${message}`;
      systemLogsContent.appendChild(logEntry);
      systemLogsContent.scrollTop = systemLogsContent.scrollHeight;
    }
    
    // Update checkmark based on log messages
    if (message.includes('Image captioning model loaded') || message.includes('Image captioning model ready') || message.includes('model loaded successfully')) {
      if (modelCheckmark && modelCheckmark instanceof HTMLElement) {
        modelCheckmark.classList.add('visible');
      }
    }
  };
  
  try {
    // Show loading state
    if (loadingIndicator) {
      loadingIndicator.textContent = 'Loading WASM preprocessing module...';
      loadingIndicator.classList.remove('hidden');
    }
    
    // Disable buttons until WASM is ready
    if (processImageBtn instanceof HTMLButtonElement) {
      processImageBtn.disabled = true;
    }
    
    // Use loadWasmModule for proper error handling
    try {
      if (addLogEntry) {
        addLogEntry('Initializing WASM module...', 'info');
      }
      
      wasmModule = await loadWasmModule<WasmModulePreprocessImageCaptioning>(
        getInitWasm,
        validatePreprocessModule
      );
      
      if (!wasmModule) {
        const errorMsg = 'WASM module failed validation';
        if (errorDiv) {
          errorDiv.textContent = `WASM module failed to load: ${errorMsg}`;
        }
        if (addLogEntry) {
          addLogEntry(`WASM module failed to load: ${errorMsg}`, 'error');
        }
        throw new WasmInitError(errorMsg);
      }
      
      if (addLogEntry) {
        addLogEntry('WASM module initialized successfully', 'success');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errorDiv) {
        errorDiv.textContent = `WASM module failed to load: ${errorMsg}`;
      }
      if (addLogEntry) {
        addLogEntry(`WASM module failed to load: ${errorMsg}`, 'error');
        if (error instanceof Error && error.stack) {
          addLogEntry(`Error details: ${error.stack}`, 'error');
        }
      }
      throw error;
    }
    
    // Hide loading, show ready state
    if (loadingIndicator) {
      loadingIndicator.textContent = 'WASM preprocessing module ready!';
      const startTime = performance.now();
      const clearAfterDelay = (): void => {
        if (loadingIndicator) {
          const elapsed = performance.now() - startTime;
          if (elapsed >= 2000) {
            loadingIndicator.textContent = '\u00A0';
            loadingIndicator.classList.add('hidden');
          } else {
            requestAnimationFrame(clearAfterDelay);
          }
        }
      };
      requestAnimationFrame(clearAfterDelay);
    }
    
    // Load image captioning model with progress tracking
    if (loadingIndicator) {
      loadingIndicator.textContent = 'Loading image captioning model... 0%';
      loadingIndicator.classList.remove('hidden');
    }
    
    try {
      await loadImageCaptioningModel(
        (progress: number) => {
          if (loadingIndicator) {
            loadingIndicator.textContent = `Loading image captioning model... ${progress}%`;
          }
        },
        addLogEntry
      );
      
      if (loadingIndicator) {
        loadingIndicator.textContent = `Image captioning model (${getModelId()}) ready!`;
        const startTime = performance.now();
        const clearAfterDelay = (): void => {
          if (loadingIndicator) {
            const elapsed = performance.now() - startTime;
            if (elapsed >= 2000) {
              loadingIndicator.textContent = '\u00A0';
              loadingIndicator.style.visibility = 'hidden';
            } else {
              requestAnimationFrame(clearAfterDelay);
            }
          }
        };
        requestAnimationFrame(clearAfterDelay);
      }
    } catch (error) {
      if (loadingIndicator) {
        loadingIndicator.textContent = '\u00A0';
        loadingIndicator.style.visibility = 'hidden';
      }
      if (errorDiv) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errorDiv.textContent = `Image captioning model failed to load: ${errorMsg}. WASM preprocessing still works.`;
      }
      // Continue without model - preprocessing still works
    }
    
    // Enable buttons now that WASM is ready
    if (processImageBtn instanceof HTMLButtonElement) {
      processImageBtn.disabled = false;
    }
    
    // Setup UI
    setupUI();
  } catch (error) {
    // Clear loading indicator
    if (loadingIndicator) {
      loadingIndicator.textContent = '\u00A0';
      loadingIndicator.style.visibility = 'hidden';
    }
    
    // Disable buttons on error
    if (processImageBtn instanceof HTMLButtonElement) {
      processImageBtn.disabled = true;
    }
    
    // Show detailed error
    if (errorDiv) {
      if (error instanceof WasmLoadError) {
        errorDiv.textContent = `Failed to load WASM preprocessing module: ${error.message}`;
      } else if (error instanceof WasmInitError) {
        errorDiv.textContent = `WASM preprocessing module initialization failed: ${error.message}`;
      } else if (error instanceof Error) {
        errorDiv.textContent = `Error: ${error.message}`;
      } else {
        errorDiv.textContent = 'Unknown error loading WASM preprocessing module';
      }
    }
  }
};

function setupUI(): void {
  const imageInputEl = document.getElementById('imageInput');
  const processImageBtn = document.getElementById('processImageBtn');
  const imageOutputEl = document.getElementById('imageOutput');
  const statsOutputEl = document.getElementById('statsOutput');
  const imagePreviewEl = document.getElementById('imagePreview');
  const imagePreviewContainerEl = document.getElementById('imagePreviewContainer');
  const webcamVideoEl = document.getElementById('webcamVideo');
  const startWebcamBtn = document.getElementById('startWebcamBtn');
  const stopWebcamBtn = document.getElementById('stopWebcamBtn');
  const snapshotBtn = document.getElementById('snapshotBtn');

  if (
    !imageInputEl ||
    !processImageBtn ||
    !imageOutputEl ||
    !statsOutputEl ||
    !imagePreviewEl ||
    !imagePreviewContainerEl ||
    !webcamVideoEl ||
    !startWebcamBtn ||
    !stopWebcamBtn ||
    !snapshotBtn ||
    !(imageInputEl instanceof HTMLInputElement) ||
    !(imageOutputEl instanceof HTMLCanvasElement) ||
    !(statsOutputEl instanceof HTMLDivElement) ||
    !(imagePreviewEl instanceof HTMLImageElement) ||
    !(imagePreviewContainerEl instanceof HTMLDivElement) ||
    !(webcamVideoEl instanceof HTMLVideoElement) ||
    !(startWebcamBtn instanceof HTMLButtonElement) ||
    !(stopWebcamBtn instanceof HTMLButtonElement) ||
    !(snapshotBtn instanceof HTMLButtonElement)
  ) {
    throw new Error('Required UI elements not found');
  }

  // Get filter control elements
  const contrastSliderEl = document.getElementById('contrastSlider');
  const cinematicSliderEl = document.getElementById('cinematicSlider');
  const sepiaSliderEl = document.getElementById('sepiaSlider');
  const contrastValueEl = document.getElementById('contrastValue');
  const cinematicValueEl = document.getElementById('cinematicValue');
  const sepiaValueEl = document.getElementById('sepiaValue');

  if (
    !contrastSliderEl ||
    !cinematicSliderEl ||
    !sepiaSliderEl ||
    !contrastValueEl ||
    !cinematicValueEl ||
    !sepiaValueEl ||
    !(contrastSliderEl instanceof HTMLInputElement) ||
    !(cinematicSliderEl instanceof HTMLInputElement) ||
    !(sepiaSliderEl instanceof HTMLInputElement) ||
    !(contrastValueEl instanceof HTMLElement) ||
    !(cinematicValueEl instanceof HTMLElement) ||
    !(sepiaValueEl instanceof HTMLElement)
  ) {
    throw new Error('Filter control elements not found');
  }

  // Initially hide preview container
  imagePreviewContainerEl.style.display = 'none';
  
  // Initialize webcam elements state
  webcamVideoEl.style.display = 'none';
  stopWebcamBtn.style.display = 'none';
  snapshotBtn.style.display = 'none';
  startWebcamBtn.style.display = 'inline-block';

  // Handle file input change to show preview
  imageInputEl.addEventListener('change', () => {
    if (imageInputEl.files && imageInputEl.files.length > 0) {
      const file = imageInputEl.files[0];
      const url = URL.createObjectURL(file);
      
      const img = new Image();
      img.onload = () => {
        const fileReader = new FileReader();
        fileReader.onload = () => {
          const fileData = fileReader.result;
          if (fileData instanceof ArrayBuffer) {
            filterState.originalImageData = new Uint8Array(fileData);
            filterState.originalWidth = img.width;
            filterState.originalHeight = img.height;
            
            contrastSliderEl.value = '0';
            cinematicSliderEl.value = '0';
            sepiaSliderEl.value = '0';
            filterState.contrast = 0;
            filterState.cinematic = 0;
            filterState.sepia = 0;
            contrastValueEl.textContent = '0';
            cinematicValueEl.textContent = '0';
            sepiaValueEl.textContent = '0';
            
            imagePreviewEl.src = url;
            imagePreviewContainerEl.style.display = 'block';
          }
        };
        fileReader.readAsArrayBuffer(file);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        imagePreviewContainerEl.style.display = 'none';
        if (addLogEntry) {
          addLogEntry('Failed to load image preview', 'error');
        }
      };
      img.src = url;
    } else {
      imagePreviewContainerEl.style.display = 'none';
      imagePreviewEl.src = '';
      filterState.originalImageData = null;
    }
  });

  processImageBtn.addEventListener('click', () => {
    if (!imageInputEl.files || imageInputEl.files.length === 0) {
      if (addLogEntry) {
        addLogEntry('Please select an image file', 'warning');
      }
      return;
    }
    void processImage(imageInputEl.files[0], imageOutputEl, statsOutputEl);
  });

  // Webcam functionality
  let mediaStream: MediaStream | null = null;
  
  startWebcamBtn.addEventListener('click', () => {
    void (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          if (addLogEntry) {
            addLogEntry('Webcam access is not available in this browser', 'error');
          }
          return;
        }
        
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        
        webcamVideoEl.srcObject = mediaStream;
        webcamVideoEl.style.display = 'block';
        startWebcamBtn.style.display = 'none';
        stopWebcamBtn.style.display = 'inline-block';
        snapshotBtn.style.display = 'inline-block';
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (addLogEntry) {
          addLogEntry(`Failed to access webcam: ${errorMsg}`, 'error');
        }
      }
    })();
  });
  
  stopWebcamBtn.addEventListener('click', () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    webcamVideoEl.srcObject = null;
    webcamVideoEl.style.display = 'none';
    startWebcamBtn.style.display = 'inline-block';
    stopWebcamBtn.style.display = 'none';
    snapshotBtn.style.display = 'none';
  });
  
  snapshotBtn.addEventListener('click', () => {
    if (!webcamVideoEl.srcObject) {
      if (addLogEntry) {
        addLogEntry('Webcam not started', 'warning');
      }
      return;
    }
    
    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = webcamVideoEl.videoWidth;
    snapshotCanvas.height = webcamVideoEl.videoHeight;
    const ctx = snapshotCanvas.getContext('2d');
    if (!ctx) {
      if (addLogEntry) {
        addLogEntry('Failed to get canvas context', 'error');
      }
      return;
    }
    
    ctx.drawImage(webcamVideoEl, 0, 0);
    
    snapshotCanvas.toBlob((blob) => {
      if (!blob) {
        if (addLogEntry) {
          addLogEntry('Failed to capture snapshot', 'error');
        }
        return;
      }
      
      const file = new File([blob], 'snapshot.png', { type: 'image/png' });
      
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      if (imageInputEl instanceof HTMLInputElement) {
        imageInputEl.files = dataTransfer.files;
      }
      
      const fileReader = new FileReader();
      fileReader.onload = () => {
        const fileData = fileReader.result;
        if (fileData instanceof ArrayBuffer) {
          filterState.originalImageData = new Uint8Array(fileData);
          filterState.originalWidth = snapshotCanvas.width;
          filterState.originalHeight = snapshotCanvas.height;

          contrastSliderEl.value = '0';
          cinematicSliderEl.value = '0';
          sepiaSliderEl.value = '0';
          filterState.contrast = 0;
          filterState.cinematic = 0;
          filterState.sepia = 0;
          contrastValueEl.textContent = '0';
          cinematicValueEl.textContent = '0';
          sepiaValueEl.textContent = '0';
          
          const url = URL.createObjectURL(blob);
          imagePreviewEl.src = url;
          imagePreviewContainerEl.style.display = 'block';
          imagePreviewEl.onload = () => {
            URL.revokeObjectURL(url);
            applyFiltersToPreview();
          };
        }
      };
      fileReader.readAsArrayBuffer(blob);
    }, 'image/png');
  });

  // Filter slider handlers with debouncing
  const applyFiltersToPreview = (): void => {
    if (!wasmModule || !filterState.originalImageData) {
      return;
    }

    if (filterState.contrast === 0 && filterState.cinematic === 0 && filterState.sepia === 0) {
      if (imageInputEl.files && imageInputEl.files.length > 0) {
        const url = URL.createObjectURL(imageInputEl.files[0]);
        imagePreviewEl.src = url;
        imagePreviewEl.onload = () => {
          URL.revokeObjectURL(url);
        };
      }
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = filterState.originalWidth;
    canvas.height = filterState.originalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const tempImg = new Image();
    const imageDataCopy = new Uint8Array(filterState.originalImageData);
    const originalBlob = new Blob([imageDataCopy], { type: 'image/png' });
    const url = URL.createObjectURL(originalBlob);
    
    tempImg.onload = () => {
      ctx.drawImage(tempImg, 0, 0);
      URL.revokeObjectURL(url);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // System Log: Initial image data info
      if (addLogEntry) {
        const imageDataInfo = {
          type: imageData.data.constructor.name,
          length: imageData.data.length,
          byteLength: imageData.data.byteLength,
          bufferDetached: imageData.data.buffer ? imageData.data.buffer.byteLength === 0 : true
        };
        addLogEntry(`[SYSTEM LOG] Image data from getImageData: ${JSON.stringify(imageDataInfo)}`, 'info');
      }
      
      const rgbaData = new Uint8Array(imageData.data);
      
      // System Log: rgbaData after conversion
      if (addLogEntry) {
        const rgbaDataInfo = {
          type: rgbaData.constructor.name,
          length: rgbaData.length,
          byteLength: rgbaData.byteLength,
          bufferDetached: rgbaData.buffer ? rgbaData.buffer.byteLength === 0 : true,
          isSameBuffer: rgbaData.buffer === imageData.data.buffer,
          byteOffset: rgbaData.byteOffset
        };
        addLogEntry(`[SYSTEM LOG] rgbaData after new Uint8Array(imageData.data): ${JSON.stringify(rgbaDataInfo)}`, 'info');
      }

      // Apply filters in sequence
      let processedData = new Uint8Array(rgbaData);
      
      // System Log: processedData after redundant copy
      if (addLogEntry) {
        const processedDataInfo = {
          type: processedData.constructor.name,
          length: processedData.length,
          byteLength: processedData.byteLength,
          bufferDetached: processedData.buffer ? processedData.buffer.byteLength === 0 : true,
          isSameBuffer: processedData.buffer === rgbaData.buffer,
          byteOffset: processedData.byteOffset,
          expectedSize: filterState.originalWidth * filterState.originalHeight * 4,
          sizeMatch: processedData.length === filterState.originalWidth * filterState.originalHeight * 4
        };
        addLogEntry(`[SYSTEM LOG] processedData after new Uint8Array(rgbaData): ${JSON.stringify(processedDataInfo)}`, 'info');
      }
      
      if (filterState.contrast !== 0 && wasmModule) {
        if (addLogEntry) {
          // System Log: WASM memory state before call
          if (wasmModule.memory) {
            const bufferByteLength = wasmModule.memory.buffer.byteLength;
            addLogEntry(`[SYSTEM LOG] WASM memory before apply_contrast: bufferByteLength=${bufferByteLength}`, 'info');
          }
          addLogEntry(`[SYSTEM LOG] Calling apply_contrast: length=${processedData.length}, width=${filterState.originalWidth}, height=${filterState.originalHeight}, contrast=${filterState.contrast}`, 'info');
        }
        
        try {
          const contrastResult = wasmModule.apply_contrast(
            processedData,
            filterState.originalWidth,
            filterState.originalHeight,
            filterState.contrast
          );
          
          // System Log: contrastResult from WASM
          if (addLogEntry) {
            const contrastResultInfo = {
              type: contrastResult.constructor.name,
              length: contrastResult.length,
              byteLength: contrastResult.byteLength,
              bufferDetached: contrastResult.buffer ? contrastResult.buffer.byteLength === 0 : true
            };
            addLogEntry(`[SYSTEM LOG] contrastResult from WASM: ${JSON.stringify(contrastResultInfo)}`, 'info');
          }
          
          processedData = new Uint8Array(contrastResult);
          
          // System Log: processedData after copy
          if (addLogEntry) {
            const afterCopyInfo = {
              type: processedData.constructor.name,
              length: processedData.length,
              byteLength: processedData.byteLength,
              bufferDetached: processedData.buffer ? processedData.buffer.byteLength === 0 : true,
              isSameBuffer: processedData.buffer === contrastResult.buffer
            };
            addLogEntry(`[SYSTEM LOG] processedData after new Uint8Array(contrastResult): ${JSON.stringify(afterCopyInfo)}`, 'info');
          }
        } catch (error) {
          if (addLogEntry) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            addLogEntry(`[SYSTEM LOG] ERROR in apply_contrast: ${errorMsg}`, 'error');
            if (error instanceof Error && error.stack) {
              addLogEntry(`[SYSTEM LOG] Stack trace: ${error.stack.substring(0, 500)}`, 'error');
            }
          }
          throw error;
        }
      }

      if (filterState.cinematic !== 0 && wasmModule) {
        if (addLogEntry) {
          addLogEntry(`[SYSTEM LOG] Calling apply_cinematic_filter: length=${processedData.length}, width=${filterState.originalWidth}, height=${filterState.originalHeight}, cinematic=${filterState.cinematic}`, 'info');
        }
        
        try {
          const cinematicResult = wasmModule.apply_cinematic_filter(
            processedData,
            filterState.originalWidth,
            filterState.originalHeight,
            filterState.cinematic / 100.0
          );
          
          // System Log: cinematicResult from WASM
          if (addLogEntry) {
            const cinematicResultInfo = {
              type: cinematicResult.constructor.name,
              length: cinematicResult.length,
              byteLength: cinematicResult.byteLength
            };
            addLogEntry(`[SYSTEM LOG] cinematicResult from WASM: ${JSON.stringify(cinematicResultInfo)}`, 'info');
          }
          
          processedData = new Uint8Array(cinematicResult);
          
          // System Log: processedData after copy
          if (addLogEntry) {
            const afterCopyInfo = {
              type: processedData.constructor.name,
              length: processedData.length,
              byteLength: processedData.byteLength
            };
            addLogEntry(`[SYSTEM LOG] processedData after new Uint8Array(cinematicResult): ${JSON.stringify(afterCopyInfo)}`, 'info');
          }
        } catch (error) {
          if (addLogEntry) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            addLogEntry(`[SYSTEM LOG] ERROR in apply_cinematic_filter: ${errorMsg}`, 'error');
            if (error instanceof Error && error.stack) {
              addLogEntry(`[SYSTEM LOG] Stack trace: ${error.stack.substring(0, 500)}`, 'error');
            }
          }
          throw error;
        }
      }

      if (filterState.sepia !== 0 && wasmModule) {
        if (addLogEntry) {
          addLogEntry(`[SYSTEM LOG] Calling apply_sepia_filter: length=${processedData.length}, width=${filterState.originalWidth}, height=${filterState.originalHeight}, sepia=${filterState.sepia}`, 'info');
        }
        
        try {
          const sepiaResult = wasmModule.apply_sepia_filter(
            processedData,
            filterState.originalWidth,
            filterState.originalHeight,
            filterState.sepia / 100.0
          );
          
          // System Log: sepiaResult from WASM
          if (addLogEntry) {
            const sepiaResultInfo = {
              type: sepiaResult.constructor.name,
              length: sepiaResult.length,
              byteLength: sepiaResult.byteLength
            };
            addLogEntry(`[SYSTEM LOG] sepiaResult from WASM: ${JSON.stringify(sepiaResultInfo)}`, 'info');
          }
          
          processedData = new Uint8Array(sepiaResult);
          
          // System Log: processedData after copy
          if (addLogEntry) {
            const afterCopyInfo = {
              type: processedData.constructor.name,
              length: processedData.length,
              byteLength: processedData.byteLength
            };
            addLogEntry(`[SYSTEM LOG] processedData after new Uint8Array(sepiaResult): ${JSON.stringify(afterCopyInfo)}`, 'info');
          }
        } catch (error) {
          if (addLogEntry) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            addLogEntry(`[SYSTEM LOG] ERROR in apply_sepia_filter: ${errorMsg}`, 'error');
            if (error instanceof Error && error.stack) {
              addLogEntry(`[SYSTEM LOG] Stack trace: ${error.stack.substring(0, 500)}`, 'error');
            }
          }
          throw error;
        }
      }

      // Update preview with filtered image
      const filteredImageData = new ImageData(
        new Uint8ClampedArray(processedData),
        filterState.originalWidth,
        filterState.originalHeight
      );
      ctx.putImageData(filteredImageData, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const filteredUrl = URL.createObjectURL(blob);
          imagePreviewEl.src = filteredUrl;
          imagePreviewEl.onload = () => {
            URL.revokeObjectURL(filteredUrl);
            if (url) {
              URL.revokeObjectURL(url);
            }
          };
        }
      }, 'image/png');
    };
    
    if (url) {
      tempImg.src = url;
    }
  };

  const debouncedApplyFilters = (): void => {
    if (filterUpdateTimer !== null) {
      cancelAnimationFrame(filterUpdateTimer);
    }
    filterUpdateTimer = requestAnimationFrame(() => {
      applyFiltersToPreview();
      filterUpdateTimer = null;
    });
  };

  contrastSliderEl.addEventListener('input', () => {
    const value = Number.parseInt(contrastSliderEl.value, 10);
    contrastValueEl.textContent = value.toString();
    if (wasmModule) {
      wasmModule.set_contrast(value);
      filterState.contrast = value;
      debouncedApplyFilters();
    }
  });

  cinematicSliderEl.addEventListener('input', () => {
    const value = Number.parseInt(cinematicSliderEl.value, 10);
    cinematicValueEl.textContent = value.toString();
    if (wasmModule) {
      wasmModule.set_cinematic(value);
      filterState.cinematic = value;
      debouncedApplyFilters();
    }
  });

  sepiaSliderEl.addEventListener('input', () => {
    const value = Number.parseInt(sepiaSliderEl.value, 10);
    sepiaValueEl.textContent = value.toString();
    if (wasmModule) {
      wasmModule.set_sepia(value);
      filterState.sepia = value;
      debouncedApplyFilters();
    }
  });
}

function processImage(file: File, canvas: HTMLCanvasElement, statsDiv: HTMLDivElement): Promise<void> {
  const module = wasmModule;
  if (!module) {
    return Promise.reject(new Error('WASM module not initialized'));
  }

  return new Promise<void>((resolve, reject) => {
    const fileReader = new FileReader();
    
    fileReader.onload = () => {
      const fileData = fileReader.result;
      if (!(fileData instanceof ArrayBuffer)) {
        reject(new Error('Failed to read file as ArrayBuffer'));
        return;
      }
      
      const imageBytes = new Uint8Array(fileData);
      
      // Validate image data before processing
      if (imageBytes.length === 0) {
        reject(new Error('Image file is empty'));
        return;
      }
      
      // Basic validation: check for common image file signatures
      // Note: We allow any file through and let the WASM module handle decoding errors
      // The WASM module will return a proper error if the image format is unsupported
      
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = async () => {
        URL.revokeObjectURL(url);
        
        // Validate image dimensions
        if (img.width === 0 || img.height === 0) {
          reject(new Error('Invalid image dimensions'));
          return;
        }
        
        const targetWidth = 384;
        const targetHeight = 384;
        
        let processedData: Uint8Array;
        try {
          // Ensure WASM module is ready and function exists
          if (!module || typeof module.preprocess_image_crop !== 'function') {
            reject(new Error('WASM module not properly initialized'));
            return;
          }
          
          // Ensure imageBytes is a valid Uint8Array
          if (!(imageBytes instanceof Uint8Array) || imageBytes.length === 0) {
            reject(new Error('Invalid image data'));
            return;
          }
          
          // Call WASM preprocessing - it handles image decoding internally
          // The function returns Result<Vec<u8>, JsValue> which wasm-bindgen converts to throwing on error
          processedData = module.preprocess_image_crop(
            imageBytes,
            img.width,
            img.height,
            targetWidth,
            targetHeight
          );
          
          // Validate processed data
          if (!processedData || !(processedData instanceof Uint8Array) || processedData.length === 0) {
            reject(new Error('WASM preprocessing returned invalid data'));
            return;
          }
          
          const expectedSize = targetWidth * targetHeight * 4;
          if (processedData.length !== expectedSize) {
            reject(new Error(`Processed image size mismatch: expected ${expectedSize}, got ${processedData.length}`));
            return;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          // Provide more detailed error information for debugging
          const detailedError = error instanceof Error && error.stack 
            ? `${errorMsg}\nStack: ${error.stack.substring(0, 300)}`
            : errorMsg;
          reject(new Error(`WASM preprocessing failed: ${detailedError}`));
          return;
        }
        
        // Apply filters if any are set
        if (wasmModule && (filterState.contrast !== 0 || filterState.cinematic !== 0 || filterState.sepia !== 0)) {
          let filteredData = new Uint8Array(processedData);
          
          // Apply contrast filter
          if (filterState.contrast !== 0) {
            const contrastResult = wasmModule.apply_contrast(
              filteredData,
              targetWidth,
              targetHeight,
              filterState.contrast
            );
            filteredData = new Uint8Array(contrastResult);
          }
          
          // Apply cinematic filter
          if (filterState.cinematic !== 0) {
            const cinematicResult = wasmModule.apply_cinematic_filter(
              filteredData,
              targetWidth,
              targetHeight,
              filterState.cinematic / 100.0
            );
            filteredData = new Uint8Array(cinematicResult);
          }
          
          // Apply sepia filter
          if (filterState.sepia !== 0) {
            const sepiaResult = wasmModule.apply_sepia_filter(
              filteredData,
              targetWidth,
              targetHeight,
              filterState.sepia / 100.0
            );
            filteredData = new Uint8Array(sepiaResult);
          }
          
          // Use filtered data instead of processed data
          processedData = filteredData;
        }
        
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        const processedImageData = new ImageData(
          new Uint8ClampedArray(processedData),
          targetWidth,
          targetHeight
        );
        ctx.putImageData(processedImageData, 0, 0);
        
        const stats = module.get_preprocess_stats(img.width, targetWidth);
        statsDiv.innerHTML = `
          <h3>Preprocessing Stats</h3>
          <p>Original: ${stats.original_size}x${stats.original_size}</p>
          <p>Target: ${stats.target_size}x${stats.target_size}</p>
          <p>Scale Factor: ${stats.scale_factor.toFixed(2)}</p>
        `;
        
        // Run image captioning inference if model is loaded
        if (isImageCaptioningModelLoaded()) {
          statsDiv.innerHTML += '<p><strong>Running image captioning inference...</strong></p>';
          
          try {
            // Convert canvas to data URL string - Transformers.js supports string inputs
            const dataUrl = canvas.toDataURL('image/png');
            const caption = await generateCaption(dataUrl, addLogEntry || undefined);
            
            statsDiv.innerHTML += `
              <h3>Image Captioning Result</h3>
              <p>${caption}</p>
            `;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            const errorP = document.createElement('p');
            errorP.className = 'error-text';
            errorP.textContent = `Image captioning error: ${errorMsg}`;
            statsDiv.appendChild(errorP);
          }
        }
        resolve();
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      
      img.src = url;
    };
    
    fileReader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    fileReader.readAsArrayBuffer(file);
  });
}

