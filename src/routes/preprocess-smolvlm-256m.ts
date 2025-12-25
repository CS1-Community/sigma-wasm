import type { WasmModulePreprocess256M } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { WasmLoadError, WasmInitError } from '../wasm/types';
import { loadSmolVLM256M, generateResponse256M, isSmolVLM256MLoaded } from '../models/smolvlm-256m';

// Lazy WASM import - only load when init() is called
// Using a getter function to defer the import until actually needed
let wasmModuleExports: {
  default: () => Promise<unknown>;
  preprocess_image: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Uint8Array;
  preprocess_image_crop: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Uint8Array;
  preprocess_image_for_smolvlm_256m: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Float32Array;
  apply_contrast: (imageData: Uint8Array, width: number, height: number, contrast: number) => Uint8Array;
  apply_cinematic_filter: (imageData: Uint8Array, width: number, height: number, intensity: number) => Uint8Array;
  get_preprocess_stats: (originalSize: number, targetSize: number) => PreprocessStats;
  set_contrast: (contrast: number) => void;
  set_cinematic: (intensity: number) => void;
  get_contrast: () => number;
  get_cinematic: () => number;
} | null = null;

const getInitWasm = async (): Promise<unknown> => {
  if (!wasmModuleExports) {
    // Import only when first called - get both init and exported functions
    const module = await import('../../pkg/wasm_preprocess_256m/wasm_preprocess_256m.js');
    wasmModuleExports = {
      default: module.default,
      preprocess_image: module.preprocess_image,
      preprocess_image_crop: module.preprocess_image_crop,
      preprocess_image_for_smolvlm_256m: module.preprocess_image_for_smolvlm_256m,
      apply_contrast: module.apply_contrast,
      apply_cinematic_filter: module.apply_cinematic_filter,
      get_preprocess_stats: module.get_preprocess_stats,
      set_contrast: module.set_contrast,
      set_cinematic: module.set_cinematic,
      get_contrast: module.get_contrast,
      get_cinematic: module.get_cinematic,
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

let wasmModule: WasmModulePreprocess256M | null = null;

// Logging function - accessible to all functions
let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;

// Filter state for real-time preview
interface FilterState {
  originalImageData: Uint8Array | null;
  originalWidth: number;
  originalHeight: number;
  contrast: number;
  cinematic: number;
}

const filterState: FilterState = {
  originalImageData: null,
  originalWidth: 0,
  originalHeight: 0,
  contrast: 0,
  cinematic: 0,
};

// Debounce timer for filter updates
let filterUpdateTimer: number | null = null;

// Type for wasm-bindgen exports
interface WasmBindgenExports {
  memory?: WebAssembly.Memory;
  preprocess_image?: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Uint8Array;
  preprocess_image_crop?: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Uint8Array;
  preprocess_image_for_smolvlm_256m?: (imageData: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) => Float32Array;
  apply_contrast?: (imageData: Uint8Array, width: number, height: number, contrast: number) => Uint8Array;
  apply_cinematic_filter?: (imageData: Uint8Array, width: number, height: number, intensity: number) => Uint8Array;
  get_preprocess_stats?: (originalSize: number, targetSize: number) => PreprocessStats;
  set_contrast?: (contrast: number) => void;
  set_cinematic?: (intensity: number) => void;
  get_contrast?: () => number;
  get_cinematic?: () => number;
}

function validatePreprocessModule(exports: unknown): WasmModulePreprocess256M | null {
  if (!validateWasmModule(exports)) {
    return null;
  }
  
  if (typeof exports !== 'object' || exports === null) {
    return null;
  }
  
  // Check for required exports and provide detailed error info
  // Use Object.getOwnPropertyDescriptor to access properties without type assertion
  const getProperty = (obj: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    return descriptor ? descriptor.value : undefined;
  };
  
  const exportKeys = Object.keys(exports);
  const missingExports: string[] = [];
  
  // Check for required exports
  // High-level functions are on the module object, not the init result
  // Only check for memory in exports, functions are checked in wasmModuleExports below
  const memoryValue = getProperty(exports, 'memory');
  if (!memoryValue || !(memoryValue instanceof WebAssembly.Memory)) {
    missingExports.push('memory (WebAssembly.Memory)');
  }
  
  if (missingExports.length > 0) {
    // Throw error with details for debugging
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  // At this point we know memory exists and is WebAssembly.Memory
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error('WASM module memory is not WebAssembly.Memory');
  }
  
  // Create exports record for function access
  const exportsRecord: Record<string, unknown> = {};
  for (const key of exportKeys) {
    exportsRecord[key] = getProperty(exports, key);
  }
  
  // Type guard to check if result has expected structure (memory from init result)
  const initResult: WasmBindgenExports = 
    typeof exports === 'object' && exports !== null
      ? exports
      : {};
  
  // Use the high-level exported functions directly from the module, not from init result
  // The init result has low-level WASM functions, but the module exports high-level wrappers
  if (
    initResult.memory &&
    initResult.memory instanceof WebAssembly.Memory &&
    wasmModuleExports &&
    typeof wasmModuleExports.preprocess_image === 'function' &&
    typeof wasmModuleExports.preprocess_image_crop === 'function' &&
    typeof wasmModuleExports.preprocess_image_for_smolvlm_256m === 'function' &&
    typeof wasmModuleExports.apply_contrast === 'function' &&
    typeof wasmModuleExports.apply_cinematic_filter === 'function' &&
    typeof wasmModuleExports.get_preprocess_stats === 'function' &&
    typeof wasmModuleExports.set_contrast === 'function' &&
    typeof wasmModuleExports.set_cinematic === 'function' &&
    typeof wasmModuleExports.get_contrast === 'function' &&
    typeof wasmModuleExports.get_cinematic === 'function'
  ) {
    const module: WasmModulePreprocess256M = {
      memory: initResult.memory,
      preprocess_image: wasmModuleExports.preprocess_image,
      preprocess_image_crop: wasmModuleExports.preprocess_image_crop,
      preprocess_image_for_smolvlm_256m: wasmModuleExports.preprocess_image_for_smolvlm_256m,
      apply_contrast: wasmModuleExports.apply_contrast,
      apply_cinematic_filter: wasmModuleExports.apply_cinematic_filter,
      get_preprocess_stats: wasmModuleExports.get_preprocess_stats,
      set_contrast: wasmModuleExports.set_contrast,
      set_cinematic: wasmModuleExports.set_cinematic,
      get_contrast: wasmModuleExports.get_contrast,
      get_cinematic: wasmModuleExports.get_cinematic,
    };
    return module;
  }
  
  return null;
}

export const init = async (): Promise<void> => {
  const errorDiv = document.getElementById('error');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const processImageBtn = document.getElementById('processImageBtn');
  const processVQABtn = document.getElementById('processVQABtn');
  const downloadLogsContent = document.getElementById('downloadLogsContent');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  
  // Clear cache button handler
  if (clearCacheBtn && clearCacheBtn instanceof HTMLButtonElement) {
    clearCacheBtn.addEventListener('click', () => {
      void (async () => {
        try {
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            const modelCacheNames = cacheNames.filter(name => name.startsWith('smolvlm-models'));
            await Promise.all(modelCacheNames.map(name => caches.delete(name)));
            if (downloadLogsContent) {
              const timestamp = new Date().toLocaleTimeString();
              const logEntry = document.createElement('div');
              logEntry.className = 'log-entry success';
              logEntry.textContent = `[${timestamp}] Cache cleared successfully`;
              downloadLogsContent.appendChild(logEntry);
              downloadLogsContent.scrollTop = downloadLogsContent.scrollHeight;
            }
            // Reset checkmarks
            const visionEncoderCheckmark = document.getElementById('checkmark-vision-encoder');
            const decoderCheckmark = document.getElementById('checkmark-decoder');
            const embedTokensCheckmark = document.getElementById('checkmark-embed-tokens');
            const tokenizerCheckmark = document.getElementById('checkmark-tokenizer');
            if (visionEncoderCheckmark && visionEncoderCheckmark instanceof HTMLElement) {
              visionEncoderCheckmark.classList.remove('visible');
            }
            if (decoderCheckmark && decoderCheckmark instanceof HTMLElement) {
              decoderCheckmark.classList.remove('visible');
            }
            if (embedTokensCheckmark && embedTokensCheckmark instanceof HTMLElement) {
              embedTokensCheckmark.classList.remove('visible');
            }
            if (tokenizerCheckmark && tokenizerCheckmark instanceof HTMLElement) {
              tokenizerCheckmark.classList.remove('visible');
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (downloadLogsContent) {
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry error';
            logEntry.textContent = `[${timestamp}] Failed to clear cache: ${errorMsg}`;
            downloadLogsContent.appendChild(logEntry);
            downloadLogsContent.scrollTop = downloadLogsContent.scrollHeight;
          }
        }
      })();
    });
  }
  
  // Get checkmark elements for use in addLogEntry
  const visionEncoderCheckmark = document.getElementById('checkmark-vision-encoder');
  const decoderCheckmark = document.getElementById('checkmark-decoder');
  const embedTokensCheckmark = document.getElementById('checkmark-embed-tokens');
  const tokenizerCheckmark = document.getElementById('checkmark-tokenizer');
  
  // Logging function for download operations
  addLogEntry = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    if (downloadLogsContent) {
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.textContent = `[${timestamp}] ${message}`;
      downloadLogsContent.appendChild(logEntry);
      // Auto-scroll to bottom
      downloadLogsContent.scrollTop = downloadLogsContent.scrollHeight;
    }
    
    // Update checkmarks based on log messages
    if (message.includes('Vision encoder loaded') || message.includes('Vision encoder found in cache') || message.includes('Vision encoder loaded from cache') || message.includes('Vision encoder initialized successfully')) {
      if (visionEncoderCheckmark && visionEncoderCheckmark instanceof HTMLElement) {
        visionEncoderCheckmark.classList.add('visible');
      }
    } else if (message.includes('Decoder loaded') || message.includes('Decoder model found in cache') || message.includes('Decoder model loaded from cache') || message.includes('Decoder initialized successfully')) {
      if (decoderCheckmark && decoderCheckmark instanceof HTMLElement) {
        decoderCheckmark.classList.add('visible');
      }
    } else if (message.includes('Embedding model loaded') || message.includes('Embedding model loaded successfully')) {
      if (embedTokensCheckmark && embedTokensCheckmark instanceof HTMLElement) {
        embedTokensCheckmark.classList.add('visible');
      }
    } else if (message.includes('Tokenizer loaded') || message.includes('Tokenizer found in cache') || message.includes('Tokenizer loaded from cache') || message.includes('Tokenizer downloaded and parsed')) {
      if (tokenizerCheckmark && tokenizerCheckmark instanceof HTMLElement) {
        tokenizerCheckmark.classList.add('visible');
      }
    }
  }
  
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
    if (processVQABtn instanceof HTMLButtonElement) {
      processVQABtn.disabled = true;
    }
    
    // Use loadWasmModule for proper error handling
    // This will initialize the WASM module and validate exports
    wasmModule = await loadWasmModule<WasmModulePreprocess256M>(
      getInitWasm,
      validatePreprocessModule
    );
    
    // Verify module is ready
    if (!wasmModule) {
      throw new WasmInitError('WASM module failed validation');
    }
    
    // Hide loading, show ready state
    if (loadingIndicator) {
      loadingIndicator.textContent = 'WASM preprocessing module ready!';
      // Clear after 2 seconds using requestAnimationFrame, but keep space reserved
      const startTime = performance.now();
      const clearAfterDelay = (): void => {
        if (loadingIndicator) {
          const elapsed = performance.now() - startTime;
          if (elapsed >= 2000) {
            loadingIndicator.textContent = '\u00A0'; // Non-breaking space to maintain height
            loadingIndicator.classList.add('hidden');
          } else {
            requestAnimationFrame(clearAfterDelay);
          }
        }
      };
      requestAnimationFrame(clearAfterDelay);
    }
    
    // Load SmolVLM-256M model with progress tracking
    // The loadSmolVLM256M function will report initialization progress
    if (loadingIndicator) {
      loadingIndicator.textContent = 'Initializing ONNX Runtime... 0%';
      loadingIndicator.classList.remove('hidden');
    }
    
    // Checkmarks are visible by default (pending state with orange color)
    // No need to set display - they're already flex in CSS
    // Checkmark detection is now handled in addLogEntry function
    
    try {
      await loadSmolVLM256M(
        (progress: number, message: string) => {
          if (loadingIndicator) {
            loadingIndicator.textContent = `${message} ${progress}%`;
          }
          
          // Show checkmarks when each component completes or is found in cache
          // Note: Most checkmarks are now handled in addLogEntry, but we keep this
          // for progress callback messages that might not go through addLogEntry
          if (message.includes('Vision encoder loaded') || message.includes('Vision encoder found in cache') || message.includes('Vision encoder loaded from cache')) {
            if (visionEncoderCheckmark && visionEncoderCheckmark instanceof HTMLElement) {
              visionEncoderCheckmark.classList.add('visible');
            }
          } else if (message.includes('Decoder loaded') || message.includes('Decoder model found in cache') || message.includes('Decoder model loaded from cache')) {
            if (decoderCheckmark && decoderCheckmark instanceof HTMLElement) {
              decoderCheckmark.classList.add('visible');
            }
          } else if (message.includes('Tokenizer loaded') || message.includes('Tokenizer found in cache') || message.includes('Tokenizer loaded from cache')) {
            if (tokenizerCheckmark && tokenizerCheckmark instanceof HTMLElement) {
              tokenizerCheckmark.classList.add('visible');
            }
          }
        },
        addLogEntry
      );
      
      if (loadingIndicator) {
        loadingIndicator.textContent = 'SmolVLM-256M ready!';
        loadingIndicator.style.visibility = 'visible';
        const startTime = performance.now();
        const clearAfterDelay = (): void => {
          if (loadingIndicator) {
            const elapsed = performance.now() - startTime;
            if (elapsed >= 2000) {
              loadingIndicator.textContent = '\u00A0'; // Non-breaking space to maintain height
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
        loadingIndicator.textContent = '\u00A0'; // Non-breaking space to maintain height
        loadingIndicator.style.visibility = 'hidden';
      }
      if (errorDiv) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        // Always show the detailed error message from loadSmolVLM for better diagnostics
        // The error message includes specific details about which proxy failed, what error it returned, etc.
        const userMessage = `SmolVLM-256M failed to load: ${errorMsg}. WASM preprocessing still works.`;
        errorDiv.textContent = userMessage;
      }
      // Continue without model - preprocessing still works
    }
    
    // Enable buttons now that WASM is ready
    if (processImageBtn instanceof HTMLButtonElement) {
      processImageBtn.disabled = false;
    }
    if (processVQABtn instanceof HTMLButtonElement) {
      processVQABtn.disabled = false;
    }
    
    // Setup UI only after WASM is confirmed ready
    setupUI();
  } catch (error) {
    // Clear loading indicator
    if (loadingIndicator) {
      loadingIndicator.textContent = '\u00A0'; // Non-breaking space to maintain height
      loadingIndicator.style.visibility = 'hidden';
    }
    
    // Disable buttons on error
    if (processImageBtn instanceof HTMLButtonElement) {
      processImageBtn.disabled = true;
    }
    if (processVQABtn instanceof HTMLButtonElement) {
      processVQABtn.disabled = true;
    }
    
    // Show detailed error
    if (errorDiv) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof WasmLoadError) {
        errorDiv.textContent = `Failed to load WASM preprocessing module: ${errorMsg}`;
      } else if (error instanceof WasmInitError) {
        errorDiv.textContent = `WASM preprocessing module initialization failed: ${errorMsg}`;
      } else if (error instanceof Error) {
        errorDiv.textContent = `Error: ${errorMsg}`;
        if (error.stack) {
          errorDiv.textContent += `\n\nStack: ${error.stack}`;
        }
        if ('cause' in error && error.cause) {
          const causeMsg = error.cause instanceof Error 
            ? error.cause.message 
            : typeof error.cause === 'string' 
              ? error.cause 
              : JSON.stringify(error.cause);
          errorDiv.textContent += `\n\nCause: ${causeMsg}`;
        }
      } else {
        errorDiv.textContent = 'Unknown error loading WASM preprocessing module';
      }
    }
  }
};

function setupUI(): void {
  const imageInputEl = document.getElementById('imageInput');
  const vqaQuestionInputEl = document.getElementById('vqaQuestionInput');
  const processImageBtn = document.getElementById('processImageBtn');
  const processVQABtn = document.getElementById('processVQABtn');
  const imageOutputEl = document.getElementById('imageOutput');
  const vqaAnswerOutputEl = document.getElementById('vqaAnswerOutput');
  const statsOutputEl = document.getElementById('statsOutput');
  const imagePreviewEl = document.getElementById('imagePreview');
  const imagePreviewContainerEl = document.getElementById('imagePreviewContainer');
  const webcamVideoEl = document.getElementById('webcamVideo');
  const startWebcamBtn = document.getElementById('startWebcamBtn');
  const stopWebcamBtn = document.getElementById('stopWebcamBtn');
  const snapshotBtn = document.getElementById('snapshotBtn');

  if (
    !imageInputEl ||
    !vqaQuestionInputEl ||
    !processImageBtn ||
    !processVQABtn ||
    !imageOutputEl ||
    !vqaAnswerOutputEl ||
    !statsOutputEl ||
    !imagePreviewEl ||
    !imagePreviewContainerEl ||
    !webcamVideoEl ||
    !startWebcamBtn ||
    !stopWebcamBtn ||
    !snapshotBtn ||
    !(imageInputEl instanceof HTMLInputElement) ||
    !(vqaQuestionInputEl instanceof HTMLTextAreaElement) ||
    !(imageOutputEl instanceof HTMLCanvasElement) ||
    !(vqaAnswerOutputEl instanceof HTMLDivElement) ||
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
  const contrastValueEl = document.getElementById('contrastValue');
  const cinematicValueEl = document.getElementById('cinematicValue');

  if (
    !contrastSliderEl ||
    !cinematicSliderEl ||
    !contrastValueEl ||
    !cinematicValueEl ||
    !(contrastSliderEl instanceof HTMLInputElement) ||
    !(cinematicSliderEl instanceof HTMLInputElement) ||
    !(contrastValueEl instanceof HTMLElement) ||
    !(cinematicValueEl instanceof HTMLElement)
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
      
      // Load image to get dimensions and store original data
      const img = new Image();
      img.onload = () => {
        // Read file as ArrayBuffer to store original image data
        const fileReader = new FileReader();
        fileReader.onload = () => {
          const fileData = fileReader.result;
          if (fileData instanceof ArrayBuffer) {
            filterState.originalImageData = new Uint8Array(fileData);
            filterState.originalWidth = img.width;
            filterState.originalHeight = img.height;
            
            // Reset sliders
            contrastSliderEl.value = '0';
            cinematicSliderEl.value = '0';
            filterState.contrast = 0;
            filterState.cinematic = 0;
            contrastValueEl.textContent = '0';
            cinematicValueEl.textContent = '0';
            
            // Show preview with original image
            imagePreviewEl.src = url;
            imagePreviewContainerEl.style.display = 'block';
          }
        };
        fileReader.onerror = () => {
          URL.revokeObjectURL(url);
          imagePreviewContainerEl.style.display = 'none';
          if (addLogEntry) {
            addLogEntry('Failed to read image file', 'error');
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

  processVQABtn.addEventListener('click', () => {
    if (!imageInputEl.files || imageInputEl.files.length === 0) {
      if (addLogEntry) {
        addLogEntry('Please select an image file first', 'warning');
      }
      return;
    }
    const question = vqaQuestionInputEl.value.trim();
    if (!question) {
      if (addLogEntry) {
        addLogEntry('Please enter a question', 'warning');
      }
      return;
    }
    void processVQA(imageInputEl.files[0], question, vqaAnswerOutputEl);
  });
  
  // Webcam functionality
  let mediaStream: MediaStream | null = null;
  
  startWebcamBtn.addEventListener('click', () => {
    void (async () => {
      try {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          if (addLogEntry) {
            addLogEntry('Webcam access is not available in this browser. Please use a modern browser that supports getUserMedia.', 'error');
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
    
    // Create canvas to capture frame
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
    
    // Convert canvas to blob and create File object
    snapshotCanvas.toBlob((blob) => {
      if (!blob) {
        if (addLogEntry) {
          addLogEntry('Failed to capture snapshot', 'error');
        }
        return;
      }
      
      // Create File object from blob
      const file = new File([blob], 'snapshot.png', { type: 'image/png' });
      
      // Set file input (if possible) or process directly
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      if (imageInputEl instanceof HTMLInputElement) {
        imageInputEl.files = dataTransfer.files;
      }
      
      // Read snapshot blob as ArrayBuffer to store original image data for filters
      const fileReader = new FileReader();
      fileReader.onload = () => {
        const fileData = fileReader.result;
        if (fileData instanceof ArrayBuffer) {
          filterState.originalImageData = new Uint8Array(fileData);
          filterState.originalWidth = snapshotCanvas.width;
          filterState.originalHeight = snapshotCanvas.height;

          // Reset sliders
          contrastSliderEl.value = '0';
          cinematicSliderEl.value = '0';
          filterState.contrast = 0;
          filterState.cinematic = 0;
          contrastValueEl.textContent = '0';
          cinematicValueEl.textContent = '0';
          
          // Show preview with original image and apply filters
          const url = URL.createObjectURL(blob);
          imagePreviewEl.src = url;
          imagePreviewContainerEl.style.display = 'block';
          imagePreviewEl.onload = () => {
            URL.revokeObjectURL(url);
            applyFiltersToPreview(); // Apply filters to the newly captured image
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

    if (filterState.contrast === 0 && filterState.cinematic === 0) {
      // No filters applied, show original
      if (imageInputEl.files && imageInputEl.files.length > 0) {
        const url = URL.createObjectURL(imageInputEl.files[0]);
        imagePreviewEl.src = url;
        imagePreviewEl.onload = () => {
          URL.revokeObjectURL(url);
        };
      }
      return;
    }

    // Create canvas to get RGBA data from preview
    const canvas = document.createElement('canvas');
    canvas.width = filterState.originalWidth;
    canvas.height = filterState.originalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // Draw original image from stored data
    const tempImg = new Image();
    // Convert Uint8Array to ArrayBuffer for Blob constructor
    // Create a new Uint8Array to ensure we have a proper ArrayBuffer
    const imageDataCopy = new Uint8Array(filterState.originalImageData);
    const originalBlob = new Blob([imageDataCopy], { type: 'image/png' });
    const url = URL.createObjectURL(originalBlob);
    
    tempImg.onload = () => {
      ctx.drawImage(tempImg, 0, 0);
      URL.revokeObjectURL(url); // Clean up the blob URL
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const rgbaData = new Uint8Array(imageData.data);

      // Apply filters in sequence
      let processedData = new Uint8Array(rgbaData);
      
      if (filterState.contrast !== 0 && wasmModule) {
        const contrastResult = wasmModule.apply_contrast(
          processedData,
          filterState.originalWidth,
          filterState.originalHeight,
          filterState.contrast
        );
        processedData = new Uint8Array(contrastResult);
      }

      if (filterState.cinematic !== 0 && wasmModule) {
        const cinematicResult = wasmModule.apply_cinematic_filter(
          processedData,
          filterState.originalWidth,
          filterState.originalHeight,
          filterState.cinematic / 100.0 // Convert 0-100 to 0.0-1.0
        );
        processedData = new Uint8Array(cinematicResult);
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

  // Slider event handlers - similar pattern to mousemove in astar
  // Directly call WASM functions to update state, then trigger preview update
  contrastSliderEl.addEventListener('input', () => {
    const value = Number.parseInt(contrastSliderEl.value, 10);
    contrastValueEl.textContent = value.toString();
    // Update WASM state directly (similar to mouse_move in astar)
    if (wasmModule) {
      wasmModule.set_contrast(value);
      // Update local filterState for preview function
      filterState.contrast = value;
      debouncedApplyFilters();
    }
  });

  cinematicSliderEl.addEventListener('input', () => {
    const value = Number.parseInt(cinematicSliderEl.value, 10);
    cinematicValueEl.textContent = value.toString();
    // Update WASM state directly (similar to mouse_move in astar)
    if (wasmModule) {
      wasmModule.set_cinematic(value);
      // Update local filterState for preview function
      filterState.cinematic = value;
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
    // Read the original file bytes (PNG/JPEG encoded data)
    const fileReader = new FileReader();
    
    fileReader.onload = () => {
      const fileData = fileReader.result;
      if (!(fileData instanceof ArrayBuffer)) {
        reject(new Error('Failed to read file as ArrayBuffer'));
        return;
      }
      
      const imageBytes = new Uint8Array(fileData);
      
      // Load image to get dimensions for display
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = async () => {
        URL.revokeObjectURL(url);
        
        // Target size for preprocessing (384×384)
        // This size is commonly used for ML model inputs
        const targetWidth = 384;
        const targetHeight = 384;
        
        // Preprocess image - pass original file bytes (PNG/JPEG encoded)
        let processedData: Uint8Array;
        try {
          processedData = module.preprocess_image_crop(
            imageBytes,
            img.width,
            img.height,
            targetWidth,
            targetHeight
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          reject(new Error(`WASM preprocessing failed: ${errorMsg}`));
          return;
        }
        
        // Display processed image
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
        
        // Display stats
        const stats = module.get_preprocess_stats(img.width, targetWidth);
        statsDiv.innerHTML = `
          <h3>Preprocessing Stats</h3>
          <p>Original: ${stats.original_size}x${stats.original_size}</p>
          <p>Target: ${stats.target_size}x${stats.target_size}</p>
          <p>Scale Factor: ${stats.scale_factor.toFixed(2)}</p>
        `;
        
        // Run image captioning inference if SmolVLM is loaded
        if (isSmolVLM256MLoaded()) {
          statsDiv.innerHTML += '<p><strong>Running image captioning inference with SmolVLM-256M...</strong></p>';
          
          try {
            // Preprocess image for SmolVLM-256M using WASM
            const targetSize = 512; // SmolVLM-256M uses 512x512
            const normalizedImageData = module.preprocess_image_for_smolvlm_256m(
              imageBytes,
              img.width,
              img.height,
              targetSize,
              targetSize
            );
            
            // Generate caption using SmolVLM (empty question for captioning)
            const caption = await generateResponse256M(normalizedImageData, 'Describe this image.', addLogEntry || undefined);
            
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

async function processVQA(
  imageFile: File,
  question: string,
  answerOutput: HTMLDivElement
): Promise<void> {
  const module = wasmModule;
  if (!module) {
    answerOutput.textContent = 'Error: WASM module not initialized';
    return;
  }

  if (!isSmolVLM256MLoaded()) {
    answerOutput.textContent = 'Error: SmolVLM-256M model not loaded';
    return;
  }

  answerOutput.textContent = 'Processing question...';

  return new Promise<void>((resolve, reject) => {
    // Read the original file bytes (PNG/JPEG encoded data)
    const fileReader = new FileReader();

    fileReader.onload = () => {
      const fileData = fileReader.result;
      if (!(fileData instanceof ArrayBuffer)) {
        answerOutput.textContent = 'Error: Failed to read file as ArrayBuffer';
        reject(new Error('Failed to read file as ArrayBuffer'));
        return;
      }

      const imageBytes = new Uint8Array(fileData);

      // Load image to get dimensions for preprocessing
      const img = new Image();
      const url = URL.createObjectURL(imageFile);

      img.onload = async () => {
        URL.revokeObjectURL(url);

        // Target size for SmolVLM-256M preprocessing (512×512)
        const targetSize = 512;

        // Preprocess image for SmolVLM using WASM
        // This returns normalized Float32Array ready for ONNX Runtime
        let normalizedImageData: Float32Array;
        try {
          const processedData = module.preprocess_image_for_smolvlm_256m(
            imageBytes,
            img.width,
            img.height,
            targetSize,
            targetSize
          );
          normalizedImageData = new Float32Array(processedData);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          answerOutput.textContent = `WASM preprocessing failed: ${errorMsg}`;
          reject(new Error(`WASM preprocessing failed: ${errorMsg}`));
          return;
        }

        // Run VQA inference with SmolVLM
        try {
          const answer = await generateResponse256M(normalizedImageData, question, addLogEntry || undefined);

          // Display result
          answerOutput.innerHTML = `
            <h3>Visual Question Answering Result</h3>
            <p><strong>Question:</strong> ${question}</p>
            <p><strong>Answer:</strong> ${answer}</p>
          `;
          resolve();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          const errorP = document.createElement('p');
          errorP.className = 'error-text';
          errorP.textContent = `VQA inference error: ${errorMsg}`;
          answerOutput.appendChild(errorP);
          reject(new Error(`VQA inference failed: ${errorMsg}`));
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        answerOutput.textContent = 'Error: Failed to load image';
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    };

    fileReader.onerror = () => {
      answerOutput.textContent = 'Error: Failed to read file';
      reject(new Error('Failed to read file'));
    };

    fileReader.readAsArrayBuffer(imageFile);
  });
}

