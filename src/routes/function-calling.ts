import type { WasmModuleAgentTools } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { loadAgentModel, runAgent, isAgentModelLoaded, getModelId, type ExecuteToolFunction } from '../models/function-calling';
import type { ClarificationCallback } from '../models/function-calling';

// Lazy WASM import - only load when init() is called
let wasmModuleExports: {
  default: () => Promise<unknown>;
  calculate: (expression: string) => string;
  process_text: (text: string, operation: string) => string;
  get_stats: (data: Uint8Array) => string;
} | null = null;

const getInitWasm = async (): Promise<unknown> => {
  if (!wasmModuleExports) {
    const module = await import('../../pkg/wasm_agent_tools/wasm_agent_tools.js');
    wasmModuleExports = {
      default: module.default,
      calculate: module.calculate,
      process_text: module.process_text,
      get_stats: module.get_stats,
    };
  }
  if (!wasmModuleExports) {
    throw new Error('Failed to load WASM module exports');
  }
  return wasmModuleExports.default();
};

let wasmModule: WasmModuleAgentTools | null = null;

// Logging function - accessible to all functions
let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;

function validateAgentToolsModule(exports: unknown): WasmModuleAgentTools | null {
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
  // Check wasmModuleExports for functions, not exports
  if (!wasmModuleExports) {
    missingExports.push('module exports (wasmModuleExports is null)');
  } else {
    if (typeof wasmModuleExports.calculate !== 'function') {
      missingExports.push('calculate (function)');
    }
    if (typeof wasmModuleExports.process_text !== 'function') {
      missingExports.push('process_text (function)');
    }
    if (typeof wasmModuleExports.get_stats !== 'function') {
      missingExports.push('get_stats (function)');
    }
  }
  
  if (missingExports.length > 0) {
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    return null;
  }
  
  // Construct module object from memory (from init result) and functions (from module object)
  if (!wasmModuleExports) {
    return null;
  }
  
  return {
    memory,
    calculate: wasmModuleExports.calculate,
    process_text: wasmModuleExports.process_text,
    get_stats: wasmModuleExports.get_stats,
  };
}

export async function init(): Promise<void> {
  // Get UI elements
  const errorEl = document.getElementById('error');
  const loadingIndicatorEl = document.getElementById('loadingIndicator');
  const checkmarkModelEl = document.getElementById('checkmark-model');
  const systemLogsContentEl = document.getElementById('systemLogsContent');
  const goalInputEl = document.getElementById('goalInput');
  const executeBtn = document.getElementById('executeBtn');
  const agentOutputEl = document.getElementById('agentOutput');
  const finalAnswerEl = document.getElementById('finalAnswer');
  const clarificationDialogEl = document.getElementById('clarificationDialog');
  const clarificationTextEl = document.getElementById('clarificationText');
  const clarificationOptionsEl = document.getElementById('clarificationOptions');
  const clarificationCancelEl = document.getElementById('clarificationCancel');

  if (!errorEl || !loadingIndicatorEl || !checkmarkModelEl || !systemLogsContentEl) {
    throw new Error('Required UI elements not found');
  }

  if (!goalInputEl || !executeBtn || !agentOutputEl || !finalAnswerEl) {
    throw new Error('Agent UI elements not found');
  }

  if (!clarificationDialogEl || !clarificationTextEl || !clarificationOptionsEl || !clarificationCancelEl) {
    throw new Error('Clarification dialog elements not found');
  }

  if (!(goalInputEl instanceof HTMLTextAreaElement) || !(executeBtn instanceof HTMLButtonElement)) {
    throw new Error('Invalid UI element types');
  }

  // Set up logging
  const setupLogging = (): void => {
    addLogEntry = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.textContent = `[${timestamp}] ${message}`;
      systemLogsContentEl.appendChild(logEntry);
      systemLogsContentEl.scrollTop = systemLogsContentEl.scrollHeight;
    };
  };
  
  setupLogging();

  // Initialize WASM module
  try {
    if (addLogEntry) {
      addLogEntry('Initializing WASM agent tools module...', 'info');
      addLogEntry('Import path: ../../pkg/wasm_agent_tools/wasm_agent_tools.js', 'info');
    }
    wasmModule = await loadWasmModule(getInitWasm, validateAgentToolsModule);
    if (addLogEntry) {
      addLogEntry('WASM agent tools module loaded successfully', 'success');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry) {
      addLogEntry(`Failed to load WASM module: ${errorMsg}`, 'error');
      if (error instanceof Error && error.stack) {
        addLogEntry(`Error stack: ${error.stack}`, 'error');
      }
      if (error instanceof Error && 'cause' in error && error.cause) {
        const causeMsg = error.cause instanceof Error 
          ? error.cause.message 
          : typeof error.cause === 'string' 
            ? error.cause 
            : JSON.stringify(error.cause);
        addLogEntry(`Error cause: ${causeMsg}`, 'error');
      }
    }
    errorEl.textContent = `Failed to load WASM module: ${errorMsg}`;
    throw error;
  }

  // Load agent model
  try {
    if (addLogEntry) {
      addLogEntry('Loading agent model...', 'info');
    }
    loadingIndicatorEl.textContent = 'Loading agent model...';
    
    await loadAgentModel(
      (progress) => {
        loadingIndicatorEl.textContent = `Loading agent model... ${Math.round(progress * 100)}%`;
      },
      addLogEntry || undefined
    );

    checkmarkModelEl.classList.add('visible');
    loadingIndicatorEl.textContent = '';
    if (addLogEntry) {
      addLogEntry(`Agent model loaded: ${getModelId()}`, 'success');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry) {
      addLogEntry(`Failed to load agent model: ${errorMsg}`, 'error');
    }
    errorEl.textContent = `Failed to load agent model: ${errorMsg}`;
    throw error;
  }

  // Execute tool function
  const executeTool: ExecuteToolFunction = (functionName: string, args: Record<string, string>): Promise<string> => {
    if (!wasmModule) {
      throw new Error('WASM module not loaded');
    }

    if (addLogEntry) {
      addLogEntry(`Executing tool: ${functionName}(${JSON.stringify(args)})`, 'info');
    }

    return Promise.resolve().then(() => {
      const currentModule = wasmModule;
      if (!currentModule) {
        throw new Error('WASM module not loaded');
      }
      
      try {
        if (functionName === 'calculate') {
          const expression = args.expression || '';
          const result = currentModule.calculate(expression);
          return result;
        } else if (functionName === 'process_text') {
          const text = args.text || '';
          const operation = args.operation || '';
          const result = currentModule.process_text(text, operation);
          return result;
        } else if (functionName === 'get_stats') {
          // Convert data string to Uint8Array
          // Handle both array format "[1,2,3]" and comma-separated "1,2,3"
          let dataStr = args.data || '';
          // Remove brackets if present
          dataStr = dataStr.replace(/^\[|\]$/g, '').trim();
          // Split by comma and parse numbers
          const numbers = dataStr.split(',').map((s) => {
            const trimmed = s.trim();
            const parsed = parseInt(trimmed, 10);
            return Number.isNaN(parsed) ? 0 : parsed;
          }).filter((n) => n >= 0 && n <= 255);
          const dataArray = new Uint8Array(numbers);
          const result = currentModule.get_stats(dataArray);
          return result;
        } else {
          throw new Error(`Unknown function: ${functionName}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (addLogEntry) {
          addLogEntry(`Tool execution error: ${errorMsg}`, 'error');
        }
        throw error;
      }
    });
  };

  // Handle execute button click
  executeBtn.addEventListener('click', () => {
    // Get thinking indicator element reference for use throughout execution
    const thinkingIndicatorEl = document.getElementById('thinkingIndicator');
    
    // Show thinking indicator: add show class (distinct event: button click)
    if (thinkingIndicatorEl instanceof HTMLElement) {
      thinkingIndicatorEl.classList.add('show');
      if (addLogEntry) {
        const hasShow = thinkingIndicatorEl.classList.contains('show');
        const computedStyle = window.getComputedStyle(thinkingIndicatorEl);
        const computedDisplay = computedStyle.display;
        addLogEntry(`Thinking indicator: added show class. Has show: ${hasShow}, computed display: ${computedDisplay}`, 'info');
      }
      // Ensure browser has time to paint the element
      requestAnimationFrame(() => {
        if (thinkingIndicatorEl instanceof HTMLElement && addLogEntry) {
          const computedStyle = window.getComputedStyle(thinkingIndicatorEl);
          const computedDisplay = computedStyle.display;
          const rect = thinkingIndicatorEl.getBoundingClientRect();
          addLogEntry(`Thinking indicator: after paint. Display: ${computedDisplay}, rect: ${rect.width}x${rect.height} at (${rect.left},${rect.top})`, 'info');
        }
      });
    } else {
      if (addLogEntry) {
        addLogEntry('Thinking indicator: element not found', 'error');
      }
    }

    const goal = goalInputEl.value.trim();
    if (!goal) {
      if (addLogEntry) {
        addLogEntry('Please enter a goal', 'warning');
      }
      if (thinkingIndicatorEl instanceof HTMLElement) {
        thinkingIndicatorEl.classList.remove('show');
      }
      return;
    }

    if (!isAgentModelLoaded()) {
      if (addLogEntry) {
        addLogEntry('Agent model not loaded', 'error');
      }
      if (thinkingIndicatorEl instanceof HTMLElement) {
        thinkingIndicatorEl.classList.remove('show');
      }
      return;
    }

    // Clear previous output
    agentOutputEl.innerHTML = '';
    finalAnswerEl.textContent = '';

    // Run agent
    void (async () => {
      // Track when thinking indicator was shown for minimum display time
      const thinkingStartTime = Date.now();
      
      try {
        if (addLogEntry) {
          addLogEntry(`Starting agent with goal: ${goal}`, 'info');
        }
        executeBtn.disabled = true;
        executeBtn.textContent = 'Running...';

        // Human in the loop clarification callback
        const clarifyOperation: ClarificationCallback = (text: string, availableOperations: readonly string[]): Promise<string> => {
          return new Promise((resolve, reject) => {
            if (!clarificationTextEl || !clarificationOptionsEl || !clarificationDialogEl || !clarificationCancelEl) {
              reject(new Error('Clarification dialog elements not found'));
              return;
            }

            if (addLogEntry) {
              addLogEntry(`Clarification needed: What operation for "${text}"?`, 'warning');
            }

            clarificationTextEl.textContent = `"${text}"`;
            clarificationOptionsEl.innerHTML = '';

            availableOperations.forEach((operation) => {
              const optionBtn = document.createElement('button');
              optionBtn.className = 'clarification-option';
              optionBtn.textContent = operation;
              optionBtn.addEventListener('click', () => {
                clarificationDialogEl.classList.add('hidden');
                if (addLogEntry) {
                  addLogEntry(`User selected operation: ${operation}`, 'success');
                }
                resolve(operation);
              });
              clarificationOptionsEl.appendChild(optionBtn);
            });

            const cancelHandler = (): void => {
              clarificationDialogEl.classList.add('hidden');
              if (addLogEntry) {
                addLogEntry('Clarification cancelled by user', 'error');
              }
              reject(new Error('Clarification cancelled by user'));
            };

            clarificationCancelEl.addEventListener('click', cancelHandler, { once: true });
            clarificationDialogEl.classList.remove('hidden');
            
            if (addLogEntry) {
              addLogEntry('Waiting for user to select operation...', 'info');
            }
          });
        };

        const steps = await runAgent(goal, executeTool, addLogEntry || undefined, 5, clarifyOperation);

        // Check if any step has a final response
        let hasFinalResponse = false;

        // Display steps
        steps.forEach((step) => {
          const stepDiv = document.createElement('div');
          stepDiv.className = 'agent-step';
          
          const stepHeader = document.createElement('div');
          stepHeader.className = 'agent-step-header';
          stepHeader.textContent = `Step ${step.step}`;
          stepDiv.appendChild(stepHeader);

          const llmOutputDiv = document.createElement('div');
          llmOutputDiv.className = 'agent-llm-output';
          llmOutputDiv.textContent = `LLM: ${step.llmOutput}`;
          stepDiv.appendChild(llmOutputDiv);

          if (step.functionCall) {
            const functionCallDiv = document.createElement('div');
            functionCallDiv.className = 'agent-function-call';
            functionCallDiv.textContent = `Function: ${step.functionCall.function}(${step.functionCall.arguments})`;
            stepDiv.appendChild(functionCallDiv);

            if (step.functionResult) {
              const functionResultDiv = document.createElement('div');
              functionResultDiv.className = 'agent-function-result';
              functionResultDiv.textContent = `Result: ${step.functionResult}`;
              stepDiv.appendChild(functionResultDiv);
            }
          }

          if (step.finalResponse) {
            hasFinalResponse = true;
            const finalResponseDiv = document.createElement('div');
            finalResponseDiv.className = 'agent-final-response';
            finalResponseDiv.textContent = `Final: ${step.finalResponse}`;
            stepDiv.appendChild(finalResponseDiv);
            finalAnswerEl.textContent = step.finalResponse;
          }

          agentOutputEl.appendChild(stepDiv);
        });

        // Hide thinking animation once final answer is displayed (distinct event: final answer ready)
        // Ensure minimum display time of 3000ms so user can see it even for fast executions
        if (hasFinalResponse && thinkingIndicatorEl instanceof HTMLElement) {
          const elapsed = Date.now() - thinkingStartTime;
          const minDisplayTime = 3000;
          const remainingTime = elapsed < minDisplayTime ? minDisplayTime - elapsed : 0;
          
          if (addLogEntry) {
            addLogEntry(`Thinking indicator: final answer ready. Elapsed: ${elapsed}ms, remaining: ${remainingTime}ms`, 'info');
          }
          
          // Use requestAnimationFrame to count frames for remaining time
          // ~60fps = ~16ms per frame, so 300ms ≈ 18 frames
          if (remainingTime > 0) {
            const targetFrames = Math.ceil(remainingTime / 16);
            let frameCount = 0;
            const delayFrames = (): void => {
              frameCount++;
              if (frameCount < targetFrames) {
                requestAnimationFrame(delayFrames);
              } else {
                if (thinkingIndicatorEl instanceof HTMLElement) {
                  thinkingIndicatorEl.classList.remove('show');
                  if (addLogEntry) {
                    addLogEntry('Thinking indicator: removed show class (final answer ready, min time elapsed)', 'info');
                  }
                }
              }
            };
            requestAnimationFrame(delayFrames);
          } else {
            requestAnimationFrame(() => {
              if (thinkingIndicatorEl instanceof HTMLElement) {
                thinkingIndicatorEl.classList.remove('show');
                if (addLogEntry) {
                  addLogEntry('Thinking indicator: removed show class (final answer ready)', 'info');
                }
              }
            });
          }
        }

        if (addLogEntry) {
          addLogEntry('Agent execution completed', 'success');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (addLogEntry) {
          addLogEntry(`Agent execution error: ${errorMsg}`, 'error');
        }
        errorEl.textContent = `Agent execution error: ${errorMsg}`;
        // Hide thinking indicator on error (also respect minimum display time)
        if (thinkingIndicatorEl instanceof HTMLElement) {
          const elapsed = Date.now() - thinkingStartTime;
          const minDisplayTime = 300;
          const remainingTime = elapsed < minDisplayTime ? minDisplayTime - elapsed : 0;
          
          if (remainingTime > 0) {
            const targetFrames = Math.ceil(remainingTime / 16);
            let frameCount = 0;
            const delayFrames = (): void => {
              frameCount++;
              if (frameCount < targetFrames) {
                requestAnimationFrame(delayFrames);
              } else {
                if (thinkingIndicatorEl instanceof HTMLElement) {
                  thinkingIndicatorEl.classList.remove('show');
                  if (addLogEntry) {
                    addLogEntry('Thinking indicator: removed show class (error, min time elapsed)', 'info');
                  }
                }
              }
            };
            requestAnimationFrame(delayFrames);
          } else {
            requestAnimationFrame(() => {
              if (thinkingIndicatorEl instanceof HTMLElement) {
                thinkingIndicatorEl.classList.remove('show');
                if (addLogEntry) {
                  addLogEntry('Thinking indicator: removed show class (error)', 'info');
                }
              }
            });
          }
        }
      } finally {
        executeBtn.disabled = false;
        executeBtn.textContent = 'Execute';
      }
    })();
  });
}

