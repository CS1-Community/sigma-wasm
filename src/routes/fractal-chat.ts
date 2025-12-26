import type { WasmModuleFractalChat } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { pipeline, type TextGenerationPipeline, env } from '@xenova/transformers';

// Model configuration
// Using Qwen1.5-0.5B-Chat for better conversational quality
const MODEL_ID = 'Xenova/qwen1.5-0.5b-chat';

// Lazy WASM import - only load when init() is called
let wasmModuleExports: {
  default: () => Promise<unknown>;
  generate_mandelbrot: (width: number, height: number) => Uint8Array;
  generate_julia: (width: number, height: number) => Uint8Array;
  generate_buddhabrot: (width: number, height: number) => Uint8Array;
  generate_orbit_trap: (width: number, height: number) => Uint8Array;
  generate_gray_scott: (width: number, height: number) => Uint8Array;
  generate_lsystem: (width: number, height: number) => Uint8Array;
  generate_fractal_flame: (width: number, height: number) => Uint8Array;
  generate_strange_attractor: (width: number, height: number) => Uint8Array;
} | null = null;

const getInitWasm = async (): Promise<unknown> => {
  if (!wasmModuleExports) {
    // Import path will be rewritten by vite plugin to absolute path in production
    // Note: cargo converts hyphens to underscores in output filenames
    const module = await import('../../pkg/wasm_fractal_chat/wasm_fractal_chat.js');
    
    // Validate module has required exports
    if (typeof module !== 'object' || module === null) {
      throw new Error('Imported module is not an object');
    }
    
    const moduleKeys = Object.keys(module);
    
    // Debug logging
    if (addLogEntry) {
      addLogEntry(`Module loaded. Keys: ${moduleKeys.join(', ')}`);
    }
    
    // Check for required exports
    const requiredExports = [
      'generate_mandelbrot',
      'generate_julia',
      'generate_buddhabrot',
      'generate_orbit_trap',
      'generate_gray_scott',
      'generate_lsystem',
      'generate_fractal_flame',
      'generate_strange_attractor',
    ];
    
    const getProperty = (obj: object, key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      return descriptor ? descriptor.value : undefined;
    };
    
    for (const exportName of requiredExports) {
      const exportValue = getProperty(module, exportName);
      if (!exportValue || typeof exportValue !== 'function') {
        throw new Error(`Module missing or invalid '${exportName}' export. Available: ${moduleKeys.join(', ')}`);
      }
    }
    
    if (!('default' in module) || typeof module.default !== 'function') {
      throw new Error(`Module missing 'default' export. Available: ${moduleKeys.join(', ')}`);
    }
    
    // Extract and assign functions - we've validated they exist and are functions above
    // TypeScript can't narrow the dynamic import type, so we need assertions after validation
    wasmModuleExports = {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      default: module.default as () => Promise<unknown>,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_mandelbrot: module.generate_mandelbrot as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_julia: module.generate_julia as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_buddhabrot: module.generate_buddhabrot as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_orbit_trap: module.generate_orbit_trap as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_gray_scott: module.generate_gray_scott as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_lsystem: module.generate_lsystem as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_fractal_flame: module.generate_fractal_flame as (width: number, height: number) => Uint8Array,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      generate_strange_attractor: module.generate_strange_attractor as (width: number, height: number) => Uint8Array,
    };
  }
  if (!wasmModuleExports) {
    throw new Error('Failed to load WASM module exports');
  }
  return wasmModuleExports.default();
};

let wasmModule: WasmModuleFractalChat | null = null;
let textGenerationPipeline: TextGenerationPipeline | null = null;
let chatContainerEl: HTMLElement | null = null;

// Logging function - accessible to all functions
let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;

function validateFractalChatModule(exports: unknown): WasmModuleFractalChat | null {
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
  
  // High-level functions are on the module object, not the init result
  if (!wasmModuleExports) {
    missingExports.push('module exports (wasmModuleExports is null)');
  } else {
    const requiredFunctions = [
      'generate_mandelbrot',
      'generate_julia',
      'generate_buddhabrot',
      'generate_orbit_trap',
      'generate_gray_scott',
      'generate_lsystem',
      'generate_fractal_flame',
      'generate_strange_attractor',
    ];
    
    const getProperty = (obj: object, key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      return descriptor ? descriptor.value : undefined;
    };
    
    for (const funcName of requiredFunctions) {
      const funcValue = getProperty(wasmModuleExports, funcName);
      if (!funcValue || typeof funcValue !== 'function') {
        missingExports.push(`${funcName} (function)`);
      }
    }
  }
  
  if (missingExports.length > 0) {
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    return null;
  }
  
  if (!wasmModuleExports) {
    return null;
  }
  
  return {
    memory,
    generate_mandelbrot: wasmModuleExports.generate_mandelbrot,
    generate_julia: wasmModuleExports.generate_julia,
    generate_buddhabrot: wasmModuleExports.generate_buddhabrot,
    generate_orbit_trap: wasmModuleExports.generate_orbit_trap,
    generate_gray_scott: wasmModuleExports.generate_gray_scott,
    generate_lsystem: wasmModuleExports.generate_lsystem,
    generate_fractal_flame: wasmModuleExports.generate_fractal_flame,
    generate_strange_attractor: wasmModuleExports.generate_strange_attractor,
  };
}

// Fractal types for random selection
const FRACTAL_TYPES = [
  'mandelbrot',
  'julia',
  'buddhabrot',
  'orbit-trap',
  'gray-scott',
  'l-system',
  'flames',
  'strange-attractor',
] as const;

type FractalType = typeof FRACTAL_TYPES[number];

/**
 * Detect fractal keyword in message (full word matching, case-insensitive)
 */
function detectFractalKeyword(message: string): FractalType | null {
  const lowerMessage = message.toLowerCase();
  const words = lowerMessage.split(/\b/);
  
  // Check for "fractal" first (returns random)
  for (const word of words) {
    if (word === 'fractal') {
      // Return random fractal type
      const randomIndex = Math.floor(Math.random() * FRACTAL_TYPES.length);
      return FRACTAL_TYPES[randomIndex];
    }
  }
  
  // Check for multi-word combinations first (before single word check)
  const normalizedMessage = lowerMessage.replace(/[^\w\s-]/g, ' ');
  if (normalizedMessage.includes('orbit') && normalizedMessage.includes('trap')) {
    return 'orbit-trap';
  }
  if (normalizedMessage.includes('gray') && normalizedMessage.includes('scott')) {
    return 'gray-scott';
  }
  if ((normalizedMessage.includes('l') || normalizedMessage.includes('l-')) && normalizedMessage.includes('system')) {
    return 'l-system';
  }
  if (normalizedMessage.includes('de') && normalizedMessage.includes('jong')) {
    return 'strange-attractor';
  }
  
  // Keyword mappings
  const keywordMap: Record<string, FractalType> = {
    'mandelbrot': 'mandelbrot',
    'julia': 'julia',
    'buddhabrot': 'buddhabrot',
    'nebulabrot': 'buddhabrot',
    'orbit-trap': 'orbit-trap',
    'orbittrap': 'orbit-trap',
    'orbit': 'orbit-trap',
    'trap': 'orbit-trap',
    'gray-scott': 'gray-scott',
    'grayscott': 'gray-scott',
    'reaction': 'gray-scott',
    'diffusion': 'gray-scott',
    'l-system': 'l-system',
    'lsystem': 'l-system',
    'tree': 'l-system',
    'plant': 'l-system',
    'flames': 'flames',
    'strange': 'strange-attractor',
    'attractors': 'strange-attractor',
    'lorenz': 'strange-attractor',
    'clifford': 'strange-attractor',
    'de jong': 'strange-attractor',
    'dejong': 'strange-attractor',
  };
  
  // Check each word against keyword map
  for (const word of words) {
    const normalizedWord = word.trim();
    if (normalizedWord in keywordMap) {
      return keywordMap[normalizedWord];
    }
  }
  
  return null;
}

/**
 * Generate fractal image
 */
function generateFractalImage(fractalType: FractalType): ImageData {
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  
  const width = 512;
  const height = 512;
  
  let imageData: Uint8Array;
  
  switch (fractalType) {
    case 'mandelbrot':
      imageData = wasmModule.generate_mandelbrot(width, height);
      break;
    case 'julia':
      imageData = wasmModule.generate_julia(width, height);
      break;
    case 'buddhabrot':
      imageData = wasmModule.generate_buddhabrot(width, height);
      break;
    case 'orbit-trap':
      imageData = wasmModule.generate_orbit_trap(width, height);
      break;
    case 'gray-scott':
      imageData = wasmModule.generate_gray_scott(width, height);
      break;
    case 'l-system':
      imageData = wasmModule.generate_lsystem(width, height);
      break;
    case 'flames':
      imageData = wasmModule.generate_fractal_flame(width, height);
      break;
    case 'strange-attractor':
      imageData = wasmModule.generate_strange_attractor(width, height);
      break;
    default: {
      const unknownType: string = String(fractalType);
      throw new Error(`Unknown fractal type: ${unknownType}`);
    }
  }
  
  // Convert to ImageData
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  const imageDataObj = ctx.createImageData(width, height);
  imageDataObj.data.set(imageData);
  
  return imageDataObj;
}

/**
 * Extract assistant response from generated text, removing prompt and formatting
 */
function extractAssistantResponse(generatedText: string, formattedPrompt: string): string {
  let response = generatedText;
  
  // Try to remove the formatted prompt
  if (response.includes(formattedPrompt)) {
    response = response.replace(formattedPrompt, '');
  }
  
  // Remove Qwen-specific tokens
  response = response.replace(/<\|im_start\|>assistant\s*/g, '');
  response = response.replace(/<\|im_end\|>/g, '');
  response = response.replace(/<\|im_start\|>/g, '');
  
  // Remove common patterns like "user" or "assistant" labels at the start
  response = response.replace(/^\s*(user|assistant)[:\s]+/i, '');
  
  // Try to find text after the last occurrence of common separators
  const lastAssistantIndex = response.lastIndexOf('assistant');
  if (lastAssistantIndex !== -1) {
    const afterAssistant = response.substring(lastAssistantIndex + 'assistant'.length);
    // If there's meaningful content after "assistant", use it
    if (afterAssistant.trim().length > 0) {
      response = afterAssistant;
    }
  }
  
  // Remove any remaining "user" mentions at the start
  response = response.replace(/^\s*user[:\s]+/i, '');
  
  // Clean up whitespace
  response = response.trim();
  
  return response;
}

/**
 * Generate chat response using Transformers.js with Qwen chat template
 */
async function generateChatResponse(message: string): Promise<string> {
  if (!textGenerationPipeline) {
    throw new Error('Chat model not loaded');
  }
  
  // Qwen uses chat template format with messages array
  // Check if tokenizer has apply_chat_template method
  const tokenizer = textGenerationPipeline.tokenizer;
  if (tokenizer && typeof tokenizer.apply_chat_template === 'function') {
    const messages = [
      { role: 'user', content: message }
    ];
    
    const formattedPrompt = tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
    
    if (typeof formattedPrompt !== 'string') {
      throw new Error('Chat template did not return a string');
    }
    
    const result = await textGenerationPipeline(formattedPrompt, {
      max_new_tokens: 100,
      temperature: 0.7,
      do_sample: true,
    });
    
    if (Array.isArray(result) && result.length > 0) {
      const firstItem = result[0];
      if (typeof firstItem === 'object' && firstItem !== null && 'generated_text' in firstItem) {
        const generatedText = firstItem.generated_text;
        if (typeof generatedText === 'string') {
          // Extract only the assistant's response
          const response = extractAssistantResponse(generatedText, formattedPrompt);
          return response || 'I understand.';
        }
      }
    } else if (typeof result === 'object' && result !== null && 'generated_text' in result) {
      const generatedText = result.generated_text;
      if (typeof generatedText === 'string') {
        const response = extractAssistantResponse(generatedText, formattedPrompt);
        return response || 'I understand.';
      }
    }
  } else {
    // Fallback to simple prompt format if chat template not available
    const prompt = `User: ${message}\nAssistant:`;
    const result = await textGenerationPipeline(prompt, {
      max_new_tokens: 100,
      temperature: 0.7,
      do_sample: true,
    });
    
    if (Array.isArray(result) && result.length > 0) {
      const firstItem = result[0];
      if (typeof firstItem === 'object' && firstItem !== null && 'generated_text' in firstItem) {
        const generatedText = firstItem.generated_text;
        if (typeof generatedText === 'string') {
          const assistantMatch = generatedText.match(/Assistant:\s*(.+)/s);
          if (assistantMatch && assistantMatch[1]) {
            return assistantMatch[1].trim();
          }
          const promptIndex = generatedText.indexOf('Assistant:');
          if (promptIndex !== -1) {
            return generatedText.substring(promptIndex + 'Assistant:'.length).trim();
          }
          return generatedText.substring(prompt.length).trim();
        }
      }
    } else if (typeof result === 'object' && result !== null && 'generated_text' in result) {
      const generatedText = result.generated_text;
      if (typeof generatedText === 'string') {
        const assistantMatch = generatedText.match(/Assistant:\s*(.+)/s);
        if (assistantMatch && assistantMatch[1]) {
          return assistantMatch[1].trim();
        }
        const promptIndex = generatedText.indexOf('Assistant:');
        if (promptIndex !== -1) {
          return generatedText.substring(promptIndex + 'Assistant:'.length).trim();
        }
        return generatedText.substring(prompt.length).trim();
      }
    }
  }
  
  return 'I understand.';
}

/**
 * Add message to chat
 */
function addChatMessage(text: string, image: ImageData | null, isUser: boolean): void {
  const chatMessagesEl = document.getElementById('chatMessages');
  if (!chatMessagesEl) {
    return;
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
  
  const textDiv = document.createElement('div');
  textDiv.textContent = text;
  messageDiv.appendChild(textDiv);
  
  if (image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(image, 0, 0);
      canvas.className = 'chat-message-image';
      messageDiv.appendChild(canvas);
    }
  }
  
  chatMessagesEl.appendChild(messageDiv);
  scrollToBottom();
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom(): void {
  const chatMessagesEl = document.getElementById('chatMessages');
  if (chatMessagesEl) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

/**
 * Show thinking animation on chat container
 */
async function showThinkingAnimation(): Promise<void> {
  if (chatContainerEl) {
    chatContainerEl.classList.add('thinking');
    // Force browser repaint by reading a layout property
    void chatContainerEl.offsetHeight;
    
    // Wait for two animation frames to ensure browser paints the change
    // First frame: schedules the paint
    // Second frame: ensures the paint completed
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    
    if (addLogEntry) {
      const timestamp = new Date().toLocaleString();
      addLogEntry(`[${timestamp}] Started thinking`, 'info');
    }
  }
}

/**
 * Hide thinking animation on chat container
 */
function hideThinkingAnimation(): void {
  if (chatContainerEl) {
    chatContainerEl.classList.remove('thinking');
    if (addLogEntry) {
      const timestamp = new Date().toLocaleString();
      addLogEntry(`[${timestamp}] Finished thinking`, 'info');
    }
  }
}

/**
 * Load chat model
 */
async function loadChatModel(): Promise<void> {
  if (textGenerationPipeline) {
    return;
  }
  
  if (addLogEntry) {
    addLogEntry('Loading chat model...', 'info');
  }
  
  env.allowLocalModels = false;
  
  textGenerationPipeline = await pipeline('text-generation', MODEL_ID);
  
  if (addLogEntry) {
    addLogEntry('Chat model loaded successfully', 'success');
  }
}

export async function init(): Promise<void> {
  // Get UI elements
  const errorEl = document.getElementById('error');
  const loadingIndicatorEl = document.getElementById('loadingIndicator');
  const checkmarkWasmEl = document.getElementById('checkmark-wasm');
  const checkmarkModelEl = document.getElementById('checkmark-model');
  const systemLogsContentEl = document.getElementById('systemLogsContent');
  const chatInputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatMessagesEl = document.getElementById('chatMessages');
  chatContainerEl = document.getElementById('chatContainer');

  if (!errorEl || !loadingIndicatorEl || !checkmarkWasmEl || !checkmarkModelEl || !systemLogsContentEl) {
    throw new Error('Required UI elements not found');
  }

  if (!chatInputEl || !sendBtn || !chatMessagesEl || !chatContainerEl) {
    throw new Error('Chat UI elements not found');
  }

  // Setup logging
  addLogEntry = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    systemLogsContentEl.appendChild(logEntry);
    systemLogsContentEl.scrollTop = systemLogsContentEl.scrollHeight;
  };

  // Show loading indicator
  loadingIndicatorEl.style.display = 'block';

  try {
    // Load WASM module
    addLogEntry('Initializing WASM fractal module...', 'info');
    wasmModule = await loadWasmModule<WasmModuleFractalChat>(
      getInitWasm,
      validateFractalChatModule
    );
    addLogEntry('WASM module loaded successfully', 'success');
    checkmarkWasmEl.classList.add('visible');
    loadingIndicatorEl.style.display = 'none';

    // Load chat model
    await loadChatModel();
    checkmarkModelEl.classList.add('visible');

    // Setup chat input handler
    const handleSend = async (): Promise<void> => {
      if (!(chatInputEl instanceof HTMLInputElement)) {
        return;
      }
      const message = chatInputEl.value.trim();
      if (!message) {
        return;
      }

      // Clear input
      chatInputEl.value = '';
      sendBtn.setAttribute('disabled', 'true');

      // Show thinking animation immediately and wait for paint
      await showThinkingAnimation();

      // Add user message
      addChatMessage(message, null, true);

      try {
        // Check for fractal keyword
        const fractalType = detectFractalKeyword(message);
        
        if (fractalType) {
          // Generate fractal
          if (addLogEntry) {
            addLogEntry(`Generating ${fractalType} fractal...`, 'info');
          }
          const imageData = generateFractalImage(fractalType);
          hideThinkingAnimation();
          addChatMessage(`Here's a ${fractalType} fractal:`, imageData, false);
          if (addLogEntry) {
            addLogEntry(`Fractal generated successfully`, 'success');
          }
        } else {
          // Generate chat response
          if (addLogEntry) {
            addLogEntry('Generating chat response...', 'info');
          }
          try {
            const response = await generateChatResponse(message);
            hideThinkingAnimation();
            addChatMessage(response, null, false);
            if (addLogEntry) {
              addLogEntry('Chat response generated', 'success');
            }
          } catch (error) {
            hideThinkingAnimation();
            throw error;
          }
        }
      } catch (error) {
        hideThinkingAnimation();
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (addLogEntry) {
          addLogEntry(`Error: ${errorMessage}`, 'error');
        }
        addChatMessage(`Sorry, I encountered an error: ${errorMessage}`, null, false);
      } finally {
        sendBtn.removeAttribute('disabled');
      }
    };

    sendBtn.addEventListener('click', () => {
      handleSend().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorEl) {
          errorEl.textContent = `Error: ${errorMessage}`;
        }
        if (addLogEntry) {
          addLogEntry(`Error: ${errorMessage}`, 'error');
        }
      });
    });

    chatInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const handleSendFn = handleSend;
        handleSendFn().catch((error) => {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (errorEl) {
            errorEl.textContent = `Error: ${errorMessage}`;
          }
          if (addLogEntry) {
            addLogEntry(`Error: ${errorMessage}`, 'error');
          }
        });
      }
    });

  } catch (error) {
    loadingIndicatorEl.style.display = 'none';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errorEl.textContent = `Error: ${errorMessage}`;
    if (addLogEntry) {
      addLogEntry(`Failed to initialize: ${errorMessage}`, 'error');
    }
    throw error;
  }
}

