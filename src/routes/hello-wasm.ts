/**
 * Hello-WASM Route Handler
 * 
 * This is a simplified template for students to learn from. It demonstrates:
 * 1. How to load a WASM module lazily
 * 2. How to manage state between TypeScript and WASM
 * 3. How to validate WASM module exports
 * 4. How to handle errors gracefully
 * 
 * **Learning Path**: Start here, then study src/routes/astar.ts for a more complex example.
 */

import type { WasmHello, WasmModuleHello } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { WasmLoadError, WasmInitError } from '../wasm/types';

/**
 * Lazy WASM import - only load when init() is called
 * 
 * **Learning Point**: We use lazy imports to reduce initial bundle size.
 * The WASM module is only loaded when the user navigates to this route.
 * 
 * **To extend**: Add new function signatures here as you add them to the Rust module.
 */
let wasmModuleExports: {
  default: () => unknown;
  wasm_init: (initialCounter: number) => void;
  get_counter: () => number;
  increment_counter: () => void;
  get_message: () => string;
  set_message: (message: string) => void;
  get_fave_gum: () => string;
  set_fave_gum: (gum: string) => void;
} | null = null;

/**
 * Get the WASM module initialization function
 * 
 * **Learning Point**: This function is called by loadWasmModule() helper.
 * It imports the WASM module dynamically (but not using dynamic imports - 
 * the import path is static, just loaded lazily).
 * 
 * **To extend**: When you add new exports to Rust, add them to wasmModuleExports above.
 */
const getInitWasm = async (): Promise<unknown> => {
  if (!wasmModuleExports) {
    // Import only when first called - get both init and exported functions
    // Note: The path will be rewritten by vite plugin to absolute path in production
    const moduleUnknown: unknown = await import('../../pkg/wasm_hello/wasm_hello.js');
    
    // Validate module has required exports
    if (typeof moduleUnknown !== 'object' || moduleUnknown === null) {
      throw new Error('Imported module is not an object');
    }
    
    // Use 'in' operator checks which TypeScript can narrow
    const moduleKeys: string[] = [];
    if ('default' in moduleUnknown) {
      moduleKeys.push('default');
    }
    if ('wasm_init' in moduleUnknown) {
      moduleKeys.push('wasm_init');
    }
    if ('get_counter' in moduleUnknown) {
      moduleKeys.push('get_counter');
    }
    if ('increment_counter' in moduleUnknown) {
      moduleKeys.push('increment_counter');
    }
    if ('get_message' in moduleUnknown) {
      moduleKeys.push('get_message');
    }
    if ('set_message' in moduleUnknown) {
      moduleKeys.push('set_message');
    }
    if ('get_fave_gum' in moduleUnknown) {
      moduleKeys.push('get_fave_gum');
    }
    if ('set_fave_gum' in moduleUnknown) {
      moduleKeys.push('set_fave_gum');
    }
    
    // Get all keys for error messages
    const allKeys = Object.keys(moduleUnknown);
    
    // Check for required exports - these should be on the module object from wasm-bindgen
    // Use property access with 'in' checks that TypeScript can narrow
    if (!('default' in moduleUnknown) || typeof moduleUnknown.default !== 'function') {
      throw new Error(`Module missing 'default' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('wasm_init' in moduleUnknown) || typeof moduleUnknown.wasm_init !== 'function') {
      throw new Error(`Module missing 'wasm_init' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('get_counter' in moduleUnknown) || typeof moduleUnknown.get_counter !== 'function') {
      throw new Error(`Module missing 'get_counter' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('increment_counter' in moduleUnknown) || typeof moduleUnknown.increment_counter !== 'function') {
      throw new Error(`Module missing 'increment_counter' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('get_message' in moduleUnknown) || typeof moduleUnknown.get_message !== 'function') {
      throw new Error(`Module missing 'get_message' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('set_message' in moduleUnknown) || typeof moduleUnknown.set_message !== 'function') {
      throw new Error(`Module missing 'set_message' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('get_fave_gum' in moduleUnknown) || typeof moduleUnknown.get_fave_gum !== 'function') {
      throw new Error(`Module missing 'get_fave_gum' export. Available: ${allKeys.join(', ')}`);
    }
    if (!('set_fave_gum' in moduleUnknown) || typeof moduleUnknown.set_fave_gum !== 'function') {
      throw new Error(`Module missing 'set_fave_gum' export. Available: ${allKeys.join(', ')}`);
    }
    
    // Extract and assign functions - we've validated they exist and are functions above
    // Access properties directly after validation
    const defaultFunc = moduleUnknown.default;
    const wasmInitFunc = moduleUnknown.wasm_init;
    const getCounterFunc = moduleUnknown.get_counter;
    const incrementCounterFunc = moduleUnknown.increment_counter;
    const getMessageFunc = moduleUnknown.get_message;
    const setMessageFunc = moduleUnknown.set_message;
    const getFaveGumFunc = moduleUnknown.get_fave_gum;
    const setFaveGumFunc = moduleUnknown.set_fave_gum;
    
    if (typeof defaultFunc !== 'function') {
      throw new Error('default export is not a function');
    }
    if (typeof wasmInitFunc !== 'function') {
      throw new Error('wasm_init export is not a function');
    }
    if (typeof getCounterFunc !== 'function') {
      throw new Error('get_counter export is not a function');
    }
    if (typeof incrementCounterFunc !== 'function') {
      throw new Error('increment_counter export is not a function');
    }
    if (typeof getMessageFunc !== 'function') {
      throw new Error('get_message export is not a function');
    }
    if (typeof setMessageFunc !== 'function') {
      throw new Error('set_message export is not a function');
    }
    if (typeof getFaveGumFunc !== 'function') {
      throw new Error('get_fave_gum export is not a function');
    }
    if (typeof setFaveGumFunc !== 'function') {
      throw new Error('set_fave_gum export is not a function');
    }
    
    // TypeScript can't narrow Function to specific signatures after validation
    // Runtime validation ensures these are safe
    wasmModuleExports = {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      default: defaultFunc as () => Promise<unknown>,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      wasm_init: wasmInitFunc as (initialCounter: number) => void,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      get_counter: getCounterFunc as () => number,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      increment_counter: incrementCounterFunc as () => void,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      get_message: getMessageFunc as () => string,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      set_message: setMessageFunc as (message: string) => void,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      get_fave_gum: getFaveGumFunc as () => string,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      set_fave_gum: setFaveGumFunc as (gum: string) => void,
    };
  }
  if (!wasmModuleExports) {
    throw new Error('Failed to load WASM module exports');
  }
  const result = wasmModuleExports.default();
  return result;
};

/**
 * Global state object for the hello-wasm module
 * 
 * **Learning Point**: This follows the same pattern as WASM_ASTAR in astar.ts.
 * We store the loaded WASM module and configuration here so it's accessible
 * throughout the route handler.
 * 
 * **To extend**: Add new state properties here as needed (e.g., UI element references).
 */
const WASM_HELLO: WasmHello = {
  wasmModule: null,
  wasmModulePath: '../pkg/wasm_hello',
};

/**
 * Validate that the WASM module has all required exports
 * 
 * **Learning Point**: This function ensures type safety. We check that:
 * 1. The module has WebAssembly.Memory (required for all WASM modules)
 * 2. All expected functions are present and have the correct types
 * 
 * **To extend**: When you add new functions to Rust, add validation checks here.
 * 
 * @param exports - The exports object from the WASM module init
 * @returns The validated module or null if validation fails
 */
function validateHelloModule(exports: unknown): WasmModuleHello | null {
  if (!validateWasmModule(exports)) {
    return null;
  }
  
  if (typeof exports !== 'object' || exports === null) {
    return null;
  }
  
  // Check for required exports and provide detailed error info
  const getProperty = (obj: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    return descriptor ? descriptor.value : undefined;
  };
  
  const exportKeys = Object.keys(exports);
  const missingExports: string[] = [];
  
  // Check for memory (required for all WASM modules)
  const memoryValue = getProperty(exports, 'memory');
  if (!memoryValue || !(memoryValue instanceof WebAssembly.Memory)) {
    missingExports.push('memory (WebAssembly.Memory)');
  }
  
  // Check wasmModuleExports for functions
  if (!wasmModuleExports) {
    missingExports.push('module exports (wasmModuleExports is null)');
  } else {
    if (typeof wasmModuleExports.wasm_init !== 'function') {
      missingExports.push('wasm_init (function)');
    }
    if (typeof wasmModuleExports.get_counter !== 'function') {
      missingExports.push('get_counter (function)');
    }
    if (typeof wasmModuleExports.increment_counter !== 'function') {
      missingExports.push('increment_counter (function)');
    }
    if (typeof wasmModuleExports.get_message !== 'function') {
      missingExports.push('get_message (function)');
    }
    if (typeof wasmModuleExports.set_message !== 'function') {
      missingExports.push('set_message (function)');
    }
    if (typeof wasmModuleExports.get_fave_gum !== 'function') {
      missingExports.push('get_fave_gum (function)');
    }
    if (typeof wasmModuleExports.set_fave_gum !== 'function') {
      missingExports.push('set_fave_gum (function)');
    }
  }
  
  if (missingExports.length > 0) {
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  // At this point we know memory exists and is WebAssembly.Memory
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    return null;
  }
  
  // Construct module object from exports using type narrowing
  if (!wasmModuleExports) {
    return null;
  }
  
  return {
    memory,
    wasm_init: wasmModuleExports.wasm_init,
    get_counter: wasmModuleExports.get_counter,
    increment_counter: wasmModuleExports.increment_counter,
    get_message: wasmModuleExports.get_message,
    set_message: wasmModuleExports.set_message,
    get_fave_gum: wasmModuleExports.get_fave_gum,
    set_fave_gum: wasmModuleExports.set_fave_gum,
  };
}

/**
 * Initialize the hello-wasm route
 * 
 * **Learning Point**: This function is called by the router when the user navigates
 * to /hello-wasm. It:
 * 1. Loads the WASM module
 * 2. Validates the exports
 * 3. Initializes the module
 * 4. Sets up UI event handlers
 * 
 * **To extend**: Add UI initialization, event listeners, or other setup logic here.
 */
export const init = async (): Promise<void> => {
  // Get error element for displaying errors
  const errorEl = document.getElementById('error');
  
  // Initialize WASM module using loadWasmModule helper
  // **Learning Point**: loadWasmModule handles the complexity of loading and
  // validating WASM modules. It's a reusable utility used throughout the project.
  try {
    const wasmModule = await loadWasmModule<WasmModuleHello>(
      getInitWasm,
      validateHelloModule
    );
    
    if (!wasmModule) {
      throw new WasmInitError('WASM module failed validation');
    }
    
    WASM_HELLO.wasmModule = wasmModule;
    
    // Initialize the module with starting counter value of 0
    wasmModule.wasm_init(0);
  } catch (error) {
    // Show detailed error
    if (errorEl) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof WasmLoadError) {
        errorEl.textContent = `Failed to load WASM module: ${errorMsg}`;
      } else if (error instanceof WasmInitError) {
        errorEl.textContent = `WASM module initialization failed: ${errorMsg}`;
      } else if (error instanceof Error) {
        errorEl.textContent = `Error: ${errorMsg}`;
        if (error.stack) {
          errorEl.textContent += `\n\nStack: ${error.stack}`;
        }
        if ('cause' in error && error.cause) {
          const causeMsg = error.cause instanceof Error 
            ? error.cause.message 
            : typeof error.cause === 'string' 
              ? error.cause 
              : JSON.stringify(error.cause);
          errorEl.textContent += `\n\nCause: ${causeMsg}`;
        }
      } else {
        errorEl.textContent = 'Unknown error loading WASM module';
      }
    }
    throw error;
  }
  
  // Get UI elements
  const counterDisplay = document.getElementById('counter-display');
  const messageDisplay = document.getElementById('message-display');
  const faveGumDisplay = document.getElementById('fave-gum-display');
  const incrementBtn = document.getElementById('increment-btn');
  const messageInputEl = document.getElementById('message-input');
  const setMessageBtn = document.getElementById('set-message-btn');
  const faveGumInputEl = document.getElementById('fave-gum-input');
  const setFaveGumBtn = document.getElementById('set-fave-gum-btn');
  
  if (!counterDisplay || !messageDisplay || 
    !incrementBtn || !messageInputEl || !setMessageBtn ||
    !faveGumDisplay || !faveGumInputEl || !setFaveGumBtn
  ) {
    throw new Error('Required UI elements not found');
  }
  
  // Type narrowing for input element
  if (!(messageInputEl instanceof HTMLInputElement)) {
    throw new Error('message-input element is not an HTMLInputElement');
  }
  
  const messageInput = messageInputEl;

  // Type narrowing for input element
  if (!(faveGumInputEl instanceof HTMLInputElement)) {
    throw new Error('fave-gum-input element is not an HTMLInputElement');
  }
  
  const faveGumInput = faveGumInputEl;
  
  // Update display with initial values
  // **Learning Point**: We call WASM functions directly from TypeScript.
  // The wasm-bindgen generated code handles the marshalling between JS and WASM.
  if (WASM_HELLO.wasmModule) {
    counterDisplay.textContent = WASM_HELLO.wasmModule.get_counter().toString();
    messageDisplay.textContent = WASM_HELLO.wasmModule.get_message();
    faveGumDisplay.textContent = WASM_HELLO.wasmModule.get_fave_gum();
  }
  
  // Set up event handlers
  // **Learning Point**: This demonstrates how to call WASM functions in response
  // to user interactions. The state is managed in Rust, but we update the UI in TypeScript.
  incrementBtn.addEventListener('click', () => {
    if (WASM_HELLO.wasmModule) {
      WASM_HELLO.wasmModule.increment_counter();
      counterDisplay.textContent = WASM_HELLO.wasmModule.get_counter().toString();
    }
  });
  
  setMessageBtn.addEventListener('click', () => {
    if (WASM_HELLO.wasmModule && messageInput) {
      const newMessage = messageInput.value.trim();
      if (newMessage) {
        WASM_HELLO.wasmModule.set_message(newMessage);
        messageDisplay.textContent = WASM_HELLO.wasmModule.get_message();
        messageInput.value = '';
      }
    }
  });
  
  // Allow Enter key to set message
  messageInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && WASM_HELLO.wasmModule) {
      const newMessage = messageInput.value.trim();
      if (newMessage) {
        WASM_HELLO.wasmModule.set_message(newMessage);
        messageDisplay.textContent = WASM_HELLO.wasmModule.get_message();
        messageInput.value = '';
      }
    }
  });

  setFaveGumBtn.addEventListener('click', () => {
    if (WASM_HELLO.wasmModule && faveGumInput) {
      const newGum = faveGumInput.value.trim();
      if (newGum) {
        WASM_HELLO.wasmModule.set_fave_gum(newGum);
        faveGumDisplay.textContent = WASM_HELLO.wasmModule.get_fave_gum();
        faveGumInput.value = '';
      }
    }
  });

  // Allow Enter key to set message
  faveGumInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && WASM_HELLO.wasmModule) {
      const newGum = faveGumInput.value.trim();
      if (newGum) {
        WASM_HELLO.wasmModule.set_fave_gum(newGum);
        faveGumDisplay.textContent = WASM_HELLO.wasmModule.get_fave_gum();
        faveGumInput.value = '';
      }
    }
  });
};

