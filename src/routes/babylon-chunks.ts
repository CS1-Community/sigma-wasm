/**
 * Babylon-Chunks Route Handler
 * 
 * This endpoint demonstrates the Wave Function Collapse (WFC) algorithm
 * visualized in 3D using BabylonJS. It generates a hexagonal grid of 3D tiles
 * using mesh instancing for optimal performance.
 * 
 * **Key Features:**
 * - WFC algorithm implemented in Rust WASM
 * - 5 different 3D tile types
 * - GLB model loading for hex tiles (see TILE_CONFIG for dimensions, pointy-top orientation)
 * - Mesh instancing for performance
 * - Babylon 2D UI for controls
 * - Fullscreen support
 */

import type { WasmBabylonWfc as WasmBabylonChunks, WasmModuleBabylonChunks, TileType, LayoutConstraints, BuildingRules } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { WasmLoadError, WasmInitError } from '../wasm/types';
import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, Vector3, Mesh, Color3, Matrix, Quaternion, PBRMaterial } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { SceneLoader } from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { AdvancedDynamicTexture, Button, Control } from '@babylonjs/gui';
// Worker message and response types using discriminated unions
type LoadEmbeddingMessage = {
  id: string;
  type: 'load-embedding';
};

type LoadTextGenMessage = {
  id: string;
  type: 'load-textgen';
};

type GenerateEmbeddingMessage = {
  id: string;
  type: 'generate-embedding';
  text: string;
};

type GenerateLayoutMessage = {
  id: string;
  type: 'generate-layout';
  prompt: string;
};

type LoadedResponse = {
  id: string;
  type: 'loaded';
};

type EmbeddingResultResponse = {
  id: string;
  type: 'embedding-result';
  embedding: number[];
};

type LayoutResultResponse = {
  id: string;
  type: 'layout-result';
  response: string;
};

type ErrorResponse = {
  id: string;
  type: 'error';
  error: string;
};

type WorkerResponse = LoadedResponse | EmbeddingResultResponse | LayoutResultResponse | ErrorResponse;

// Worker instance
let babylonChunksWorker: Worker | null = null;

import { PARAMETER_SET_PATTERNS, type ParameterSetPattern } from '../parameter-set-embedding-prompts';

/**
 * Tile Configuration
 * 
 * **Learning Point**: Centralized configuration for tile dimensions ensures consistency
 * and makes it easy to adjust tile sizes without hunting through the codebase.
 */
const TILE_CONFIG = {
  /** Model width in meters (flat-to-flat dimension for pointy-top hex) */
  modelWidth: 17.3,
  /** Model depth in meters (pointy-top to pointy-top dimension) */
  modelDepth: 20.0,
  /** Tile height in meters (vertical dimension) */
  hexHeight: 0.3,
  /**
   * Calculated hexSize in meters (distance from center to vertex)
   * For pointy-top hex: depth = hexSize * 3
   * Therefore: hexSize = modelDepth / 3
   */
  get hexSize(): number {
    return this.modelDepth / 3.0;
  },
} as const;

/**
 * WASM module reference - stored as Record after validation
 */
let wasmModuleRecord: Record<string, unknown> | null = null;

/**
 * Get the WASM module initialization function
 */
const getInitWasm = async (): Promise<unknown> => {
  if (!wasmModuleRecord) {
    // Import path will be rewritten by vite plugin to absolute path in production
    const moduleUnknown: unknown = await import('../../pkg/wasm_babylon_chunks/wasm_babylon_chunks.js');
    
    if (typeof moduleUnknown !== 'object' || moduleUnknown === null) {
      throw new Error('Imported module is not an object');
    }
    
    const moduleKeys = Object.keys(moduleUnknown);
    
    if (!('default' in moduleUnknown) || typeof moduleUnknown.default !== 'function') {
      throw new Error(`Module missing 'default' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('generate_layout' in moduleUnknown) || typeof moduleUnknown.generate_layout !== 'function') {
      throw new Error(`Module missing 'generate_layout' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('get_tile_at' in moduleUnknown) || typeof moduleUnknown.get_tile_at !== 'function') {
      throw new Error(`Module missing 'get_tile_at' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('clear_layout' in moduleUnknown) || typeof moduleUnknown.clear_layout !== 'function') {
      throw new Error(`Module missing 'clear_layout' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('set_pre_constraint' in moduleUnknown) || typeof moduleUnknown.set_pre_constraint !== 'function') {
      throw new Error(`Module missing 'set_pre_constraint' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('clear_pre_constraints' in moduleUnknown) || typeof moduleUnknown.clear_pre_constraints !== 'function') {
      throw new Error(`Module missing 'clear_pre_constraints' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('get_stats' in moduleUnknown) || typeof moduleUnknown.get_stats !== 'function') {
      throw new Error(`Module missing 'get_stats' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('generate_voronoi_regions' in moduleUnknown) || typeof moduleUnknown.generate_voronoi_regions !== 'function') {
      throw new Error(`Module missing 'generate_voronoi_regions' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('validate_road_connectivity' in moduleUnknown) || typeof moduleUnknown.validate_road_connectivity !== 'function') {
      throw new Error(`Module missing 'validate_road_connectivity' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('hex_astar' in moduleUnknown) || typeof moduleUnknown.hex_astar !== 'function') {
      throw new Error(`Module missing 'hex_astar' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('build_path_between_roads' in moduleUnknown) || typeof moduleUnknown.build_path_between_roads !== 'function') {
      throw new Error(`Module missing 'build_path_between_roads' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('generate_road_network_growing_tree' in moduleUnknown) || typeof moduleUnknown.generate_road_network_growing_tree !== 'function') {
      throw new Error(`Module missing 'generate_road_network_growing_tree' export. Available: ${moduleKeys.join(', ')}`);
    }
    if (!('get_wasm_version' in moduleUnknown) || typeof moduleUnknown.get_wasm_version !== 'function') {
      throw new Error(`Module missing 'get_wasm_version' export. Available: ${moduleKeys.join(', ')}`);
    }
    
    // Store module as Record after validation
    // TypeScript can't narrow dynamic import types, so we use Record pattern
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    wasmModuleRecord = moduleUnknown as Record<string, unknown>;
  }
  
  if (!wasmModuleRecord) {
    throw new Error('Failed to initialize module record');
  }
  
  const defaultFunc = wasmModuleRecord.default;
  if (typeof defaultFunc !== 'function') {
    throw new Error('default export is not a function');
  }
  
  // Call the function - we've validated it's a function
  // TypeScript can't narrow Function to specific signature, but runtime is safe
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
  const result = defaultFunc();
  if (!(result instanceof Promise)) {
    throw new Error('default export did not return a Promise');
  }
  
  return result;
};

/**
 * Global state object for the babylon-chunks module
 */
const WASM_BABYLON_CHUNKS: WasmBabylonChunks = {
  wasmModule: null,
  wasmModulePath: '../pkg/wasm_babylon_chunks',
};

/**
 * Logging function for system logs
 */
let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;

/**
 * Store the last user prompt for comparison with generated stats
 */
let lastUserPrompt: string | null = null;

/**
 * Store the current number of rings for rendering
 * Default to 5 rings
 */
let currentRings: number = 5;

/**
 * Convert WASM tile type number to TypeScript TileType
 */
function tileTypeFromNumber(tileNum: number): TileType | null {
  switch (tileNum) {
    case 0:
      return { type: 'grass' };
    case 1:
      return { type: 'building' };
    case 2:
      return { type: 'road' };
    case 3:
      return { type: 'forest' };
    case 4:
      return { type: 'water' };
    default:
      return null;
  }
}

/**
 * Get color for a tile type
 * 
 * **Learning Point**: Each tile type gets a distinct color for visual differentiation.
 * In a full implementation, you might load textures instead of using solid colors.
 */
function getTileColor(tileType: TileType): Color3 {
  switch (tileType.type) {
    case 'grass':
      return new Color3(0.2, 0.8, 0.2); // Green
    case 'building':
      return new Color3(0.96, 0.96, 0.96); // Off-white
    case 'road':
      return new Color3(0.196, 0.196, 0.196); // Very dark gray
    case 'forest':
      return new Color3(0.1, 0.5, 0.1); // Dark green
    case 'water':
      return new Color3(0, 0.749, 1.0); // Bright brilliant blue
  }
}

/**
 * Validate that the WASM module has all required exports
 */
function validateBabylonChunksModule(exports: unknown): WasmModuleBabylonChunks | null {
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
  
  // Validate all required functions exist on exports
  // All functions should be on the module object (wasmModuleRecord), not the init result
  // This matches the pattern used for get_wasm_version which works correctly
  const generateLayoutValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'generate_layout') : getProperty(exports, 'generate_layout');
  const getTileAtValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'get_tile_at') : getProperty(exports, 'get_tile_at');
  const clearLayoutValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'clear_layout') : getProperty(exports, 'clear_layout');
  const setPreConstraintValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'set_pre_constraint') : getProperty(exports, 'set_pre_constraint');
  const clearPreConstraintsValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'clear_pre_constraints') : getProperty(exports, 'clear_pre_constraints');
  const getStatsValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'get_stats') : getProperty(exports, 'get_stats');
  const generateVoronoiRegionsValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'generate_voronoi_regions') : getProperty(exports, 'generate_voronoi_regions');
  const validateRoadConnectivityValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'validate_road_connectivity') : getProperty(exports, 'validate_road_connectivity');
  const hexAstarValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'hex_astar') : getProperty(exports, 'hex_astar');
  const buildPathBetweenRoadsValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'build_path_between_roads') : getProperty(exports, 'build_path_between_roads');
  const generateRoadNetworkGrowingTreeValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'generate_road_network_growing_tree') : getProperty(exports, 'generate_road_network_growing_tree');
  const getWasmVersionValue = wasmModuleRecord ? getProperty(wasmModuleRecord, 'get_wasm_version') : getProperty(exports, 'get_wasm_version');
  
  if (typeof generateLayoutValue !== 'function') {
    missingExports.push('generate_layout (function)');
  }
  if (typeof getTileAtValue !== 'function') {
    missingExports.push('get_tile_at (function)');
  }
  if (typeof clearLayoutValue !== 'function') {
    missingExports.push('clear_layout (function)');
  }
  if (typeof setPreConstraintValue !== 'function') {
    missingExports.push('set_pre_constraint (function)');
  }
  if (typeof clearPreConstraintsValue !== 'function') {
    missingExports.push('clear_pre_constraints (function)');
  }
  if (typeof getStatsValue !== 'function') {
    missingExports.push('get_stats (function)');
  }
  if (typeof generateVoronoiRegionsValue !== 'function') {
    missingExports.push('generate_voronoi_regions (function)');
  }
  if (typeof validateRoadConnectivityValue !== 'function') {
    missingExports.push('validate_road_connectivity (function)');
  }
  if (typeof hexAstarValue !== 'function') {
    missingExports.push('hex_astar (function)');
  }
  if (typeof buildPathBetweenRoadsValue !== 'function') {
    missingExports.push('build_path_between_roads (function)');
  }
  if (typeof generateRoadNetworkGrowingTreeValue !== 'function') {
    missingExports.push('generate_road_network_growing_tree (function)');
  }
  
  if (missingExports.length > 0) {
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    return null;
  }
  
  // Extract functions from exports after validation
  const generateLayoutFunc = generateLayoutValue;
  const getTileAtFunc = getTileAtValue;
  const clearLayoutFunc = clearLayoutValue;
  const setPreConstraintFunc = setPreConstraintValue;
  const clearPreConstraintsFunc = clearPreConstraintsValue;
  const getStatsFunc = getStatsValue;
  const generateVoronoiRegionsFunc = generateVoronoiRegionsValue;
  const validateRoadConnectivityFunc = validateRoadConnectivityValue;
  const hexAstarFunc = hexAstarValue;
  const buildPathBetweenRoadsFunc = buildPathBetweenRoadsValue;
  const generateRoadNetworkGrowingTreeFunc = generateRoadNetworkGrowingTreeValue;
  const getWasmVersionFunc = getWasmVersionValue;
  
  if (
    typeof generateLayoutFunc !== 'function' ||
    typeof getTileAtFunc !== 'function' ||
    typeof clearLayoutFunc !== 'function' ||
    typeof setPreConstraintFunc !== 'function' ||
    typeof clearPreConstraintsFunc !== 'function' ||
    typeof getStatsFunc !== 'function' ||
    typeof generateVoronoiRegionsFunc !== 'function' ||
    typeof validateRoadConnectivityFunc !== 'function' ||
    typeof hexAstarFunc !== 'function' ||
    typeof buildPathBetweenRoadsFunc !== 'function' ||
    typeof generateRoadNetworkGrowingTreeFunc !== 'function' ||
    typeof getWasmVersionFunc !== 'function'
  ) {
    return null;
  }
  
  // All functions have been validated to exist and be functions
  // TypeScript can't narrow Function to specific signatures, but runtime validation ensures safety
  // We wrap them in functions with proper types to avoid type assertions
  return {
    memory,
    generate_layout: (): void => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      generateLayoutFunc();
    },
    get_tile_at: (x: number, y: number): number => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
      return getTileAtFunc(x, y);
    },
    clear_layout: (): void => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      clearLayoutFunc();
    },
    set_pre_constraint: (x: number, y: number, tile_type: number): boolean => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = setPreConstraintFunc(x, y, tile_type);
      return typeof result === 'boolean' ? result : false;
    },
    clear_pre_constraints: (): void => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      clearPreConstraintsFunc();
    },
    get_stats: (): string => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = getStatsFunc();
      return typeof result === 'string' ? result : '{}';
    },
    generate_voronoi_regions: (
      max_layer: number,
      center_q: number,
      center_r: number,
      forest_seeds: number,
      water_seeds: number,
      grass_seeds: number
    ): string => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = generateVoronoiRegionsFunc(max_layer, center_q, center_r, forest_seeds, water_seeds, grass_seeds);
      return typeof result === 'string' ? result : '[]';
    },
    validate_road_connectivity: (roads_json: string): boolean => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = validateRoadConnectivityFunc(roads_json);
      return typeof result === 'boolean' ? result : false;
    },
    hex_astar: (
      start_q: number,
      start_r: number,
      goal_q: number,
      goal_r: number,
      valid_terrain_json: string
    ): string => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = hexAstarFunc(start_q, start_r, goal_q, goal_r, valid_terrain_json);
      return typeof result === 'string' ? result : 'null';
    },
    build_path_between_roads: (
      start_q: number,
      start_r: number,
      end_q: number,
      end_r: number,
      valid_terrain_json: string
    ): string => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = buildPathBetweenRoadsFunc(start_q, start_r, end_q, end_r, valid_terrain_json);
      return typeof result === 'string' ? result : 'null';
    },
    generate_road_network_growing_tree: (
      seeds_json: string,
      valid_terrain_json: string,
      occupied_json: string,
      target_count: number
    ): string => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const result = generateRoadNetworkGrowingTreeFunc(seeds_json, valid_terrain_json, occupied_json, target_count);
      return typeof result === 'string' ? result : '[]';
    },
    get_wasm_version: (): string => {
      if (typeof getWasmVersionFunc !== 'function') {
        return 'unknown (function not found)';
      }
      try {
        // Call the wasm-bindgen generated function which should return a string
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = getWasmVersionFunc();
        // wasm-bindgen automatically converts String returns to JavaScript strings
        // If we get a string, return it directly
        if (typeof result === 'string') {
          return result;
        }
        // Check if it's an array (tuple) and convert manually if needed
        if (Array.isArray(result) && result.length === 2 && typeof result[0] === 'number' && typeof result[1] === 'number') {
          // This is the raw tuple [ptr, len] - we need to access the WASM memory
          // But we shouldn't need to do this if the wrapper is working correctly
          return 'unknown (got tuple - wrapper issue)';
        }
        // Check if it's an object with string properties
        if (typeof result === 'object' && result !== null) {
          // Try to extract string value from object
          if ('value' in result && typeof result.value === 'string') {
            return result.value;
          }
          if ('toString' in result && typeof result.toString === 'function') {
            const str = result.toString();
            if (typeof str === 'string') {
              return str;
            }
          }
          return `unknown (object: ${JSON.stringify(result).substring(0, 100)})`;
        }
        return `unknown (unexpected type: ${typeof result})`;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return `unknown (error: ${errorMsg})`;
      }
    },
  };
}

// Qwen model state
let isModelLoading = false;
let isModelLoaded = false;

// Embedding model state
let isEmbeddingModelLoading = false;
let isEmbeddingModelLoaded = false;

/**
 * Cached pattern with embedding and constraints
 * Constraints are partial - patterns only specify semantically relevant constraints
 * Defaults are applied separately when blending
 */
interface CachedPattern {
  pattern: string;
  embedding: Float32Array;
  constraints: Partial<LayoutConstraints>;
}

/**
 * IndexedDB database name for pattern cache
 */
const PATTERN_CACHE_DB_NAME = 'babylon-chunks-pattern-cache';
const PATTERN_CACHE_STORE_NAME = 'patterns';
const PATTERN_CACHE_VERSION = 1;

/**
 * Load embedding model for semantic pattern matching in Web Worker
 */
async function loadEmbeddingModel(): Promise<void> {
  if (isEmbeddingModelLoaded && babylonChunksWorker) {
    return;
  }

  if (isEmbeddingModelLoading) {
    return;
  }

  isEmbeddingModelLoading = true;

  try {
    if (addLogEntry !== null) {
      addLogEntry('Loading embedding model for pattern matching in worker...', 'info');
    }

    // Create worker if it doesn't exist
    if (!babylonChunksWorker) {
      babylonChunksWorker = new Worker(
        new URL('./babylon-chunks.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    const worker = babylonChunksWorker;

    // Wait for worker to load embedding model
    await new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();

      const handler = (event: MessageEvent<WorkerResponse>): void => {
        if (event.data.id !== id) {
          return;
        }

        worker.removeEventListener('message', handler);

        if (event.data.type === 'loaded') {
          resolve();
        } else if (event.data.type === 'error') {
          reject(new Error(event.data.error));
        }
      };

      worker.addEventListener('message', handler);

      const loadMessage: LoadEmbeddingMessage = { id, type: 'load-embedding' };
      worker.postMessage(loadMessage);
    });

    isEmbeddingModelLoaded = true;
    isEmbeddingModelLoading = false;

    if (addLogEntry !== null) {
      addLogEntry('Embedding model loaded successfully', 'success');
    }
  } catch (error) {
    isEmbeddingModelLoading = false;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to load embedding model: ${errorMsg}`, 'warning');
    }
    // Don't throw - embedding matching is optional enhancement
  }
}

/**
 * Type predicate to validate CachedPattern structure from IndexedDB
 * Validates the stored format (embedding as number[]) and narrows unknown to the stored shape
 */
function isCachedPatternStored(data: unknown): data is { pattern: string; embedding: number[]; constraints: unknown } {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  
  // Use built-in control flow with 'in' + typeof checks - TS narrows step-by-step
  // Single narrow cast after exhaustive checks
  if (!('pattern' in data) || !('embedding' in data) || !('constraints' in data)) {
    return false;
  }
  
  // Use built-in control flow - single narrow cast after exhaustive checks
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const obj = data as Record<'pattern' | 'embedding' | 'constraints', unknown>;
  
  // Exhaustive validation of required properties
  return (
    typeof obj.pattern === 'string' &&
    Array.isArray(obj.embedding) &&
    obj.embedding.every((n): n is number => typeof n === 'number' && !Number.isNaN(n) && Number.isFinite(n)) &&
    typeof obj.constraints === 'object' &&
    obj.constraints !== null
  );
}

/**
 * Generic helper to get typed results from IndexedDB with validator
 * Uses type predicate to safely narrow unknown to T
 * Uses safeGetAll to avoid unsafe access to request.result
 */
function getTypedAll<T>(
  store: IDBObjectStore,
  validator: (raw: unknown) => raw is T
): Promise<Array<T>> {
  return safeGetAll(store).then((rawResults) => {
    const results: Array<T> = [];
    
    // Validate each result using the type predicate
    for (const raw of rawResults) {
      if (validator(raw)) {
        results.push(raw);
      }
    }
    
    return results;
  });
}

/**
 * Helper to safely get all results from IndexedDB store
 * Returns unknown[] to avoid unsafe access - narrow in consumer
 */
function safeGetAll(store: IDBObjectStore): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const result = req.result;
      resolve(Array.isArray(result) ? result : []);
    };
    req.onerror = () => {
      if (req.error) {
        reject(req.error);
      } else {
        reject(new Error('Failed to get all items from IndexedDB'));
      }
    };
  });
}

/**
 * Initialize IndexedDB for pattern cache
 */
async function initPatternCacheDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(PATTERN_CACHE_DB_NAME, PATTERN_CACHE_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      const result = request.result;
      // Narrow result type - IDBOpenDBRequest.result is IDBDatabase on success
      if (result instanceof IDBDatabase) {
        resolve(result);
      } else {
        reject(new Error('IndexedDB request result is not a database'));
      }
    };

    request.onupgradeneeded = (event) => {
      const target = event.target;
      if (!(target instanceof IDBOpenDBRequest)) {
        throw new Error('Event target is not IDBOpenDBRequest');
      }
      const result = target.result;
      if (result instanceof IDBDatabase) {
        const db = result;
        if (!db.objectStoreNames.contains(PATTERN_CACHE_STORE_NAME)) {
          const store = db.createObjectStore(PATTERN_CACHE_STORE_NAME, { keyPath: 'pattern' });
          store.createIndex('pattern', 'pattern', { unique: true });
        }
      }
    };
  });
}

/**
 * Store pattern in IndexedDB cache
 */
async function cachePattern(pattern: string, embedding: Float32Array, constraints: Partial<LayoutConstraints>): Promise<void> {
  try {
    const db = await initPatternCacheDB();
    const transaction = db.transaction([PATTERN_CACHE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PATTERN_CACHE_STORE_NAME);

    // Convert Float32Array to Array for IndexedDB storage
    const embeddingArray = Array.from(embedding);

    const cachedPattern: CachedPattern = {
      pattern,
      embedding: new Float32Array(embeddingArray), // Will be converted back on retrieval
      constraints,
    };

    // Store as plain object with array instead of Float32Array
    const storedPattern = {
      pattern: cachedPattern.pattern,
      embedding: embeddingArray,
      constraints: cachedPattern.constraints,
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(storedPattern);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(new Error('Failed to store pattern in cache'));
      };
    });

    db.close();

    if (addLogEntry !== null) {
      addLogEntry(`  → Stored pattern "${pattern}" in IndexedDB with ${embedding.length}-dim embedding`, 'success');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to cache pattern: ${errorMsg}`, 'warning');
    }
  }
}

/**
 * Load all cached patterns from IndexedDB
 */
async function loadCachedPatterns(): Promise<Array<CachedPattern>> {
  try {
    const db = await initPatternCacheDB();
    const transaction = db.transaction([PATTERN_CACHE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(PATTERN_CACHE_STORE_NAME);

    // Use generic helper with type predicate validator
    // Type predicate validates and narrows unknown to the stored shape
    const storedResults = await getTypedAll(store, isCachedPatternStored);
    const cachedPatterns: Array<CachedPattern> = [];
    let firstEmbeddingLogged = false;

    // storedResults is now properly typed as Array<{ pattern: string; embedding: number[]; constraints: unknown }>
    for (const stored of storedResults) {
      // Type predicate already validated structure - stored is properly narrowed
      // Convert embedding array to Float32Array
      const embedding = new Float32Array(stored.embedding.length);
      for (let i = 0; i < stored.embedding.length; i++) {
        const val = stored.embedding[i];
        // Type predicate already validated these are numbers, but double-check for safety
        if (typeof val === 'number' && !Number.isNaN(val) && Number.isFinite(val)) {
          embedding[i] = val;
        }
      }

      // Log first 10 float values of the first embedding loaded
      if (!firstEmbeddingLogged && embedding.length > 0) {
        const firstTen = Array.from(embedding.slice(0, 10));
        if (addLogEntry !== null) {
          addLogEntry(`[FIRST CACHED EMBEDDING] Pattern "${stored.pattern}": First 10 float values: [${firstTen.map(v => v.toFixed(6)).join(', ')}]`, 'info');
        }
        firstEmbeddingLogged = true;
      }

      // Narrow constraints type properly with union type checks
      const constraints: Partial<LayoutConstraints> = {};
      const constraintsObj = stored.constraints;
      
      // Helper function to safely get property value without type assertions
      const getPropertyValue = (obj: unknown, key: string): unknown => {
        if (typeof obj !== 'object' || obj === null) {
          return undefined;
        }
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        if (descriptor && 'value' in descriptor) {
          return descriptor.value;
        }
        return undefined;
      };
      
      // Validate and extract each constraint property with proper type narrowing
      if (typeof constraintsObj === 'object' && constraintsObj !== null) {
        // Extract and validate each property individually using helper function
        const buildingDensityValue = getPropertyValue(constraintsObj, 'buildingDensity');
        if (buildingDensityValue === 'sparse' || buildingDensityValue === 'medium' || buildingDensityValue === 'dense') {
          constraints.buildingDensity = buildingDensityValue;
        }
        
        const clusteringValue = getPropertyValue(constraintsObj, 'clustering');
        if (clusteringValue === 'clustered' || clusteringValue === 'distributed' || clusteringValue === 'random') {
          constraints.clustering = clusteringValue;
        }
        
        const grassRatioValue = getPropertyValue(constraintsObj, 'grassRatio');
        if (typeof grassRatioValue === 'number') {
          constraints.grassRatio = grassRatioValue;
        }
        
        const buildingSizeHintValue = getPropertyValue(constraintsObj, 'buildingSizeHint');
        if (buildingSizeHintValue === 'small' || buildingSizeHintValue === 'medium' || buildingSizeHintValue === 'large') {
          constraints.buildingSizeHint = buildingSizeHintValue;
        }
        
        const ringsValue = getPropertyValue(constraintsObj, 'rings');
        if (typeof ringsValue === 'number') {
          constraints.rings = ringsValue;
        }
        // Legacy support: also check for maxLayer
        const maxLayerValue = getPropertyValue(constraintsObj, 'maxLayer');
        if (typeof maxLayerValue === 'number' && constraints.rings === undefined) {
          constraints.rings = maxLayerValue;
        }
        
        const primaryTileTypeValue = getPropertyValue(constraintsObj, 'primaryTileType');
        if (primaryTileTypeValue === 'grass' || primaryTileTypeValue === 'building' || primaryTileTypeValue === 'road' || primaryTileTypeValue === 'forest' || primaryTileTypeValue === 'water') {
          constraints.primaryTileType = primaryTileTypeValue;
        }
      }

      cachedPatterns.push({
        pattern: stored.pattern,
        embedding,
        constraints,
      });
    }

    const patterns = cachedPatterns;

    db.close();
    return patterns;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to load cached patterns: ${errorMsg}`, 'warning');
    }
    return [];
  }
}

/**
 * Calculate cosine similarity between two embeddings
 * COSINE SIMILARITY = (A · B) / (||A|| * ||B||)
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    if (addLogEntry !== null) {
      addLogEntry(`⚠ Vector dimension mismatch: ${a.length} vs ${b.length}`, 'warning');
    }
    return 0;
  }

  if (addLogEntry !== null) {
    addLogEntry(`  → Computing cosine similarity (vectors: ${a.length} dimensions)...`, 'info');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    if (addLogEntry !== null) {
      addLogEntry(`  → Zero denominator detected (normA: ${normA.toFixed(6)}, normB: ${normB.toFixed(6)})`, 'warning');
    }
    return 0;
  }

  const similarity = dotProduct / denominator;
  
  if (addLogEntry !== null) {
    addLogEntry(`  → Cosine similarity computed: dotProduct=${dotProduct.toFixed(6)}, ||A||=${Math.sqrt(normA).toFixed(6)}, ||B||=${Math.sqrt(normB).toFixed(6)}, result=${similarity.toFixed(6)}`, 'info');
  }

  return similarity;
}

/**
 * Generate embedding for text using the embedding model in Web Worker
 */
async function generateEmbedding(text: string): Promise<Float32Array | null> {
  if (!babylonChunksWorker) {
    await loadEmbeddingModel();
    if (!babylonChunksWorker) {
      return null;
    }
  }

  try {
    if (addLogEntry !== null) {
      addLogEntry(`Generating embedding for: "${text}"`, 'info');
    }

    const worker = babylonChunksWorker;

    return new Promise<Float32Array | null>((resolve) => {
      const id = crypto.randomUUID();

      const handler = (event: MessageEvent<WorkerResponse>): void => {
        if (event.data.id !== id) {
          return;
        }

        worker.removeEventListener('message', handler);

        if (event.data.type === 'embedding-result') {
          // Convert array back to Float32Array
          resolve(new Float32Array(event.data.embedding));
        } else if (event.data.type === 'error') {
          if (addLogEntry !== null) {
            addLogEntry(`Failed to generate embedding: ${event.data.error}`, 'warning');
          }
          resolve(null);
        }
      };

      worker.addEventListener('message', handler);

      const generateMessage: GenerateEmbeddingMessage = {
        id,
        type: 'generate-embedding',
        text,
      };

      worker.postMessage(generateMessage);
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to generate embedding: ${errorMsg}`, 'warning');
    }
    return null;
  }
}


/**
 * Find the best matching parameter set pattern using cosine similarity
 * Returns the single best match (highest similarity) from the 27 parameter set patterns
 */
async function findBestMatchingPattern(
  userPrompt: string,
  cachedPatterns: Array<CachedPattern>
): Promise<{ pattern: CachedPattern; similarity: number } | null> {
  if (addLogEntry !== null) {
    addLogEntry('Generating embedding for user prompt...', 'info');
  }
  
  const userEmbedding = await generateEmbedding(userPrompt);
  if (!userEmbedding) {
    if (addLogEntry !== null) {
      addLogEntry('Failed to generate user prompt embedding', 'warning');
    }
    return null;
  }

  if (addLogEntry !== null) {
    addLogEntry(`Comparing against ${cachedPatterns.length} parameter set patterns...`, 'info');
  }

  // Pure semantic matching - find best match from 27 parameter set patterns
  let bestMatch: { pattern: CachedPattern; similarity: number } | null = null;
  let bestSimilarity = -1;

  for (const cached of cachedPatterns) {
    if (addLogEntry !== null) {
      addLogEntry(`[VECTOR COMPUTATION] Comparing against pattern: "${cached.pattern.substring(0, 80)}..."`, 'info');
    }
    
    // Pure cosine similarity - no modifications, no string matching
    const similarity = cosineSimilarity(userEmbedding, cached.embedding);
    
    if (addLogEntry !== null) {
      addLogEntry(`[RESULT] Similarity: ${similarity.toFixed(3)}`, 'info');
    }
    
    // Track best match
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = { pattern: cached, similarity };
    }
  }

  if (bestMatch) {
    if (addLogEntry !== null) {
      addLogEntry(`[BEST MATCH] Selected pattern with similarity ${bestSimilarity.toFixed(3)}:`, 'info');
      addLogEntry(`  "${bestMatch.pattern.pattern}"`, 'info');
    }
    return bestMatch;
  }

  if (addLogEntry !== null) {
    addLogEntry('✗ No matching pattern found', 'warning');
  }
  return null;
}

/**
 * Initialize parameter set patterns in cache if not already present
 * Uses the 27 rich sensory pattern descriptions from parameter-set-embedding-prompts.ts
 * Validates that existing patterns have valid embeddings, regenerates if needed
 */
async function initializeCommonPatterns(): Promise<void> {
  try {
    if (addLogEntry !== null) {
      addLogEntry('=== PATTERN CACHE INITIALIZATION ===', 'info');
    }

    // Use the 27 parameter set patterns with rich sensory descriptions
    const commonPatterns: Array<ParameterSetPattern> = PARAMETER_SET_PATTERNS;

    // Check existing patterns and validate embeddings
    const existingPatterns = await loadCachedPatterns();
    const existingPatternMap = new Map<string, CachedPattern>();
    for (const existing of existingPatterns) {
      existingPatternMap.set(existing.pattern, existing);
    }

    if (addLogEntry !== null) {
      addLogEntry(`Found ${existingPatterns.length} existing patterns in cache`, 'info');
    }

    // Ensure embedding model is loaded before generating embeddings
    if (addLogEntry !== null) {
      addLogEntry('Loading embedding model for pattern initialization...', 'info');
    }
    await loadEmbeddingModel();
    
    if (!babylonChunksWorker) {
      if (addLogEntry !== null) {
        addLogEntry('✗ Embedding model failed to load - cannot generate embeddings', 'error');
      }
      return;
    }

    let patternsInitialized = 0;
    let patternsRegenerated = 0;
    let patternsSkipped = 0;
    let patternsFailed = 0;
    let firstEmbeddingLogged = false;

    // Generate embeddings and cache patterns
    for (const commonPattern of commonPatterns) {
      const existing = existingPatternMap.get(commonPattern.pattern);
      
      // Check if existing pattern has valid embedding
      let needsRegeneration = true;
      if (existing) {
        if (existing.embedding && existing.embedding.length > 0) {
          if (addLogEntry !== null) {
            addLogEntry(`Pattern "${commonPattern.pattern}" already cached with ${existing.embedding.length}-dim embedding`, 'info');
          }
          needsRegeneration = false;
          patternsSkipped++;
        } else {
          if (addLogEntry !== null) {
            addLogEntry(`Pattern "${commonPattern.pattern}" exists but has invalid/empty embedding - regenerating...`, 'warning');
          }
          patternsRegenerated++;
        }
      } else {
        if (addLogEntry !== null) {
          addLogEntry(`Pattern "${commonPattern.pattern}" not found in cache - generating embedding...`, 'info');
        }
        patternsInitialized++;
      }

      if (needsRegeneration) {
        if (addLogEntry !== null) {
          addLogEntry(`  → Generating embedding for: "${commonPattern.pattern}"`, 'info');
        }
        
        const embedding = await generateEmbedding(commonPattern.pattern);
        if (embedding && embedding.length > 0) {
          if (addLogEntry !== null) {
            addLogEntry(`  → Generated ${embedding.length}-dimensional embedding vector`, 'success');
            
            // Log first 10 float values of the first embedding created
            if (!firstEmbeddingLogged) {
              const firstTen = Array.from(embedding.slice(0, 10));
              addLogEntry(`  → [FIRST EMBEDDING] First 10 float values: [${firstTen.map(v => v.toFixed(6)).join(', ')}]`, 'info');
              firstEmbeddingLogged = true;
            }
          }
          await cachePattern(commonPattern.pattern, embedding, commonPattern.constraints);
          
          if (addLogEntry !== null) {
            addLogEntry(`  → ✓ Cached pattern "${commonPattern.pattern}" with embedding`, 'success');
          }
        } else {
          patternsFailed++;
          if (addLogEntry !== null) {
            addLogEntry(`  → ✗ Failed to generate embedding for "${commonPattern.pattern}"`, 'error');
          }
        }
      }
    }

    if (addLogEntry !== null) {
      addLogEntry(`=== PATTERN CACHE SUMMARY ===`, 'info');
      addLogEntry(`  - Initialized: ${patternsInitialized}`, 'info');
      addLogEntry(`  - Regenerated: ${patternsRegenerated}`, 'info');
      addLogEntry(`  - Skipped (valid): ${patternsSkipped}`, 'info');
      addLogEntry(`  - Failed: ${patternsFailed}`, patternsFailed > 0 ? 'error' : 'info');
      addLogEntry(`=== END PATTERN CACHE INITIALIZATION ===`, 'info');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`✗ Failed to initialize common patterns: ${errorMsg}`, 'error');
      addLogEntry(`=== END PATTERN CACHE INITIALIZATION (ERROR) ===`, 'error');
    }
  }
}

/**
 * Load Qwen model for text-to-layout generation in Web Worker
 */
async function loadQwenModel(onProgress?: (progress: number) => void): Promise<void> {
  if (isModelLoaded && babylonChunksWorker) {
    return;
  }

  if (isModelLoading) {
    return;
  }

  isModelLoading = true;

  try {
    if (onProgress) {
      onProgress(0.1);
    }

    // Create worker if it doesn't exist
    if (!babylonChunksWorker) {
      babylonChunksWorker = new Worker(
        new URL('./babylon-chunks.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    const worker = babylonChunksWorker;

    // Wait for worker to load text generation model
    await new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();

      const handler = (event: MessageEvent<WorkerResponse>): void => {
        if (event.data.id !== id) {
          return;
        }

        worker.removeEventListener('message', handler);

        if (event.data.type === 'loaded') {
          resolve();
        } else if (event.data.type === 'error') {
          reject(new Error(event.data.error));
        }
      };

      worker.addEventListener('message', handler);

      const loadMessage: LoadTextGenMessage = { id, type: 'load-textgen' };
      worker.postMessage(loadMessage);
    });

    if (onProgress) {
      onProgress(1.0);
    }

    isModelLoaded = true;
    isModelLoading = false;
  } catch (error) {
    isModelLoading = false;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to load Qwen model: ${errorMsg}`);
  }
}


/**
 * Get default layout constraints for initial render
 */
function getDefaultConstraints(): LayoutConstraints {
  return {
    buildingDensity: 'medium',
    clustering: 'random',
    grassRatio: 0.3,
    buildingSizeHint: 'medium',
  };
}

/**
 * Generate layout description from text prompt using Qwen in Web Worker
 * Supports both JSON output and function calling
 */
async function generateLayoutDescription(prompt: string): Promise<string> {
  if (!babylonChunksWorker) {
    throw new Error('Qwen model not loaded');
  }

  const worker = babylonChunksWorker;

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();

    const handler = (event: MessageEvent<WorkerResponse>): void => {
      if (event.data.id !== id) {
        return;
      }

      worker.removeEventListener('message', handler);

      if (event.data.type === 'layout-result') {
        resolve(event.data.response);
      } else if (event.data.type === 'error') {
        reject(new Error(event.data.error));
      }
    };

    worker.addEventListener('message', handler);

    const generateMessage: GenerateLayoutMessage = {
      id,
      type: 'generate-layout',
      prompt,
    };

    worker.postMessage(generateMessage);
  });
}


/**
 * Parse layout constraints from Qwen output
 * Handles extended constraints with optional parameters
 * Also extracts specific requests from the original prompt
 * Optionally uses semantic pattern matching for better constraint inference
 */
async function parseLayoutConstraints(
  output: string,
  originalPrompt?: string
): Promise<LayoutConstraints> {
  let result: LayoutConstraints = {
    buildingDensity: 'medium',
    clustering: 'random',
    grassRatio: 0.3,
    buildingSizeHint: 'medium',
  };

  // Try semantic pattern matching first if prompt is provided
  // Use the 27 parameter set patterns to find the best match
  if (originalPrompt) {
    if (addLogEntry !== null) {
      addLogEntry('=== VECTOR SIMILARITY SEARCH ===', 'info');
      addLogEntry(`User prompt: "${originalPrompt}"`, 'info');
      addLogEntry('Starting semantic pattern matching against 27 parameter set patterns...', 'info');
    }
    
    try {
      const cachedPatterns = await loadCachedPatterns();
      
      if (addLogEntry !== null) {
        addLogEntry(`Loaded ${cachedPatterns.length} cached patterns from IndexedDB`, 'info');
      }
      
      if (cachedPatterns.length > 0) {
        const bestMatch = await findBestMatchingPattern(originalPrompt, cachedPatterns);
        if (bestMatch) {
          // Use constraints directly from the best matching parameter set pattern
          const matchedConstraints = bestMatch.pattern.constraints;
          if (matchedConstraints) {
            // Merge matched constraints with defaults
            result = {
              ...result,
              ...matchedConstraints,
            };
            if (addLogEntry !== null) {
              addLogEntry(`✓ Using best matching parameter set pattern (similarity: ${bestMatch.similarity.toFixed(3)})`, 'success');
            }
          }
        } else {
          if (addLogEntry !== null) {
            addLogEntry('✗ No matching parameter set pattern found', 'info');
          }
        }
      } else {
        if (addLogEntry !== null) {
          addLogEntry('⚠ No cached patterns available for matching - patterns may still be initializing', 'warning');
          addLogEntry('Pattern cache initialization runs in background on route load', 'info');
        }
      }
      
      if (addLogEntry !== null) {
        addLogEntry('=== END VECTOR SIMILARITY SEARCH ===', 'info');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (addLogEntry !== null) {
        addLogEntry(`✗ Semantic pattern matching failed: ${errorMsg}`, 'error');
        addLogEntry('=== END VECTOR SIMILARITY SEARCH (ERROR) ===', 'error');
      }
    }
  }

  // Try JSON parsing first
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries: Array<[string, unknown]> = Object.entries(parsed);
        
        // Required fields
        const densityEntry = entries.find(([key]) => key === 'buildingDensity');
        const clusteringEntry = entries.find(([key]) => key === 'clustering');
        const grassRatioEntry = entries.find(([key]) => key === 'grassRatio');
        const sizeEntry = entries.find(([key]) => key === 'buildingSizeHint');

        const density = densityEntry && typeof densityEntry[1] === 'string' ? densityEntry[1] : null;
        const clustering = clusteringEntry && typeof clusteringEntry[1] === 'string' ? clusteringEntry[1] : null;
        const grassRatio = grassRatioEntry && typeof grassRatioEntry[1] === 'number' ? grassRatioEntry[1] : null;
        const size = sizeEntry && typeof sizeEntry[1] === 'string' ? sizeEntry[1] : null;

        if (
          density &&
          (density === 'sparse' || density === 'medium' || density === 'dense') &&
          clustering &&
          (clustering === 'clustered' || clustering === 'distributed' || clustering === 'random') &&
          grassRatio !== null &&
          grassRatio >= 0 &&
          grassRatio <= 1 &&
          size &&
          (size === 'small' || size === 'medium' || size === 'large')
        ) {
          result.buildingDensity = density;
          result.clustering = clustering;
          result.grassRatio = grassRatio;
          result.buildingSizeHint = size;

          // Optional extended fields
          const voronoiSeedsEntry = entries.find(([key]) => key === 'voronoiSeeds');
          if (voronoiSeedsEntry && typeof voronoiSeedsEntry[1] === 'object' && voronoiSeedsEntry[1] !== null && !Array.isArray(voronoiSeedsEntry[1])) {
            const seedsEntries: Array<[string, unknown]> = Object.entries(voronoiSeedsEntry[1]);
            const forestEntry = seedsEntries.find(([key]) => key === 'forest');
            const waterEntry = seedsEntries.find(([key]) => key === 'water');
            const grassEntry = seedsEntries.find(([key]) => key === 'grass');
            
            const forest = forestEntry && typeof forestEntry[1] === 'number' ? forestEntry[1] : null;
            const water = waterEntry && typeof waterEntry[1] === 'number' ? waterEntry[1] : null;
            const grass = grassEntry && typeof grassEntry[1] === 'number' ? grassEntry[1] : null;
            
            if (forest !== null && water !== null && grass !== null && forest >= 0 && water >= 0 && grass >= 0) {
              result.voronoiSeeds = { forest, water, grass };
            }
          }

          const roadDensityEntry = entries.find(([key]) => key === 'roadDensity');
          if (roadDensityEntry && typeof roadDensityEntry[1] === 'number') {
            const density = roadDensityEntry[1];
            if (density >= 0 && density <= 1) {
              result.roadDensity = density;
            }
          }

          const ringsEntry = entries.find(([key]) => key === 'rings');
          if (ringsEntry && typeof ringsEntry[1] === 'number') {
            const rings = ringsEntry[1];
            if (rings >= 0 && rings <= 50) {
              // Only set if not already set from prompt extraction
              if (result.rings === undefined) {
                result.rings = rings;
              }
            }
          }
          // Legacy support: also check for maxLayer
          const maxLayerEntry = entries.find(([key]) => key === 'maxLayer');
          if (maxLayerEntry && typeof maxLayerEntry[1] === 'number' && result.rings === undefined) {
            const maxLayer = maxLayerEntry[1];
            if (maxLayer > 0 && maxLayer <= 50) {
              result.rings = maxLayer;
            }
          }

          const buildingRulesEntry = entries.find(([key]) => key === 'buildingRules');
          if (buildingRulesEntry && typeof buildingRulesEntry[1] === 'object' && buildingRulesEntry[1] !== null && !Array.isArray(buildingRulesEntry[1])) {
            const rulesEntries: Array<[string, unknown]> = Object.entries(buildingRulesEntry[1]);
            const buildingRules: BuildingRules = {};
            
            const minAdjacentRoadsEntry = rulesEntries.find(([key]) => key === 'minAdjacentRoads');
            if (minAdjacentRoadsEntry && typeof minAdjacentRoadsEntry[1] === 'number') {
              const minAdjacentRoads = minAdjacentRoadsEntry[1];
              if (minAdjacentRoads >= 0) {
                buildingRules.minAdjacentRoads = minAdjacentRoads;
              }
            }

            const sizeConstraintsEntry = rulesEntries.find(([key]) => key === 'sizeConstraints');
            if (sizeConstraintsEntry && typeof sizeConstraintsEntry[1] === 'object' && sizeConstraintsEntry[1] !== null && !Array.isArray(sizeConstraintsEntry[1])) {
              const sizeEntries: Array<[string, unknown]> = Object.entries(sizeConstraintsEntry[1]);
              const minEntry = sizeEntries.find(([key]) => key === 'min');
              const maxEntry = sizeEntries.find(([key]) => key === 'max');
              
              const min = minEntry && typeof minEntry[1] === 'number' ? minEntry[1] : null;
              const max = maxEntry && typeof maxEntry[1] === 'number' ? maxEntry[1] : null;
              
              if (min !== null && max !== null && min > 0 && max >= min) {
                buildingRules.sizeConstraints = { min, max };
              }
            }

            if (Object.keys(buildingRules).length > 0) {
              result.buildingRules = buildingRules;
            }
          }

          return result;
        }
      }
    }
  } catch {
    // JSON parsing failed, try regex
  }

  // Fallback to regex parsing (only for required fields)
  const densityMatch = output.match(/buildingDensity["\s:]+(sparse|medium|dense)/i);
  const clusteringMatch = output.match(/clustering["\s:]+(clustered|distributed|random)/i);
  const grassRatioMatch = output.match(/grassRatio["\s:]+([\d.]+)/i);
  const sizeMatch = output.match(/buildingSizeHint["\s:]+(small|medium|large)/i);

  if (densityMatch && (densityMatch[1] === 'sparse' || densityMatch[1] === 'medium' || densityMatch[1] === 'dense')) {
    result.buildingDensity = densityMatch[1];
  }
  if (clusteringMatch && (clusteringMatch[1] === 'clustered' || clusteringMatch[1] === 'distributed' || clusteringMatch[1] === 'random')) {
    result.clustering = clusteringMatch[1];
  }
  if (grassRatioMatch) {
    const grassRatio = parseFloat(grassRatioMatch[1]);
    if (!Number.isNaN(grassRatio)) {
      result.grassRatio = Math.max(0, Math.min(1, grassRatio));
    }
  }
  if (sizeMatch && (sizeMatch[1] === 'small' || sizeMatch[1] === 'medium' || sizeMatch[1] === 'large')) {
    result.buildingSizeHint = sizeMatch[1];
  }

  // Result already contains blended constraints from semantic matching
  // Pure cosine similarity - no string matching!

  // Log final parsed constraints summary
  if (addLogEntry !== null) {
    addLogEntry('Parsed constraints summary:', 'info');
    addLogEntry(`  - buildingDensity: ${result.buildingDensity}`, 'info');
    addLogEntry(`  - clustering: ${result.clustering}`, 'info');
    addLogEntry(`  - grassRatio: ${result.grassRatio}`, 'info');
    addLogEntry(`  - buildingSizeHint: ${result.buildingSizeHint}`, 'info');
    if (result.buildingCount !== undefined) {
      addLogEntry(`  - buildingCount: ${result.buildingCount} (specific request)`, 'info');
    }
    if (result.rings !== undefined) {
      addLogEntry(`  - rings: ${result.rings}`, 'info');
    }
    if (result.excludeTileTypes && result.excludeTileTypes.length > 0) {
      addLogEntry(`  - excludeTileTypes: ${result.excludeTileTypes.join(', ')}`, 'info');
    }
    if (result.primaryTileType) {
      addLogEntry(`  - primaryTileType: ${result.primaryTileType}`, 'info');
    }
  }

  return result;
}


/**
 * Extract function arguments from string
 * Handles formats like: forest=5, water=3 or {"forest": 5, "water": 3}
 */
function extractFunctionArguments(argsString: string): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Try JSON format
  try {
    const parsed: unknown = JSON.parse(argsString);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value);
      }
      return result;
    }
  } catch {
    // Not JSON, parse key=value format
  }

  // Parse key="value" or key=value format
  const keyValueRegex = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*([^\s,)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = keyValueRegex.exec(argsString)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Execute a layout function and return updated constraints
 * Functions modify the constraints object that will be used for generation
 */
function executeLayoutFunction(
  functionName: string,
  args: Record<string, string>,
  currentConstraints: LayoutConstraints
): LayoutConstraints {
  if (addLogEntry !== null) {
    addLogEntry(`Executing layout function: ${functionName}(${JSON.stringify(args)})`, 'info');
  }

  const updatedConstraints: LayoutConstraints = { ...currentConstraints };

  if (functionName === 'set_voronoi_seeds') {
    const forestStr = args.forest;
    const waterStr = args.water;
    const grassStr = args.grass;

    if (forestStr && waterStr && grassStr) {
      const forest = Number.parseInt(forestStr, 10);
      const water = Number.parseInt(waterStr, 10);
      const grass = Number.parseInt(grassStr, 10);

      if (!Number.isNaN(forest) && !Number.isNaN(water) && !Number.isNaN(grass) && forest >= 0 && water >= 0 && grass >= 0) {
        updatedConstraints.voronoiSeeds = { forest, water, grass };
        if (addLogEntry !== null) {
          addLogEntry(`Set Voronoi seeds: forest=${forest}, water=${water}, grass=${grass}`, 'success');
        }
      } else {
        if (addLogEntry !== null) {
          addLogEntry(`Invalid Voronoi seed values: forest=${forestStr}, water=${waterStr}, grass=${grassStr}`, 'warning');
        }
      }
    } else {
      if (addLogEntry !== null) {
        addLogEntry(`Missing Voronoi seed parameters. Required: forest, water, grass`, 'warning');
      }
    }
  } else if (functionName === 'set_road_density') {
    const densityStr = args.density;
    if (densityStr) {
      const density = parseFloat(densityStr);
      if (!Number.isNaN(density) && density >= 0 && density <= 1) {
        updatedConstraints.roadDensity = density;
        if (addLogEntry !== null) {
          addLogEntry(`Set road density: ${density}`, 'success');
        }
      } else {
        if (addLogEntry !== null) {
          addLogEntry(`Invalid road density value: ${densityStr}. Must be between 0.0 and 1.0`, 'warning');
        }
      }
    } else {
      if (addLogEntry !== null) {
        addLogEntry(`Missing road density parameter`, 'warning');
      }
    }
  } else if (functionName === 'set_grid_size') {
    const ringsStr = args.rings;
    if (ringsStr) {
      const rings = Number.parseInt(ringsStr, 10);
      if (!Number.isNaN(rings) && rings >= 0 && rings <= 50) {
        updatedConstraints.rings = rings;
        if (addLogEntry !== null) {
          addLogEntry(`Set grid size (rings): ${rings}`, 'success');
        }
      } else {
        if (addLogEntry !== null) {
          addLogEntry(`Invalid rings value: ${ringsStr}. Must be between 0 and 50`, 'warning');
        }
      }
    }
    // Legacy support: also check for maxLayer
    const maxLayerStr = args.maxLayer;
    if (maxLayerStr && updatedConstraints.rings === undefined) {
      const maxLayer = Number.parseInt(maxLayerStr, 10);
      if (!Number.isNaN(maxLayer) && maxLayer > 0 && maxLayer <= 50) {
        updatedConstraints.rings = maxLayer;
        if (addLogEntry !== null) {
          addLogEntry(`Set grid size (maxLayer, legacy): ${maxLayer}`, 'success');
        }
      }
    }
  } else if (functionName === 'set_building_rules') {
    const minAdjacentRoadsStr = args.minAdjacentRoads;
    const minSizeStr = args.minSize;
    const maxSizeStr = args.maxSize;

    const buildingRules: BuildingRules = {};

    if (minAdjacentRoadsStr) {
      const minAdjacentRoads = Number.parseInt(minAdjacentRoadsStr, 10);
      if (!Number.isNaN(minAdjacentRoads) && minAdjacentRoads >= 0) {
        buildingRules.minAdjacentRoads = minAdjacentRoads;
        if (addLogEntry !== null) {
          addLogEntry(`Set building minAdjacentRoads: ${minAdjacentRoads}`, 'info');
        }
      }
    }

    if (minSizeStr && maxSizeStr) {
      const minSize = Number.parseInt(minSizeStr, 10);
      const maxSize = Number.parseInt(maxSizeStr, 10);
      if (!Number.isNaN(minSize) && !Number.isNaN(maxSize) && minSize > 0 && maxSize >= minSize) {
        buildingRules.sizeConstraints = { min: minSize, max: maxSize };
        if (addLogEntry !== null) {
          addLogEntry(`Set building size constraints: min=${minSize}, max=${maxSize}`, 'info');
        }
      }
    }

    if (Object.keys(buildingRules).length > 0) {
      updatedConstraints.buildingRules = buildingRules;
      if (addLogEntry !== null) {
        addLogEntry(`Set building rules: ${JSON.stringify(buildingRules)}`, 'success');
      }
    } else {
      if (addLogEntry !== null) {
        addLogEntry(`No valid building rules provided`, 'warning');
      }
    }
  } else {
    if (addLogEntry !== null) {
      addLogEntry(`Unknown layout function: ${functionName}`, 'warning');
    }
  }

  return updatedConstraints;
}

/**
 * Parse all function calls from output and execute them
 * Returns updated constraints after applying all function calls
 */
function parseAndExecuteFunctionCalls(
  output: string,
  baseConstraints: LayoutConstraints
): LayoutConstraints {
  let currentConstraints = baseConstraints;
  
  // Try to find multiple function calls using regex patterns
  const functionCallPattern = /\[FUNCTION:\s*(\w+)\s*\(([^)]*)\)\]|(?:call|use|execute|set)\s+(\w+)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  const functionCalls: Array<{ function: string; arguments: string }> = [];

  while ((match = functionCallPattern.exec(output)) !== null) {
    const funcName = match[1] || match[4];
    const args = match[2] || match[5];
    if (funcName && args) {
      functionCalls.push({ function: funcName, arguments: args });
    }
  }

  // Also try JSON format for function calls
  try {
    const jsonMatch = output.match(/\{[\s\S]*"function"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries: Array<[string, unknown]> = Object.entries(parsed);
        const funcNameEntry = entries.find(([key]) => key === 'function');
        const argsEntry = entries.find(([key]) => key === 'arguments');
        const funcName = funcNameEntry && typeof funcNameEntry[1] === 'string' ? funcNameEntry[1] : null;
        const args = argsEntry ? argsEntry[1] : null;
        if (funcName && args) {
          functionCalls.push({
            function: funcName,
            arguments: typeof args === 'string' ? args : JSON.stringify(args),
          });
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }

  if (addLogEntry !== null && functionCalls.length > 0) {
    addLogEntry(`Found ${functionCalls.length} function call(s) in output`, 'info');
  }

  // Execute all function calls
  for (const functionCall of functionCalls) {
    const args = extractFunctionArguments(functionCall.arguments);
    currentConstraints = executeLayoutFunction(functionCall.function, args, currentConstraints);
  }

  return currentConstraints;
}

/**
 * Hex grid coordinate type
 */
interface HexCoord {
  q: number;
  r: number;
}

interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

const CUBE_DIRECTIONS: Array<CubeCoord> = [
  { q: +1, r: 0, s: -1 },  // Direction 0
  { q: +1, r: -1, s: 0 },  // Direction 1
  { q: 0, r: -1, s: +1 },  // Direction 2
  { q: -1, r: 0, s: +1 },  // Direction 3
  { q: -1, r: +1, s: 0 },  // Direction 4
  { q: 0, r: +1, s: -1 },  // Direction 5
];

/**
 * Hex grid utility functions
 * Based on Red Blob Games hex grid guide: https://www.redblobgames.com/grids/hexagons/
 */
const HEX_UTILS = {
  /**
   * Convert offset coordinates (col, row) to axial coordinates (q, r)
   * Uses even-r offset layout (offset even rows)
   */
  offsetToAxial(col: number, row: number): HexCoord {
    const q = col;
    const r = row - (col + (col & 1)) / 2;
    return { q, r };
  },

  /**
   * Convert axial coordinates (q, r) to offset coordinates (col, row)
   * Uses even-r offset layout
   */
  axialToOffset(q: number, r: number): { col: number; row: number } {
    const col = q;
    const row = r + (q + (q & 1)) / 2;
    return { col, row };
  },

  /**
   * Get all 6 neighbors of a hex coordinate (axial)
   */
  getNeighbors(q: number, r: number): Array<HexCoord> {
    return [
      { q: q + 1, r },
      { q: q - 1, r },
      { q: q, r: r + 1 },
      { q: q, r: r - 1 },
      { q: q + 1, r: r - 1 },
      { q: q - 1, r: r + 1 },
    ];
  },

  /**
   * Calculate distance between two hex coordinates (axial)
   */
  distance(q1: number, r1: number, q2: number, r2: number): number {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
  },

  /**
   * Convert hex coordinates (axial) to 3D world position
   * Uses pointy-top hex layout
   * 
   * Formula for pointy-top hexagons:
   * - x = size * (√3 * q + √3/2 * r)
   * - z = size * (3/2 * r)
   * 
   * Note: Uses z instead of y for 3D world space (BabylonJS convention)
   * 
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param hexSize - Size of hexagon (distance from center to vertex)
   * @returns World position {x, z} in 3D space
   */
  hexToWorld(q: number, r: number, hexSize: number): { x: number; z: number } {
    hexSize = hexSize / 1.34;
    // For pointy-top hexagons, spacing between centers:
    // Horizontal spacing = sqrt(3) * hexSize
    // Vertical spacing = 3/2 * hexSize
    // The coefficients were half what they should be - doubling them
    const x = hexSize * (Math.sqrt(3) * 2 * q + Math.sqrt(3) * r);
    const z = hexSize * (3 * r);
    return { x, z };
  },

  /**
   * Convert world space coordinates (x, z) to the containing hex coordinate
   * Uses pointy-top hex layout
   * 
   * Algorithm:
   * 1. Convert world coordinates to fractional axial coordinates
   * 2. Convert to fractional cube coordinates
   * 3. Round to nearest integer hex
   * 4. Reset component with largest rounding difference to maintain q + r + s = 0 constraint
   * 
   * @param x - World x coordinate
   * @param z - World z coordinate (BabylonJS uses z instead of y)
   * @param hexSize - Size of hexagon (distance from center to vertex)
   * @returns Hex coordinate {q, r} containing the world point
   */
  worldToHex(x: number, z: number, hexSize: number): HexCoord {
    hexSize = hexSize / 1.34;
    // 1. Convert world coordinates to fractional axial coordinates
    // Inverse of hexToWorld: x = hexSize * sqrt(3) * (2q + r), z = hexSize * 3 * r
    // Solving: r = z / (3 * hexSize), q = (x / (hexSize * sqrt(3)) - r) / 2
    const fracQ = x / (2 * hexSize * Math.sqrt(3)) - z / (6 * hexSize);
    const fracR = z / (3 * hexSize);
    
    // 2. Convert to fractional cube coordinates
    const fracS = -fracQ - fracR;
    
    // 3. Round fractional cube coordinates to the nearest integer hex
    let q = Math.round(fracQ);
    let r = Math.round(fracR);
    let s = Math.round(fracS);
    
    // 4. Calculate rounding differences
    const qDiff = Math.abs(q - fracQ);
    const rDiff = Math.abs(r - fracR);
    const sDiff = Math.abs(s - fracS);
    
    // 5. Reset the component with the largest rounding difference to maintain
    // the q + r + s = 0 constraint
    if (qDiff > rDiff && qDiff > sDiff) {
      q = -r - s;
    } else if (rDiff > sDiff) {
      r = -q - s;
    } else {
      s = -q - r;
    }
    
    // Return as axial coordinates (q, r)
    return { q, r };
  },

  /**
   * Check if offset coordinate is within bounds
   */
  inBounds(col: number, row: number, width: number, height: number): boolean {
    return col >= 0 && col < width && row >= 0 && row < height;
  },

  /**
   * Check if hex coordinate is within hexagonal boundary (distance from center)
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param centerQ - Center q coordinate
   * @param centerR - Center r coordinate
   * @param radius - Maximum distance from center
   */
  inHexBoundary(q: number, r: number, centerQ: number, centerR: number, radius: number): boolean {
    const dist = this.distance(q, r, centerQ, centerR);
    return dist <= radius;
  },

  /**
   * Validate that a cube coordinate satisfies the constraint q + r + s = 0
   * 
   * Cube coordinates must always satisfy this constraint for proper hex grid operations.
   * 
   * @param cube - Cube coordinate to validate
   * @returns True if q + r + s === 0, false otherwise
   */
  validateCubeCoord(cube: CubeCoord): boolean {
    return cube.q + cube.r + cube.s === 0;
  },

  /**
   * Convert axial coordinates to cube coordinates
   * Cube coordinates: (q, r, s) where q + r + s = 0
   * 
   * This conversion automatically ensures the constraint is satisfied.
   */
  axialToCube(q: number, r: number): CubeCoord {
    return { q, r, s: -q - r };
  },

  /**
   * Convert cube coordinates to axial coordinates
   */
  cubeToAxial(cube: CubeCoord): HexCoord {
    return { q: cube.q, r: cube.r };
  },

  /**
   * Calculate cube distance between two cube coordinates
   */
  cubeDistance(a: CubeCoord, b: CubeCoord): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  },

  /**
   * Add two cube coordinates together
   * 
   * Note: The result automatically satisfies q + r + s = 0 if both inputs do,
   * since (a.q + b.q) + (a.r + b.r) + (a.s + b.s) = (a.q + a.r + a.s) + (b.q + b.r + b.s) = 0 + 0 = 0
   */
  cube_add(a: CubeCoord, b: CubeCoord): CubeCoord {
    return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
  },

  /**
   * Scale a cube coordinate by a factor
   * 
   * Note: The result automatically satisfies q + r + s = 0 if the input does,
   * since (factor * q) + (factor * r) + (factor * s) = factor * (q + r + s) = factor * 0 = 0
   */
  cube_scale(hex: CubeCoord, factor: number): CubeCoord {
    return { q: hex.q * factor, r: hex.r * factor, s: hex.s * factor };
  },

  /**
   * Get cube neighbor in specified direction (0-5)
   */
  cubeNeighbor(cube: CubeCoord, direction: number): CubeCoord {
    const dir = CUBE_DIRECTIONS[direction % 6];
    return this.cube_add(cube, dir);
  },

  /**
   * Generate ring of tiles at specific layer (radius) around center
   * Returns all tiles that form a ring at distance 'radius' from center
   * 
   * Corrected implementation: starts at a corner of the target ring and walks
   * along its six sides to trace the perimeter accurately.
   */
  cubeRing(center: CubeCoord, radius: number): Array<CubeCoord> {
    if (radius === 0) {
      return [center];
    }
    
    const results: Array<CubeCoord> = [];
    
    // Start at the first hex of the ring by moving from the center
    // Move 'radius' steps in direction 4 (CUBE_DIRECTIONS[4])
    let currentHex = this.cube_add(center, this.cube_scale(CUBE_DIRECTIONS[4], radius));
    
    // Traverse the six sides of the hexagonal ring
    for (let i = 0; i < 6; i++) {
      // For each side, take 'radius' steps in the current direction
      for (let j = 0; j < radius; j++) {
        results.push({ q: currentHex.q, r: currentHex.r, s: currentHex.s });
        currentHex = this.cubeNeighbor(currentHex, i);
      }
    }
    
    return results;
  },

  /**
   * Generate all tiles in hexagon up to rings
   * Ring 0: 1 tile (center)
   * Ring n: adds 6n tiles
   * Total: 3*rings*(rings+1) + 1 tiles
   * 
   * Uses Set for deduplication and O(1) lookups, then converts to array.
   */
  generateHexGrid(rings: number, centerQ: number, centerR: number): Array<HexCoord> {
    // Use Set with string keys for deduplication and O(1) lookups
    const gridSet = new Set<string>();
    const centerCube = this.axialToCube(centerQ, centerR);
    
    // Generate grid from center outwards, adding one ring at a time
    for (let ring = 0; ring <= rings; ring++) {
      const ringHexes = this.cubeRing(centerCube, ring);
      for (const cube of ringHexes) {
        // Use tuple of coordinates as hashable key for the set
        const key = `${cube.q},${cube.r},${cube.s}`;
        gridSet.add(key);
      }
    }
    
    // Convert set to array of HexCoord
    const grid: Array<HexCoord> = [];
    for (const key of gridSet) {
      const parts = key.split(',');
      if (parts.length === 3) {
        const q = Number.parseInt(parts[0] ?? '0', 10);
        const r = Number.parseInt(parts[1] ?? '0', 10);
        const s = Number.parseInt(parts[2] ?? '0', 10);
        // Verify cube coordinate is valid (q + r + s = 0)
        if (q + r + s === 0) {
          grid.push({ q, r });
        }
      }
    }
    
    // Validate grid size matches expected formula
    const expectedSize = 3 * rings * (rings + 1) + 1;
    if (grid.length !== expectedSize) {
      console.error(`Hexagon grid size mismatch: expected ${expectedSize}, got ${grid.length}`);
    }
    
    return grid;
  },

  /**
   * Check if hex coordinate is part of hexagon pattern (layer-based using cube coordinates)
   * 
   * Hexagonal tile grids form centered hexagonal numbers, where each layer adds a ring
   * around the previous shape. Layer 0 is 1 tile (center), layer 1 adds 6 tiles (total 7),
   * layer 2 adds 12 tiles (total 19), etc. Layer n adds 6n tiles.
   * 
   * Total tiles up to layer n: 3n(n+1) + 1
   * For n=30: 3×30×31 + 1 = 2791 tiles
   * 
   * @param rings - Number of rings (distance from center)
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param centerQ - Center q coordinate
   * @param centerR - Center r coordinate
   * @returns True if hex is within rings distance from center (using cube distance)
   */
  isInHexagonPattern(rings: number, q: number, r: number, centerQ: number, centerR: number): boolean {
    const centerCube = this.axialToCube(centerQ, centerR);
    const tileCube = this.axialToCube(q, r);
    const dist = this.cubeDistance(tileCube, centerCube);
    return dist <= rings;
  },
};

/**
 * Convert tile type to number for WASM
 */
function tileTypeToNumber(tileType: TileType): number {
  switch (tileType.type) {
    case 'grass':
      return 0;
    case 'building':
      return 1;
    case 'road':
      return 2;
    case 'forest':
      return 3;
    case 'water':
      return 4;
  }
}

/**
 * Parse HexCoord array from JSON string
 * Uses Object.getOwnPropertyDescriptor for type-safe property access without casts
 * 
 * @param jsonString - JSON string containing array of HexCoord objects
 * @returns Array of HexCoord or null if parsing fails
 */
function parseHexCoordArray(jsonString: string): Array<HexCoord> | null {
  if (jsonString === 'null' || jsonString === null || jsonString === '[]') {
    return null;
  }
  
  const parsed: unknown = JSON.parse(jsonString);
  if (!Array.isArray(parsed)) {
    return null;
  }
  
  const result: Array<HexCoord> = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    
    // Check for required properties using 'in' operator
    if (!('q' in item) || !('r' in item)) {
      continue;
    }
    
    // Use Object.getOwnPropertyDescriptor to access properties without type casts
    const qDesc = Object.getOwnPropertyDescriptor(item, 'q');
    const rDesc = Object.getOwnPropertyDescriptor(item, 'r');
    
    // Narrow the value types
    if (!qDesc || !rDesc || !('value' in qDesc) || !('value' in rDesc)) {
      continue;
    }
    
    const qValue: unknown = qDesc.value;
    const rValue: unknown = rDesc.value;
    
    if (typeof qValue === 'number' && typeof rValue === 'number') {
      result.push({ q: qValue, r: rValue });
    }
  }
  
  return result.length > 0 ? result : null;
}

/**
 * Hex A* pathfinding for road connectivity validation
 * 
 * Uses WASM implementation when available for better performance.
 * Falls back to TypeScript implementation if WASM is not available.
 * 
 * Uses cube coordinates for distance calculations and explores 6 hex neighbors.
 * Returns path from start to goal, or null if unreachable.
 * 
 * @param start - Start hex coordinate
 * @param goal - Goal hex coordinate
 * @param isValid - Callback function to check if a hex is valid for pathfinding
 * @param hexGrid - Optional hex grid to use for building valid terrain array (for WASM)
 * @returns Path from start to goal, or null if unreachable
 */
export function hexAStar(
  start: HexCoord,
  goal: HexCoord,
  isValid: (q: number, r: number) => boolean,
  hexGrid?: Array<HexCoord>
): Array<HexCoord> | null {
  // Try WASM implementation if available
  if (WASM_BABYLON_CHUNKS.wasmModule && hexGrid) {
    // Build valid terrain array from hexGrid and isValid callback
    const validTerrain: Array<HexCoord> = [];
    for (const hex of hexGrid) {
      if (isValid(hex.q, hex.r)) {
        validTerrain.push(hex);
      }
    }
    
    const validTerrainJson = JSON.stringify(validTerrain);
    const result = WASM_BABYLON_CHUNKS.wasmModule.hex_astar(
      start.q,
      start.r,
      goal.q,
      goal.r,
      validTerrainJson
    );
    
    if (result === 'null' || result === null) {
      return null;
    }
    
    // Parse and validate result using utility function
    return parseHexCoordArray(result);
  }
  
  // Fallback to TypeScript implementation
  interface AStarNode {
    q: number;
    r: number;
    g: number;
    h: number;
    f: number;
    parent: AStarNode | null;
  }

  // Convert axial to cube for distance calculation
  const goalCube = HEX_UTILS.axialToCube(goal.q, goal.r);

  // Calculate hex distance heuristic (cube distance)
  const heuristic = (q: number, r: number): number => {
    const cube = HEX_UTILS.axialToCube(q, r);
    return HEX_UTILS.cubeDistance(cube, goalCube);
  };

  const startNode: AStarNode = {
    q: start.q,
    r: start.r,
    g: 0,
    h: heuristic(start.q, start.r),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;

  const openSet = new Map<string, AStarNode>();
  const closedSet = new Set<string>();
  openSet.set(`${start.q},${start.r}`, startNode);

  while (openSet.size > 0) {
    // Find node with lowest f score
    let current: AStarNode | null = null;
    let currentKey = '';
    let minF = Number.POSITIVE_INFINITY;

    for (const [key, node] of openSet.entries()) {
      if (node.f < minF) {
        minF = node.f;
        current = node;
        currentKey = key;
      }
    }

    if (!current) {
      break;
    }

    // Remove from open set, add to closed set
    openSet.delete(currentKey);
    closedSet.add(currentKey);

    // Check if we reached the goal
    if (current.q === goal.q && current.r === goal.r) {
      // Reconstruct path
      const path: Array<HexCoord> = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift({ q: node.q, r: node.r });
        node = node.parent;
      }
      return path;
    }

    // Explore neighbors
    const neighbors = HEX_UTILS.getNeighbors(current.q, current.r);
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.q},${neighbor.r}`;

      if (closedSet.has(neighborKey)) {
        continue;
      }

      if (!isValid(neighbor.q, neighbor.r)) {
        continue;
      }

      const tentativeG = current.g + 1;
      const existingNode = openSet.get(neighborKey);

      if (!existingNode || tentativeG < existingNode.g) {
        const h = heuristic(neighbor.q, neighbor.r);
        const newNode: AStarNode = {
          q: neighbor.q,
          r: neighbor.r,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
        };
        openSet.set(neighborKey, newNode);
      }
    }
  }

  return null;
}


/**
 * Find the nearest road in the network to a given seed point
 * Returns the hex coordinate of the nearest road
 */
function findNearestRoad(
  seed: HexCoord,
  roadNetwork: Array<HexCoord>
): HexCoord | null {
  if (roadNetwork.length === 0) {
    return null;
  }

  let nearest: HexCoord | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const road of roadNetwork) {
    const distance = HEX_UTILS.distance(seed.q, seed.r, road.q, road.r);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = road;
    }
  }

  return nearest;
}

/**
 * Build a path between two road points using A* pathfinding
 * Returns array of intermediate hexes (excluding start, including end)
 * Returns null if no path found
 * 
 * Uses WASM implementation when available for better performance.
 * 
 * @param start - Start hex coordinate
 * @param end - End hex coordinate
 * @param isValid - Callback function to check if a hex is valid for pathfinding
 * @param hexGrid - Optional hex grid to use for building valid terrain array (for WASM)
 * @returns Path excluding start, including end, or null if no path found
 */
function buildPathBetweenRoads(
  start: HexCoord,
  end: HexCoord,
  isValid: (q: number, r: number) => boolean,
  hexGrid?: Array<HexCoord>
): Array<HexCoord> | null {
  // Try WASM implementation if available
  if (WASM_BABYLON_CHUNKS.wasmModule && hexGrid) {
    // Build valid terrain array from hexGrid and isValid callback
    const validTerrain: Array<HexCoord> = [];
    for (const hex of hexGrid) {
      if (isValid(hex.q, hex.r)) {
        validTerrain.push(hex);
      }
    }
    
    const validTerrainJson = JSON.stringify(validTerrain);
    const result = WASM_BABYLON_CHUNKS.wasmModule.build_path_between_roads(
      start.q,
      start.r,
      end.q,
      end.r,
      validTerrainJson
    );
    
    if (result === 'null' || result === null) {
      return null;
    }
    
    // Parse and validate result using utility function
    return parseHexCoordArray(result);
  }
  
  // Fallback to TypeScript implementation
  const path = hexAStar(start, end, isValid, hexGrid);
  if (!path || path.length === 0) {
    return null;
  }
  // Return path excluding start (we already have it), including end
  return path.slice(1);
}

/**
 * Get all valid terrain hexes adjacent to existing roads
 * Returns array of hex coordinates that are:
 * - Adjacent to at least one road in the network
 * - On valid terrain (grass/forest)
 * - Not already occupied
 */
function getAdjacentValidTerrain(
  roadNetwork: Array<HexCoord>,
  validTerrainHexes: Array<HexCoord>,
  occupiedHexes: Set<string>
): Array<HexCoord> {
  const roadSet = new Set<string>();
  for (const road of roadNetwork) {
    roadSet.add(`${road.q},${road.r}`);
  }

  const adjacentHexes: Array<HexCoord> = [];
  const adjacentSet = new Set<string>();

  // For each road, find its neighbors
  for (const road of roadNetwork) {
    const neighbors = HEX_UTILS.getNeighbors(road.q, road.r);
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.q},${neighbor.r}`;
      
      // Skip if already a road or already added to adjacent list
      if (roadSet.has(neighborKey) || adjacentSet.has(neighborKey)) {
        continue;
      }

      // Skip if occupied
      if (occupiedHexes.has(neighborKey)) {
        continue;
      }

      // Check if this neighbor is in valid terrain
      const isValidTerrain = validTerrainHexes.some(
        (hex) => hex.q === neighbor.q && hex.r === neighbor.r
      );

      if (isValidTerrain) {
        adjacentHexes.push(neighbor);
        adjacentSet.add(neighborKey);
      }
    }
  }

  return adjacentHexes;
}

/**
 * Convert layout constraints to pre-constraints
 * 
 * Simplified version: Sets tile types for all hexagon tiles using hash map storage.
 * No bounds checking needed - all hexagon tiles are stored.
 * 
 * Now includes:
 * - Voronoi region priors for forest, water, and grass
 * - Road connectivity validation
 * - Road and building placement restricted to grass/forest (not water)
 * - Buildings must be adjacent to at least one road
 */
function constraintsToPreConstraints(
  constraints: LayoutConstraints
): Array<{ q: number; r: number; tileType: TileType }> {
  if (!WASM_BABYLON_CHUNKS.wasmModule) {
    if (addLogEntry !== null) {
      addLogEntry('WASM module not available for Voronoi generation', 'error');
    }
    return [];
  }

  // Use hexagon pattern - use rings from constraints or default to currentRings (default 5)
  const rings = constraints.rings ?? currentRings;
  // Update global currentRings for rendering
  currentRings = rings;
  
  if (addLogEntry !== null) {
    addLogEntry(`Using rings: ${rings} (expected tiles: ${3 * rings * (rings + 1) + 1})`, 'info');
  }
  
  // Center at (0, 0) for simplicity - hexagon centered at origin
  const centerQ = 0;
  const centerR = 0;

  // Generate hexagon grid for reference
  const hexGrid = HEX_UTILS.generateHexGrid(rings, centerQ, centerR);
  const totalTiles = hexGrid.length;
  const expectedTiles = 3 * rings * (rings + 1) + 1;

  if (addLogEntry !== null) {
    addLogEntry(`Hexagon Grid Generation: Generated ${hexGrid.length} tiles (expected: ${expectedTiles} for ${rings} rings)`, 'info');
  }

  // Step 1: Generate Voronoi regions for forest, water, and grass using WASM
  // Use voronoiSeeds from constraints or default values
  const baseVoronoiSeeds = constraints.voronoiSeeds ?? { forest: 4, water: 3, grass: 6 };
  
  // Create a copy to modify
  const voronoiSeeds = {
    forest: baseVoronoiSeeds.forest,
    water: baseVoronoiSeeds.water,
    grass: baseVoronoiSeeds.grass,
  };
  
  // Apply exclusions - set excluded tile type seeds to 0
  const excludeTypes = constraints.excludeTileTypes ?? [];
  if (excludeTypes.includes('forest')) {
    voronoiSeeds.forest = 0;
    if (addLogEntry !== null) {
      addLogEntry('Excluding forest: setting forest seeds to 0', 'info');
    }
  }
  if (excludeTypes.includes('water')) {
    voronoiSeeds.water = 0;
    if (addLogEntry !== null) {
      addLogEntry('Excluding water: setting water seeds to 0', 'info');
    }
  }
  if (excludeTypes.includes('grass')) {
    voronoiSeeds.grass = 0;
    if (addLogEntry !== null) {
      addLogEntry('Excluding grass: setting grass seeds to 0', 'info');
    }
  }

  // Apply primary tile type - increase seeds for primary type, decrease others
  const primaryTileType = constraints.primaryTileType;
  if (primaryTileType) {
    if (addLogEntry !== null) {
      addLogEntry(`Primary tile type: ${primaryTileType} - adjusting Voronoi seeds`, 'info');
    }
    // Increase primary type seeds, decrease others proportionally
    if (primaryTileType === 'forest') {
      voronoiSeeds.forest = Math.max(8, voronoiSeeds.forest * 2);
      voronoiSeeds.water = Math.max(1, Math.floor(voronoiSeeds.water * 0.5));
      voronoiSeeds.grass = Math.max(2, Math.floor(voronoiSeeds.grass * 0.5));
    } else if (primaryTileType === 'water') {
      voronoiSeeds.water = Math.max(6, voronoiSeeds.water * 2);
      voronoiSeeds.forest = Math.max(1, Math.floor(voronoiSeeds.forest * 0.5));
      voronoiSeeds.grass = Math.max(2, Math.floor(voronoiSeeds.grass * 0.5));
    } else if (primaryTileType === 'grass') {
      voronoiSeeds.grass = Math.max(10, voronoiSeeds.grass * 2);
      voronoiSeeds.forest = Math.max(1, Math.floor(voronoiSeeds.forest * 0.5));
      voronoiSeeds.water = Math.max(1, Math.floor(voronoiSeeds.water * 0.5));
    }
    if (addLogEntry !== null) {
      addLogEntry(`Adjusted seeds: forest=${voronoiSeeds.forest}, water=${voronoiSeeds.water}, grass=${voronoiSeeds.grass}`, 'info');
    }
  }

  const forestSeeds = voronoiSeeds.forest;
  const waterSeeds = voronoiSeeds.water;
  const grassSeeds = voronoiSeeds.grass;

  if (addLogEntry !== null) {
    addLogEntry(`Generating Voronoi regions: ${forestSeeds} forest, ${waterSeeds} water, ${grassSeeds} grass seeds`, 'info');
  }

  // Call WASM function with error handling
  let voronoiJson: string;
  try {
    const result = WASM_BABYLON_CHUNKS.wasmModule.generate_voronoi_regions(
      rings,
      centerQ,
      centerR,
      forestSeeds,
      waterSeeds,
      grassSeeds
    );
    
    // Log the actual result type and value for debugging
    if (addLogEntry !== null) {
      addLogEntry(`WASM generate_voronoi_regions returned: type=${typeof result}, value=${String(result).substring(0, 100)}`, 'info');
    }
    
    voronoiJson = typeof result === 'string' ? result : '[]';
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Error calling generate_voronoi_regions: ${errorMsg}`, 'error');
      if (error instanceof Error && error.stack) {
        addLogEntry(`Stack: ${error.stack}`, 'error');
      }
    }
    voronoiJson = '[]';
  }

  // Debug: Log raw JSON for troubleshooting
  if (addLogEntry !== null) {
    const jsonPreview = voronoiJson.length > 200 ? `${voronoiJson.substring(0, 200)}...` : voronoiJson;
    addLogEntry(`Voronoi JSON length: ${voronoiJson.length}, preview: ${jsonPreview}`, 'info');
  }

  // Parse Voronoi regions from JSON
  const voronoiConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  try {
    const parsed: unknown = JSON.parse(voronoiJson);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          // Use direct property access with proper type narrowing
          // Check if properties exist and have correct types
          if ('q' in item && 'r' in item && 'tileType' in item) {
            // Access properties using Object.getOwnPropertyDescriptor for type safety
            const qDesc = Object.getOwnPropertyDescriptor(item, 'q');
            const rDesc = Object.getOwnPropertyDescriptor(item, 'r');
            const tileTypeDesc = Object.getOwnPropertyDescriptor(item, 'tileType');
            
            if (qDesc && 'value' in qDesc && rDesc && 'value' in rDesc && tileTypeDesc && 'value' in tileTypeDesc) {
              // TypeScript needs explicit type checks before assignment
              const qValueUnknown: unknown = qDesc.value;
              const rValueUnknown: unknown = rDesc.value;
              const tileTypeValueUnknown: unknown = tileTypeDesc.value;

              if (
                typeof qValueUnknown === 'number' &&
                typeof rValueUnknown === 'number' &&
                typeof tileTypeValueUnknown === 'number'
              ) {
                // Now we know they're numbers, safe to use
                const qValue: number = qValueUnknown;
                const rValue: number = rValueUnknown;
                const tileTypeValue: number = tileTypeValueUnknown;
                
                const tileType = tileTypeFromNumber(tileTypeValue);
                if (tileType) {
                  voronoiConstraints.push({ q: qValue, r: rValue, tileType });
                }
              }
            }
          }
        }
      }
    } else {
      if (addLogEntry !== null) {
        addLogEntry(`Voronoi JSON is not an array. Type: ${typeof parsed}`, 'warning');
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to parse Voronoi regions: ${errorMsg}. JSON: ${voronoiJson.substring(0, 500)}`, 'warning');
    }
  }

  if (addLogEntry !== null) {
    const forestCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'forest').length;
    const waterCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'water').length;
    const grassCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'grass').length;
    addLogEntry(`Voronoi regions: ${forestCount} forest, ${waterCount} water, ${grassCount} grass`, 'info');
    
    // Warn if regions are empty but seeds were requested
    if (forestCount === 0 && waterCount === 0 && grassCount === 0 && (forestSeeds > 0 || waterSeeds > 0 || grassSeeds > 0)) {
      addLogEntry(`Warning: No Voronoi regions generated despite requesting ${forestSeeds} forest, ${waterSeeds} water, ${grassSeeds} grass seeds`, 'warning');
    }
  }

  // Step 2: Create a set of occupied hexes from Voronoi regions
  // Only water tiles are considered "occupied" - grass and forest can be overridden by roads/buildings
  const occupiedHexes = new Set<string>();
  for (const constraint of voronoiConstraints) {
    if (constraint.tileType.type === 'water') {
      occupiedHexes.add(`${constraint.q},${constraint.r}`);
    }
  }

  if (addLogEntry !== null) {
    const waterCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'water').length;
    addLogEntry(`Occupied hexes (water only): ${occupiedHexes.size} (${waterCount} water tiles)`, 'info');
  }

  // Step 3: Generate roads on valid terrain (grass/forest only) using growing tree algorithm
  // This ensures all roads form a single connected component
  const roadConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];

  // Get valid terrain hexes (grass/forest only, not water)
  const validTerrainHexes: Array<HexCoord> = [];
  const voronoiMap = new Map<string, TileType>();
  for (const constraint of voronoiConstraints) {
    voronoiMap.set(`${constraint.q},${constraint.r}`, constraint.tileType);
  }
  for (const hex of hexGrid) {
    const tileType = voronoiMap.get(`${hex.q},${hex.r}`);
    if (tileType && (tileType.type === 'grass' || tileType.type === 'forest')) {
      validTerrainHexes.push(hex);
    }
  }

  if (addLogEntry !== null) {
    addLogEntry(`Valid terrain for roads/buildings: ${validTerrainHexes.length} hexes (grass/forest only)`, 'info');
  }

  // Calculate target road count using roadDensity from constraints or default 0.1 (10%)
  const roadDensity = constraints.roadDensity ?? 0.1;
  const targetRoadCount = Math.floor(validTerrainHexes.length * roadDensity);
  
  if (addLogEntry !== null) {
    addLogEntry(`Road generation: density=${roadDensity} (${Math.floor(roadDensity * 100)}%), target count=${targetRoadCount}`, 'info');
  }

  // Create set of valid terrain for A* pathfinding
  const validTerrainSet = new Set<string>();
  for (const hex of validTerrainHexes) {
    validTerrainSet.add(`${hex.q},${hex.r}`);
  }

  // Helper function to check if a hex is valid for road placement
  const isValidForRoad = (q: number, r: number): boolean => {
    const hexKey = `${q},${r}`;
    return validTerrainSet.has(hexKey) && !occupiedHexes.has(hexKey);
  };

  // Step 3a: Select seed points (20-30% of target road count, distributed across terrain)
  const seedCount = Math.max(1, Math.floor(targetRoadCount * 0.25));
  const availableForSeeds: Array<HexCoord> = [];
  for (const hex of validTerrainHexes) {
    const hexKey = `${hex.q},${hex.r}`;
    if (!occupiedHexes.has(hexKey)) {
      availableForSeeds.push(hex);
    }
  }

  // Shuffle and select seed points
  for (let i = availableForSeeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = availableForSeeds[i];
    if (temp && availableForSeeds[j]) {
      availableForSeeds[i] = availableForSeeds[j];
      availableForSeeds[j] = temp;
    }
  }

  const seedPoints = availableForSeeds.slice(0, Math.min(seedCount, availableForSeeds.length));

  if (addLogEntry !== null) {
    addLogEntry(`Selected ${seedPoints.length} seed points for road network`, 'info');
  }

  // Step 3b & 3c: Generate road network using true growing tree algorithm (WASM)
  // This replaces the previous flood-fill approach with a proper tree algorithm:
  // 1. Connects seed points using A* paths
  // 2. Expands by finding nearest unconnected valid terrain to any connected road,
  //    building A* path, and adding path. Continues until target count reached.
  let roadNetwork: Array<HexCoord> = [];
  
  if (WASM_BABYLON_CHUNKS.wasmModule) {
    // Prepare inputs for WASM function
    const seedsJson = JSON.stringify(seedPoints);
    const validTerrainJson = JSON.stringify(validTerrainHexes);
    const occupiedArray: Array<HexCoord> = [];
    for (const key of occupiedHexes) {
      const parts = key.split(',');
      if (parts.length === 2) {
        const q = Number.parseInt(parts[0] ?? '0', 10);
        const r = Number.parseInt(parts[1] ?? '0', 10);
        if (!Number.isNaN(q) && !Number.isNaN(r)) {
          occupiedArray.push({ q, r });
        }
      }
    }
    const occupiedJson = JSON.stringify(occupiedArray);
    
    if (addLogEntry !== null) {
      addLogEntry(`Generating road network using WASM growing tree algorithm...`, 'info');
    }
    
    const result = WASM_BABYLON_CHUNKS.wasmModule.generate_road_network_growing_tree(
      seedsJson,
      validTerrainJson,
      occupiedJson,
      targetRoadCount
    );
    
    // Parse and validate result using utility function
    const parsedRoads = parseHexCoordArray(result);
    if (parsedRoads) {
      roadNetwork = parsedRoads;
      
      // Update occupiedHexes with generated roads
      for (const road of roadNetwork) {
        occupiedHexes.add(`${road.q},${road.r}`);
      }
      
      if (addLogEntry !== null) {
        addLogEntry(`Generated ${roadNetwork.length} roads using WASM growing tree algorithm`, 'info');
      }
    } else {
      if (addLogEntry !== null) {
        addLogEntry(`WASM growing tree returned invalid result, falling back to TypeScript implementation`, 'warning');
      }
      // Fall through to TypeScript fallback
      roadNetwork = [];
    }
  }
  
  // TypeScript fallback (should rarely be needed)
  if (roadNetwork.length === 0) {
    if (addLogEntry !== null) {
      if (WASM_BABYLON_CHUNKS.wasmModule) {
        addLogEntry(`Using TypeScript fallback for road generation (WASM returned empty result)`, 'info');
      } else {
        addLogEntry(`Using TypeScript fallback for road generation (WASM not available)`, 'info');
      }
    }
    
    // Start with first seed point
    if (seedPoints.length > 0) {
      const firstSeed = seedPoints[0];
      if (firstSeed) {
        roadNetwork.push(firstSeed);
        occupiedHexes.add(`${firstSeed.q},${firstSeed.r}`);
      }
    }

    // Connect remaining seed points to the network
    for (let i = 1; i < seedPoints.length; i++) {
      const seed = seedPoints[i];
      if (!seed) {
        continue;
      }

      // Find nearest road in current network
      const nearestRoad = findNearestRoad(seed, roadNetwork);
      if (!nearestRoad) {
        // Shouldn't happen, but add seed directly if no network exists
        roadNetwork.push(seed);
        occupiedHexes.add(`${seed.q},${seed.r}`);
        continue;
      }

      // Build path from nearest road to seed
      const path = buildPathBetweenRoads(nearestRoad, seed, isValidForRoad, hexGrid);
      if (path && path.length > 0) {
        // Add all hexes along the path to the network
        for (const pathHex of path) {
          const pathKey = `${pathHex.q},${pathHex.r}`;
          if (!occupiedHexes.has(pathKey)) {
            roadNetwork.push(pathHex);
            occupiedHexes.add(pathKey);
          }
        }
        // Add the seed itself (end of path) if not already added
        const seedKey = `${seed.q},${seed.r}`;
        if (!occupiedHexes.has(seedKey)) {
          roadNetwork.push(seed);
          occupiedHexes.add(seedKey);
        }
      } else {
        // If no path found, skip this seed to maintain connectivity
        if (addLogEntry !== null) {
          addLogEntry(`Skipping seed at (${seed.q}, ${seed.r}) - no path found to network`, 'warning');
        }
      }
    }

    // Expand network to reach target density (flood fill approach for fallback)
    while (roadNetwork.length < targetRoadCount) {
      const adjacentHexes = getAdjacentValidTerrain(roadNetwork, validTerrainHexes, occupiedHexes);
      
      if (adjacentHexes.length === 0) {
        if (addLogEntry !== null) {
          addLogEntry(`No more adjacent valid terrain, stopping road expansion at ${roadNetwork.length} roads`, 'info');
        }
        break;
      }

      // Shuffle adjacent hexes for random selection
      for (let i = adjacentHexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = adjacentHexes[i];
        if (temp && adjacentHexes[j]) {
          adjacentHexes[i] = adjacentHexes[j];
          adjacentHexes[j] = temp;
        }
      }

      // Add first available adjacent hex
      const newRoad = adjacentHexes[0];
      if (newRoad) {
        roadNetwork.push(newRoad);
        occupiedHexes.add(`${newRoad.q},${newRoad.r}`);
      } else {
        break;
      }
    }
  }

  // Convert road network to constraints
  for (const road of roadNetwork) {
    roadConstraints.push({ q: road.q, r: road.r, tileType: { type: 'road' } });
  }

  // Validate road connectivity (should always pass with growing tree algorithm)
  const roadsJson = JSON.stringify(roadConstraints.map((rc) => ({ q: rc.q, r: rc.r })));
  if (addLogEntry !== null) {
    addLogEntry(`Validating ${roadConstraints.length} roads for connectivity...`, 'info');
  }
  let roadsConnected = false;
  if (WASM_BABYLON_CHUNKS.wasmModule) {
    roadsConnected = WASM_BABYLON_CHUNKS.wasmModule.validate_road_connectivity(roadsJson);
    if (addLogEntry !== null) {
      if (roadsConnected) {
        addLogEntry(`Road connectivity validation PASSED: All ${roadConstraints.length} roads are connected`, 'success');
      } else {
        addLogEntry(`Road connectivity validation FAILED: This should not happen with growing tree algorithm!`, 'error');
      }
    }
  } else {
    if (addLogEntry !== null) {
      addLogEntry('WASM module not available for road connectivity validation', 'error');
    }
  }

  if (addLogEntry !== null) {
    addLogEntry(`Placed ${roadConstraints.length} roads (target: ${targetRoadCount}) using growing tree algorithm`, 'info');
  }

  // Step 4: Generate buildings on valid terrain (grass/forest only) adjacent to roads
  const buildingConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  const availableBuildingHexes: Array<HexCoord> = [];

  // Get building rules from constraints
  const buildingRules = constraints.buildingRules;
  const minAdjacentRoads = buildingRules?.minAdjacentRoads ?? 1;

  // Helper function to count adjacent roads
  const countAdjacentRoads = (q: number, r: number): number => {
    const neighbors = HEX_UTILS.getNeighbors(q, r);
    let count = 0;
    for (const neighbor of neighbors) {
      if (roadConstraints.some((rc) => rc.q === neighbor.q && rc.r === neighbor.r)) {
        count += 1;
      }
    }
    return count;
  };

  // Find available hexes for buildings (only on valid terrain, not already occupied, adjacent to roads)
  for (const hex of validTerrainHexes) {
    const hexKey = `${hex.q},${hex.r}`;
    if (!occupiedHexes.has(hexKey)) {
      const adjacentRoadCount = countAdjacentRoads(hex.q, hex.r);
      if (adjacentRoadCount >= minAdjacentRoads) {
        availableBuildingHexes.push(hex);
      }
    }
  }

  if (addLogEntry !== null) {
    addLogEntry(`Available building locations (adjacent to ${minAdjacentRoads}+ roads): ${availableBuildingHexes.length} hexes`, 'info');
  }

  // Shuffle available building hexes for random placement
  for (let i = availableBuildingHexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = availableBuildingHexes[i];
    if (temp && availableBuildingHexes[j]) {
      availableBuildingHexes[i] = availableBuildingHexes[j];
      availableBuildingHexes[j] = temp;
    }
  }

  // Place buildings - use exact count if specified, otherwise use density-based calculation
  let targetBuildingCount: number;
  if (constraints.buildingCount !== undefined) {
    targetBuildingCount = constraints.buildingCount;
    if (addLogEntry !== null) {
      addLogEntry(`Using exact building count: ${targetBuildingCount} (from user request)`, 'info');
    }
  } else {
    const buildingDensity = constraints.buildingDensity;
    let buildingRatio = 0.1;
    if (buildingDensity === 'sparse') {
      buildingRatio = 0.05;
    } else if (buildingDensity === 'dense') {
      buildingRatio = 0.15;
    }
    targetBuildingCount = Math.floor(availableBuildingHexes.length * buildingRatio);
    if (addLogEntry !== null) {
      addLogEntry(`Using density-based building count: ${targetBuildingCount} (${Math.floor(buildingRatio * 100)}% of ${availableBuildingHexes.length} available)`, 'info');
    }
  }

  // Limit to available hexes
  const buildingCount = Math.min(targetBuildingCount, availableBuildingHexes.length);
  let placedBuildings = 0;
  for (let i = 0; i < buildingCount && i < availableBuildingHexes.length; i++) {
    const hex = availableBuildingHexes[i];
    if (hex) {
      // Double-check adjacency (in case roads changed during retries)
      const roadSet = new Set<string>();
      for (const road of roadConstraints) {
        roadSet.add(`${road.q},${road.r}`);
      }
      const neighbors = HEX_UTILS.getNeighbors(hex.q, hex.r);
      const isAdjacent = neighbors.some((neighbor) => roadSet.has(`${neighbor.q},${neighbor.r}`));
      if (isAdjacent) {
        buildingConstraints.push({ q: hex.q, r: hex.r, tileType: { type: 'building' } });
        occupiedHexes.add(`${hex.q},${hex.r}`);
        placedBuildings += 1;
      }
    }
  }

  if (addLogEntry !== null) {
    addLogEntry(`Placed ${placedBuildings} buildings (${buildingCount} attempted, ${availableBuildingHexes.length} available)`, 'info');
  }

  // Step 5: Fill remaining tiles with grass
  const allConstraints = [...voronoiConstraints, ...buildingConstraints, ...roadConstraints];
  const finalOccupied = new Set<string>();
  for (const constraint of allConstraints) {
    finalOccupied.add(`${constraint.q},${constraint.r}`);
  }

  const grassConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  for (const hex of hexGrid) {
    const hexKey = `${hex.q},${hex.r}`;
    if (!finalOccupied.has(hexKey)) {
      grassConstraints.push({ q: hex.q, r: hex.r, tileType: { type: 'grass' } });
    }
  }

  // Combine all constraints
  const preConstraints = [...voronoiConstraints, ...buildingConstraints, ...roadConstraints, ...grassConstraints];

  // Debug: Log final pre-constraints count
  if (addLogEntry !== null) {
    const grassCount = preConstraints.filter((pc) => pc.tileType.type === 'grass').length;
    const buildingCount = preConstraints.filter((pc) => pc.tileType.type === 'building').length;
    const roadCount = preConstraints.filter((pc) => pc.tileType.type === 'road').length;
    const forestCount = preConstraints.filter((pc) => pc.tileType.type === 'forest').length;
    const waterCount = preConstraints.filter((pc) => pc.tileType.type === 'water').length;
    addLogEntry(`Pre-Constraints: ${preConstraints.length} total (${grassCount} grass, ${buildingCount} building, ${roadCount} road, ${forestCount} forest, ${waterCount} water)`, 'info');
    addLogEntry(`Pre-Constraints: Expected ${totalTiles} hexagon tiles, got ${preConstraints.length} pre-constraints`, 'info');
  }

  return preConstraints;
}

/**
 * Show thinking animation on layout generation container
 */
async function showThinkingAnimation(): Promise<void> {
  const containerEl = document.getElementById('layoutGenerationContainer');
  if (containerEl instanceof HTMLElement) {
    containerEl.classList.add('thinking');
    // Force browser repaint by reading a layout property
    void containerEl.offsetHeight;
    
    // Wait for two animation frames to ensure browser paints the change
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    
    if (addLogEntry !== null) {
      const timestamp = new Date().toLocaleTimeString();
      addLogEntry(`[${timestamp}] Started thinking animation`, 'info');
    }
  }
}

/**
 * Hide thinking animation on layout generation container
 */
function hideThinkingAnimation(): void {
  const containerEl = document.getElementById('layoutGenerationContainer');
  if (containerEl instanceof HTMLElement) {
    containerEl.classList.remove('thinking');
    if (addLogEntry !== null) {
      const timestamp = new Date().toLocaleTimeString();
      addLogEntry(`[${timestamp}] Finished thinking animation`, 'info');
    }
  }
}

/**
 * Generate layout from text prompt
 */
async function generateLayoutFromText(
  prompt: string,
  renderGrid: (constraints?: LayoutConstraints) => void,
  errorEl: HTMLElement | null,
  modelStatusEl: HTMLElement | null
): Promise<void> {
  if (!WASM_BABYLON_CHUNKS.wasmModule) {
    if (errorEl) {
      errorEl.textContent = 'WASM module not loaded';
    }
    return;
  }

  // Track when thinking animation was shown for minimum display time
  const thinkingStartTime = Date.now();
  const minDisplayTime = 2000; // 2 seconds minimum

  // Store the prompt for later comparison with stats
  lastUserPrompt = prompt;

  try {
    // Show thinking animation immediately
    await showThinkingAnimation();

    if (addLogEntry !== null) {
      addLogEntry(`Starting layout generation from text prompt: "${prompt}"`, 'info');
    }
    if (modelStatusEl) {
      modelStatusEl.textContent = 'Loading Qwen model...';
    }

    if (addLogEntry !== null) {
      addLogEntry('Loading Qwen text generation model...', 'info');
    }

    await loadQwenModel((progress) => {
      if (modelStatusEl) {
        modelStatusEl.textContent = `Loading model: ${Math.floor(progress * 100)}%`;
      }
      if (addLogEntry !== null && Math.floor(progress * 100) % 25 === 0) {
        addLogEntry(`Model loading progress: ${Math.floor(progress * 100)}%`, 'info');
      }
    });

    if (addLogEntry !== null) {
      addLogEntry('Qwen model loaded successfully', 'success');
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Generating 3D grid layout...';
    }

    if (addLogEntry !== null) {
      addLogEntry('Sending prompt to Qwen model for layout description generation...', 'info');
    }

    const layoutDescription = await generateLayoutDescription(prompt);

    if (addLogEntry !== null) {
      addLogEntry(`Received layout description from Qwen (${layoutDescription.length} characters)`, 'info');
      addLogEntry(`Raw layout description: ${layoutDescription.substring(0, 200)}${layoutDescription.length > 200 ? '...' : ''}`, 'info');
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Parsing constraints...';
    }

    if (addLogEntry !== null) {
      addLogEntry('Parsing layout constraints from Qwen output...', 'info');
    }

    // Parse base constraints from JSON output, also extracting from original prompt
    let constraints = await parseLayoutConstraints(layoutDescription, prompt);

    if (addLogEntry !== null) {
      addLogEntry(`Parsed base constraints: buildingDensity=${constraints.buildingDensity}, clustering=${constraints.clustering}, grassRatio=${constraints.grassRatio}, buildingSizeHint=${constraints.buildingSizeHint}`, 'info');
    }

    // Check for function calls and execute them
    if (addLogEntry !== null) {
      addLogEntry('Checking for function calls in output...', 'info');
    }
    constraints = parseAndExecuteFunctionCalls(layoutDescription, constraints);

    if (addLogEntry !== null) {
      addLogEntry('Final constraint summary:', 'info');
      addLogEntry(`  - buildingDensity: ${constraints.buildingDensity}`, 'info');
      addLogEntry(`  - clustering: ${constraints.clustering}`, 'info');
      addLogEntry(`  - grassRatio: ${constraints.grassRatio}`, 'info');
      addLogEntry(`  - buildingSizeHint: ${constraints.buildingSizeHint}`, 'info');
      if (constraints.voronoiSeeds) {
        addLogEntry(`  - voronoiSeeds: forest=${constraints.voronoiSeeds.forest}, water=${constraints.voronoiSeeds.water}, grass=${constraints.voronoiSeeds.grass}`, 'info');
      }
      if (constraints.roadDensity !== undefined) {
        addLogEntry(`  - roadDensity: ${constraints.roadDensity} (${Math.floor(constraints.roadDensity * 100)}%)`, 'info');
      }
      if (constraints.rings !== undefined) {
        addLogEntry(`  - rings: ${constraints.rings}`, 'info');
      }
      if (constraints.buildingRules) {
        addLogEntry(`  - buildingRules: ${JSON.stringify(constraints.buildingRules)}`, 'info');
      }
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Applying constraints...';
    }

    if (addLogEntry !== null) {
      addLogEntry('Clearing existing pre-constraints...', 'info');
    }

    WASM_BABYLON_CHUNKS.wasmModule.clear_pre_constraints();

    if (addLogEntry !== null) {
      addLogEntry('Converting constraints to pre-constraints...', 'info');
    }

    const preConstraints = constraintsToPreConstraints(constraints);

    if (addLogEntry !== null) {
      addLogEntry(`Generated ${preConstraints.length} pre-constraints, setting them in WASM...`, 'info');
    }

    // Set pre-constraints using hex coordinates directly (no conversion needed)
    let setCount = 0;
    for (const preConstraint of preConstraints) {
      const tileNum = tileTypeToNumber(preConstraint.tileType);
      const success = WASM_BABYLON_CHUNKS.wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
      if (success) {
        setCount += 1;
      }
    }

    if (addLogEntry !== null) {
      addLogEntry(`Successfully set ${setCount} pre-constraints in WASM`, 'success');
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Generating layout...';
    }

    if (addLogEntry !== null) {
      addLogEntry('Calling WASM generate_layout() to apply WFC algorithm...', 'info');
    }

    WASM_BABYLON_CHUNKS.wasmModule.generate_layout();

    if (addLogEntry !== null) {
      addLogEntry('WFC layout generation completed', 'success');
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Rendering...';
    }

    if (addLogEntry !== null) {
      addLogEntry('Rendering 3D grid visualization...', 'info');
    }

    renderGrid(constraints);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Ready';
    }

    if (addLogEntry !== null) {
      addLogEntry('Layout generation and rendering completed successfully', 'success');
    }

    // Hide thinking animation with minimum display time
    const elapsed = Date.now() - thinkingStartTime;
    const remainingTime = elapsed < minDisplayTime ? minDisplayTime - elapsed : 0;
    
    if (remainingTime > 0) {
      // Use requestAnimationFrame to wait for remaining time
      const targetFrames = Math.ceil(remainingTime / 16); // ~60fps = ~16ms per frame
      let frameCount = 0;
      const delayFrames = (): void => {
        frameCount++;
        if (frameCount < targetFrames) {
          requestAnimationFrame(delayFrames);
        } else {
          hideThinkingAnimation();
        }
      };
      requestAnimationFrame(delayFrames);
    } else {
      requestAnimationFrame(() => {
        hideThinkingAnimation();
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Error during layout generation: ${errorMsg}`, 'error');
      if (error instanceof Error && error.stack) {
        addLogEntry(`Stack trace: ${error.stack}`, 'error');
      }
    }
    if (errorEl) {
      errorEl.textContent = `Error generating layout: ${errorMsg}`;
    }
    if (modelStatusEl) {
      modelStatusEl.textContent = 'Error';
    }
    hideThinkingAnimation();
  }
}

/**
 * Initialize the babylon-chunks route
 */
export const init = async (): Promise<void> => {
  const errorEl = document.getElementById('error');
  const canvasEl = document.getElementById('renderCanvas');
  const systemLogsContentEl = document.getElementById('systemLogsContent');
  
  if (!canvasEl) {
    throw new Error('renderCanvas element not found');
  }
  
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('renderCanvas element is not an HTMLCanvasElement');
  }
  
  const canvas = canvasEl;
  
  // Prevent wheel events from scrolling the page when over canvas
  // CSS overscroll-behavior doesn't work for wheel events, need JavaScript
  canvas.addEventListener('wheel', (event) => {
    // Only prevent if the event is actually on the canvas
    if (event.target === canvas) {
      event.preventDefault();
    }
  }, { passive: false });
  
  // Setup logging
  if (systemLogsContentEl) {
    addLogEntry = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.textContent = `[${timestamp}] ${message}`;
      systemLogsContentEl.appendChild(logEntry);
      systemLogsContentEl.scrollTop = systemLogsContentEl.scrollHeight;
    };
  }

  // Initialize pattern cache in background (non-blocking)
  void initializeCommonPatterns().catch((error) => {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Pattern cache initialization failed: ${errorMsg}`, 'warning');
    }
  });
  
  // Initialize WASM module
  try {
    const wasmModule = await loadWasmModule<WasmModuleBabylonChunks>(
      getInitWasm,
      validateBabylonChunksModule
    );
    
    if (!wasmModule) {
      throw new WasmInitError('WASM module failed validation');
    }
    
    WASM_BABYLON_CHUNKS.wasmModule = wasmModule;
    
    // Log WASM version for debugging and cache verification
    if (addLogEntry !== null) {
      const wasmVersion = wasmModule.get_wasm_version();
      addLogEntry(`WASM module version: ${wasmVersion}`, 'info');
    }
  } catch (error) {
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
  
  // Initialize BabylonJS engine
  const engine = new Engine(canvas, true);
  
  // Create scene
  const scene = new Scene(engine);
  
  // Set up camera - directly above the center of the grid
  // Grid is 50x50 with offset positioning, so center is at (0, 0, 0)
  // Camera positioned 50 meters directly above, looking straight down
  const gridCenter = new Vector3(0, 0, 0);
  const camera = new ArcRotateCamera(
    'camera',
    0,             // Alpha: horizontal rotation (doesn't matter when looking straight down)
    0,             // Beta: 0 = straight down (top view)
    50,            // Radius: 50 meters above the grid center
    gridCenter,    // Target: center of the grid (0, 0, 0)
    scene
  );
  camera.attachControl(canvas, true);
  
  // Set up lighting
  const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), scene);
  hemisphericLight.intensity = 0.7;
  
  const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -1, -1), scene);
  directionalLight.intensity = 0.5;
  
  // Create base mesh using GLB model (single mesh, no clones - only instancing)
  // **Learning Point**: We load the hex_tile.glb model once, find a mesh with geometry,
  // and use it directly for instancing. Materials are applied per instance.
  // The model dimensions are defined in TILE_CONFIG and already in pointy-top orientation.
  const baseMeshes = new Map<string, Mesh>();
  const materials = new Map<TileType['type'], PBRMaterial>();
  
  const tileTypes: TileType[] = [
    { type: 'grass' },
    { type: 'building' },
    { type: 'road' },
    { type: 'forest' },
    { type: 'water' },
  ];
  
  // Load GLB model once, find mesh with geometry, use only instancing (no clones)
  // **Learning Point**: GLB models may have multiple meshes. We need to find a mesh with
  // actual geometry (not a container node) to use for instancing. Materials are set per instance.
  try {
    if (addLogEntry !== null) {
      addLogEntry('Loading hex_tile.glb model...', 'info');
    }
    
    const glbUrl = 'https://raw.githubusercontent.com/EricEisaman/assets/main/items/hex_tile.glb';
    const result = await SceneLoader.ImportMeshAsync('', glbUrl, '', scene);
    
    if (result.meshes.length === 0) {
      throw new Error('No meshes found in GLB model');
    }
    
    // Find a mesh with actual geometry (not a container node)
    // A mesh with geometry must have vertices data, not just a geometry property
    let baseMesh: Mesh | null = null;
    
    // Helper to find a mesh with actual vertices (recursive)
    const findMeshWithVertices = (mesh: Mesh): Mesh | null => {
      // Check if this mesh has actual vertices data
      const positions = mesh.getVerticesData('position');
      const vertexCount = mesh.getTotalVertices();
      
      // If this mesh has vertices, return it
      if (positions && positions.length > 0 && vertexCount > 0) {
        return mesh;
      }
      
      // Otherwise, check child meshes recursively
      const childMeshes = mesh.getChildMeshes();
      for (const childMesh of childMeshes) {
        if (childMesh instanceof Mesh) {
          const found = findMeshWithVertices(childMesh);
          if (found) {
            return found;
          }
        }
      }
      
      return null;
    };
    
    // Find first mesh with actual vertices
    for (const mesh of result.meshes) {
      if (mesh instanceof Mesh) {
        const found = findMeshWithVertices(mesh);
        if (found) {
          baseMesh = found;
          break;
        }
      }
    }
    
    if (!baseMesh) {
      // Log all meshes for debugging
      if (addLogEntry !== null) {
        addLogEntry(`Failed to find mesh with vertices. Available meshes:`, 'error');
        for (const mesh of result.meshes) {
          if (mesh instanceof Mesh) {
            const vertexCount = mesh.getTotalVertices();
            const childCount = mesh.getChildMeshes().length;
            addLogEntry(`  - ${mesh.name}: vertices=${vertexCount}, children=${childCount}`, 'error');
          }
        }
      }
      throw new Error('Could not find mesh with actual vertices in GLB model');
    }
    
    // Verify the mesh has vertices
    const vertexCount = baseMesh.getTotalVertices();
    if (vertexCount === 0) {
      throw new Error(`Selected mesh "${baseMesh.name}" has 0 vertices - this is a container node, not a geometry mesh`);
    }
    
    if (addLogEntry !== null) {
      addLogEntry(`Found mesh with geometry: name=${baseMesh.name}, vertices=${vertexCount}`, 'info');
    }
    
    // Use model at its actual size (scale 1.0)
    // The grid layout will be based on the model's actual dimensions from TILE_CONFIG
    baseMesh.scaling = new Vector3(1.0, 1.0, 1.0);
    
    // Remove existing materials from the base mesh and all its children
    // This ensures our color materials will be applied correctly per instance
    const removeMaterialsRecursively = (mesh: Mesh): void => {
      if (mesh.material) {
        mesh.material.dispose();
        mesh.material = null;
      }
      const childMeshes = mesh.getChildMeshes();
      for (const childMesh of childMeshes) {
        if (childMesh instanceof Mesh) {
          removeMaterialsRecursively(childMesh);
        }
      }
    };
    removeMaterialsRecursively(baseMesh);
    
    // Hide the base mesh (we'll use instances only)
    baseMesh.isVisible = false;
    
    // Create materials for each tile type (will be applied per instance)
    // Use PBRMaterial for better support of per-instance colors with thin instances
    for (const tileType of tileTypes) {
      const material = new PBRMaterial(`material_${tileType.type}`, scene);
      const color = getTileColor(tileType);
      material.albedoColor = color;
      material.metallicF0Factor = 0.0;
      material.roughness = 0.8;
      materials.set(tileType.type, material);
    }
    
    // Store the single base mesh (no clones - only instancing)
    baseMeshes.set('base', baseMesh);
    
    if (addLogEntry !== null) {
      addLogEntry(`Hex tile model loaded (hexSize: ${TILE_CONFIG.hexSize.toFixed(3)}m, using actual model dimensions ${TILE_CONFIG.modelWidth}m × ${TILE_CONFIG.modelDepth}m, using instancing only)`, 'success');
      addLogEntry(`Base mesh stored: name=${baseMesh.name}, vertices=${baseMesh.getTotalVertices()}, isVisible=${baseMesh.isVisible}`, 'info');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to load hex tile model: ${errorMsg}`, 'error');
    }
    if (errorEl) {
      errorEl.textContent = `Failed to load hex tile model: ${errorMsg}`;
    }
    throw error;
  }
  
  // Store instances for cleanup (using thin instances, so no individual instance storage needed)
  // Thin instances are managed by the base mesh itself
  
  /**
   * Get statistics for hexagon tiles only
   * 
   * This function queries WASM for each hexagon tile and counts tile types.
   * Uses hash map storage, so no bounds checking needed.
   * 
   * @param rings - Number of rings (distance from center)
   * @param centerQ - Center q coordinate (axial)
   * @param centerR - Center r coordinate (axial)
   * @returns Stats object with tile counts, or null if WASM module unavailable
   */
  const getHexagonStats = (
    rings: number,
    centerQ: number,
    centerR: number
  ): {
    grass: number;
    building: number;
    road: number;
    forest: number;
    water: number;
    total: number;
  } | null => {
    if (!WASM_BABYLON_CHUNKS.wasmModule) {
      return null;
    }
    
    // Generate hexagon grid
    const hexGrid = HEX_UTILS.generateHexGrid(rings, centerQ, centerR);
    
    // Initialize counters
    let grass = 0;
    let building = 0;
    let road = 0;
    let forest = 0;
    let water = 0;
    
    // Query each hexagon tile from WASM
    for (const hex of hexGrid) {
      const getTileAt = WASM_BABYLON_CHUNKS.wasmModule.get_tile_at.bind(WASM_BABYLON_CHUNKS.wasmModule);
      const tileNum = getTileAt(hex.q, hex.r);
      const tileType = tileTypeFromNumber(tileNum);
      
      if (tileType) {
        switch (tileType.type) {
          case 'grass':
            grass += 1;
            break;
          case 'building':
            building += 1;
            break;
          case 'road':
            road += 1;
            break;
          case 'forest':
            forest += 1;
            break;
          case 'water':
            water += 1;
            break;
        }
      }
    }
    
    const total = grass + building + road + forest + water;
    
    return {
      grass,
      building,
      road,
      forest,
      water,
      total,
    };
  };
  
  /**
   * Render the WFC grid
   * 
   * **Learning Point**: This function:
   * 1. Clears existing instances
   * 2. Generates new layout from WASM
   * 3. Creates instanced meshes for each tile
   * 4. Positions instances based on grid coordinates
   */
  const renderGrid = (constraints?: LayoutConstraints): void => {
    // Clear existing thin instances
    const baseMeshForCleanup = baseMeshes.get('base');
    if (baseMeshForCleanup) {
      const previousCount = baseMeshForCleanup.thinInstanceCount;
      baseMeshForCleanup.thinInstanceCount = 0;
      if (addLogEntry !== null) {
        addLogEntry(`Cleared previous thin instances: ${previousCount} → 0`, 'info');
      }
    }
    
    if (!WASM_BABYLON_CHUNKS.wasmModule) {
      return;
    }
    
    // Use provided constraints or defaults
    // If constraints are provided, they were already applied in generateLayoutFromText
    // Only regenerate pre-constraints if no constraints provided (standalone render)
    const constraintsToUse = constraints ?? getDefaultConstraints();
    
    // Only clear and regenerate pre-constraints if this is a standalone render
    // (not called from generateLayoutFromText which already set them)
    if (!constraints) {
      // Set default constraints if none are set
      // Clear existing pre-constraints and set new ones
      WASM_BABYLON_CHUNKS.wasmModule.clear_pre_constraints();
      
      const preConstraints = constraintsToPreConstraints(constraintsToUse);
      
      // Set pre-constraints using hex coordinates directly (no conversion needed)
      for (const preConstraint of preConstraints) {
        const tileNum = tileTypeToNumber(preConstraint.tileType);
        WASM_BABYLON_CHUNKS.wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
      }
    }
    
    // Always call generate_layout() to ensure grid is populated before rendering and stats
    // This is safe even if called multiple times - it will apply pre-constraints to grid
    const generateLayout = WASM_BABYLON_CHUNKS.wasmModule.generate_layout.bind(WASM_BABYLON_CHUNKS.wasmModule);
    generateLayout();
    
    // Create instances for each hex tile - render all hexagon pattern tiles
    // Layer-based hexagon: layer 0 = 1 tile, layer n adds 6n tiles
    // Total tiles up to layer n: 3n(n+1) + 1
    // For layer 30: 3×30×31 + 1 = 2791 tiles
    // Use tile dimensions from TILE_CONFIG
    const hexSize = TILE_CONFIG.hexSize;
    const hexHeight = TILE_CONFIG.hexHeight;
    // Use currentRings from global state
    const renderRings = currentRings;
    
    if (addLogEntry !== null) {
      addLogEntry(`Rendering with rings: ${renderRings} (expected tiles: ${3 * renderRings * (renderRings + 1) + 1})`, 'info');
    }
    
    // Center at (0, 0) - hexagon centered at origin
    const renderCenterQ = 0;
    const renderCenterR = 0;
    
    // Generate hexagon grid - all tiles will be rendered
    const renderHexGrid = HEX_UTILS.generateHexGrid(renderRings, renderCenterQ, renderCenterR);
    
    // Calculate center hex's world position for proper centering
    const centerWorldPos = HEX_UTILS.hexToWorld(renderCenterQ, renderCenterR, hexSize);
    
    // Debug: Log rendering stats
    if (addLogEntry !== null) {
      const logFn = addLogEntry;
      logFn(`Rendering: Generated ${renderHexGrid.length} hexagon tiles for rendering`, 'info');
      logFn(`Rendering: Center hex at (${renderCenterQ}, ${renderCenterR}) -> world (${centerWorldPos.x.toFixed(2)}, ${centerWorldPos.z.toFixed(2)})`, 'info');
    }
    
    // Get the single base mesh (no clones - only thin instancing)
    const baseMesh = baseMeshes.get('base');
    if (!baseMesh) {
      if (addLogEntry !== null) {
        addLogEntry('Base mesh not found for rendering', 'error');
      }
      return;
    }
    
    // Log base mesh info
    if (addLogEntry !== null) {
      addLogEntry(`Base mesh retrieved: name=${baseMesh.name}, vertices=${baseMesh.getTotalVertices()}, currentThinInstanceCount=${baseMesh.thinInstanceCount}`, 'info');
    }
    
    // Prepare data for thin instances
    // Collect all valid hex tiles with their positions and colors
    const validHexes: Array<{ hex: { q: number; r: number }; tileType: TileType; worldPos: Vector3 }> = [];
    
    for (const hex of renderHexGrid) {
      // Query WASM for tile type at this hex coordinate
      const getTileAt = WASM_BABYLON_CHUNKS.wasmModule.get_tile_at.bind(WASM_BABYLON_CHUNKS.wasmModule);
      const tileNum = getTileAt(hex.q, hex.r);
      const tileType = tileTypeFromNumber(tileNum);
      
      if (!tileType) {
        continue;
      }
      
      // Convert axial to world position for rendering using hexSize from TILE_CONFIG
      const worldPos = HEX_UTILS.hexToWorld(hex.q, hex.r, hexSize);
      // Center the grid by subtracting center hex's position
      const centeredPos = new Vector3(
        worldPos.x - centerWorldPos.x,
        hexHeight / 2.0,
        worldPos.z - centerWorldPos.z
      );
      
      validHexes.push({ hex, tileType, worldPos: centeredPos });
    }
    
    const numInstances = validHexes.length;
    
    if (addLogEntry !== null) {
      addLogEntry(`Mesh grid generation: ${numInstances} valid hexes collected from ${renderHexGrid.length} total hexes`, 'info');
    }
    
    if (numInstances === 0) {
      if (addLogEntry !== null) {
        addLogEntry('No valid tiles to render', 'warning');
      }
      return;
    }
    
    // Create transformation matrices for thin instances
    const matrices = new Float32Array(numInstances * 16); // 16 floats per matrix (4x4)
    
    // Create color buffer for thin instances (RGBA, 4 components per instance)
    const bufferColors = new Float32Array(numInstances * 4);
    
    if (addLogEntry !== null) {
      addLogEntry(`Mesh grid buffers: matrices=${matrices.length} floats (${numInstances} instances × 16), colors=${bufferColors.length} floats (${numInstances} instances × 4)`, 'info');
    }
    
    // Populate matrices and colors
    // Get base mesh scaling to preserve model dimensions in thin instances
    const baseMeshScaling = baseMesh.scaling.clone();
    
    for (let i = 0; i < numInstances; i++) {
      const { tileType, worldPos } = validHexes[i];
      
      // Create transformation matrix for this instance
      // Include scaling to preserve model dimensions (17.3m × 20m from TILE_CONFIG)
      const translation = new Vector3(worldPos.x, worldPos.y, worldPos.z);
      const scaling = baseMeshScaling.clone();
      const rotation = Quaternion.Identity();
      const matrix = Matrix.Compose(scaling, rotation, translation);
      
      // Copy matrix data to the matrices array using copyToArray method
      matrix.copyToArray(matrices, i * 16);
      
      // Get color for this tile type and convert to RGBA
      const color = getTileColor(tileType);
      bufferColors[i * 4] = color.r;     // Red
      bufferColors[i * 4 + 1] = color.g; // Green
      bufferColors[i * 4 + 2] = color.b; // Blue
      bufferColors[i * 4 + 3] = 1.0;     // Alpha
      
      // Log first few instances for debugging
      if (i < 3 && addLogEntry !== null) {
        addLogEntry(`Instance ${i}: tileType=${tileType.type}, pos=(${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)}), color=(${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)})`, 'info');
      }
    }
    
    if (addLogEntry !== null) {
      addLogEntry(`Populated ${numInstances} instance matrices and colors`, 'info');
    }
    
    // Set up thin instances with matrices using thinInstanceSetBuffer
    // The "matrix" attribute is the standard name for transformation matrices
    baseMesh.thinInstanceSetBuffer("matrix", matrices, 16);
    
    if (addLogEntry !== null) {
      addLogEntry(`Thin instance matrix buffer set: ${numInstances} instances, buffer size=${matrices.length}`, 'info');
    }
    
    // Register the color attribute for thin instances (required for per-instance colors)
    // Use "color" attribute name (not "instanceColor") - this is the standard for thin instances
    baseMesh.thinInstanceRegisterAttribute("color", 4);
    
    // Set up thin instances with per-instance colors
    // Use "color" attribute name for thin instance colors (BabylonJS standard)
    baseMesh.thinInstanceSetBuffer("color", bufferColors, 4);
    
    if (addLogEntry !== null) {
      addLogEntry(`Thin instance color buffer set: ${numInstances} instances, buffer size=${bufferColors.length}`, 'info');
    }
    
    // Set thin instance count after setting buffers (required for thin instances to render)
    baseMesh.thinInstanceCount = numInstances;
    
    if (addLogEntry !== null) {
      addLogEntry(`Thin instance count set: ${baseMesh.thinInstanceCount} (expected: ${numInstances})`, 'info');
    }
    
    // Apply a base material to the mesh
    // PBRMaterial supports per-instance colors with thin instances when color attribute is registered
    const baseMaterial = materials.get('grass');
    if (baseMaterial) {
      baseMesh.material = baseMaterial;
      if (addLogEntry !== null) {
        addLogEntry(`Base material applied: ${baseMaterial.name}`, 'info');
      }
    } else {
      if (addLogEntry !== null) {
        addLogEntry('Warning: No base material found for thin instances', 'warning');
      }
    }
    
    // Make the base mesh visible so thin instances render
    // Thin instances are rendered as part of the base mesh
    baseMesh.isVisible = true;
    
    if (addLogEntry !== null) {
      addLogEntry(`Base mesh visibility set: isVisible=${baseMesh.isVisible}, thinInstanceCount=${baseMesh.thinInstanceCount}`, 'info');
    }
    
    const renderedCount = numInstances;
    
    // Debug: Log actual rendered count
    if (addLogEntry !== null) {
      const logFn = addLogEntry;
      logFn(`Rendering: Actually rendered ${renderedCount} tiles`, 'info');
    }
    
    // Log grid statistics
    if (WASM_BABYLON_CHUNKS.wasmModule && addLogEntry !== null) {
      const logEntryFn: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void = addLogEntry;
      try {
        // Calculate expected hexagon tile count
        const expectedHexagonTiles = 3 * renderRings * (renderRings + 1) + 1;
        logEntryFn(`Stats: Expected hexagon tiles: ${expectedHexagonTiles} (${renderRings} rings)`, 'info');
        
        // Get WASM stats (from hash map)
        const statsJson = WASM_BABYLON_CHUNKS.wasmModule.get_stats();
        const parsed: unknown = JSON.parse(statsJson);
        
        // Validate the structure using direct property access with type narrowing
        // Check that parsed is an object with all required numeric properties
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Use direct property access with proper type checks
          if (
            'grass' in parsed &&
            'building' in parsed &&
            'road' in parsed &&
            'forest' in parsed &&
            'water' in parsed &&
            'total' in parsed
          ) {
            const grassVal = parsed.grass;
            const buildingVal = parsed.building;
            const roadVal = parsed.road;
            const forestVal = parsed.forest;
            const waterVal = parsed.water;
            const totalVal = parsed.total;
            
            if (
              typeof grassVal === 'number' &&
              typeof buildingVal === 'number' &&
              typeof roadVal === 'number' &&
              typeof forestVal === 'number' &&
              typeof waterVal === 'number' &&
              typeof totalVal === 'number'
            ) {
              // WASM stats (from hash map)
              const wasmStats = {
                grass: grassVal,
                building: buildingVal,
                road: roadVal,
                forest: forestVal,
                water: waterVal,
                total: totalVal,
              };
              
              // Log WASM stats
              logEntryFn(`Stats: WASM total: ${wasmStats.total} tiles`, 'info');
              
              // Get filtered hexagon stats (only counts hexagon tiles)
              const hexagonStats = getHexagonStats(renderRings, renderCenterQ, renderCenterR);
              
              if (hexagonStats) {
                logEntryFn(`Stats: Hexagon filtered total: ${hexagonStats.total} tiles (expected: ${expectedHexagonTiles})`, 'info');
                
                // Log filtered stats (hexagon tiles only)
                const statsMessage = `Grid Stats (Hexagon Only): Grass: ${hexagonStats.grass}, Building: ${hexagonStats.building}, Road: ${hexagonStats.road}, Forest: ${hexagonStats.forest}, Water: ${hexagonStats.water}, Total: ${hexagonStats.total}`;
                logEntryFn(statsMessage, 'info');
                
                // Log user prompt for comparison with generated stats
                if (lastUserPrompt !== null) {
                  logEntryFn(`User Prompt: "${lastUserPrompt}"`, 'info');
                  logEntryFn(`Prompt vs Stats Analysis:`, 'info');
                  
                  // Calculate percentages for better comparison
                  const total = hexagonStats.total;
                  const grassPercent = total > 0 ? ((hexagonStats.grass / total) * 100).toFixed(1) : '0.0';
                  const buildingPercent = total > 0 ? ((hexagonStats.building / total) * 100).toFixed(1) : '0.0';
                  const roadPercent = total > 0 ? ((hexagonStats.road / total) * 100).toFixed(1) : '0.0';
                  const forestPercent = total > 0 ? ((hexagonStats.forest / total) * 100).toFixed(1) : '0.0';
                  const waterPercent = total > 0 ? ((hexagonStats.water / total) * 100).toFixed(1) : '0.0';
                  
                  logEntryFn(`  - Grass: ${hexagonStats.grass} (${grassPercent}%)`, 'info');
                  logEntryFn(`  - Building: ${hexagonStats.building} (${buildingPercent}%)`, 'info');
                  logEntryFn(`  - Road: ${hexagonStats.road} (${roadPercent}%)`, 'info');
                  logEntryFn(`  - Forest: ${hexagonStats.forest} (${forestPercent}%)`, 'info');
                  logEntryFn(`  - Water: ${hexagonStats.water} (${waterPercent}%)`, 'info');
                }
                
                // Log comparison
                logEntryFn(`Stats Comparison: WASM: ${wasmStats.total}, Hexagon (filtered): ${hexagonStats.total}, Expected: ${expectedHexagonTiles}`, 'info');
              } else {
                logEntryFn('Failed to get hexagon stats: WASM module unavailable', 'warning');
              }
            } else {
              logEntryFn(`Invalid stats structure from WASM: missing or invalid numeric properties. Received: ${statsJson.substring(0, 200)}`, 'warning');
            }
          } else {
            logEntryFn(`Invalid stats structure from WASM: missing required properties (grass, building, road, forest, water, total)`, 'warning');
          }
        } else {
          logEntryFn(`Invalid stats structure from WASM: not an object. Type: ${typeof parsed}, Value: ${JSON.stringify(parsed).substring(0, 200)}`, 'warning');
        }
      } catch (error) {
        // If stats parsing fails, log error but don't break rendering
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logEntryFn(`Failed to get grid stats: ${errorMsg}`, 'warning');
      }
    }
  };
  
  // Initial render (clear any previous prompt since this is not from text-to-layout)
  lastUserPrompt = null;
  renderGrid();
  
  // Set up Babylon 2D UI
  const advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI('UI');
  
  // Recompute button - positioned top right using percentage-based alignment
  const recomputeButton = Button.CreateSimpleButton('recomputeButton', 'Recompute Wave Collapse');
  recomputeButton.width = '200px';
  recomputeButton.height = '40px';
  recomputeButton.color = 'white';
  recomputeButton.background = 'green';
  recomputeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  recomputeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  recomputeButton.top = '1%';
  recomputeButton.left = '-220px'; // Position from right edge (button width + gap)
  recomputeButton.onPointerClickObservable.add(() => {
    if (WASM_BABYLON_CHUNKS.wasmModule) {
      // Clear last user prompt since this is not from text-to-layout generation
      lastUserPrompt = null;
      renderGrid();
    }
  });
  advancedTexture.addControl(recomputeButton);
  
  // Fullscreen button - positioned top right using percentage-based alignment
  const fullscreenButton = Button.CreateSimpleButton('fullscreenButton', 'Fullscreen');
  fullscreenButton.width = '150px';
  fullscreenButton.height = '40px';
  fullscreenButton.color = 'white';
  fullscreenButton.background = 'blue';
  fullscreenButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  fullscreenButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  fullscreenButton.top = '1%';
  fullscreenButton.left = '-10px'; // Position from right edge
  fullscreenButton.onPointerClickObservable.add(() => {
    engine.enterFullscreen(false);
  });
  advancedTexture.addControl(fullscreenButton);
  
  // Exit fullscreen button (initially hidden) - positioned top right using percentage-based alignment
  const exitFullscreenButton = Button.CreateSimpleButton('exitFullscreenButton', 'Exit Fullscreen');
  exitFullscreenButton.width = '150px';
  exitFullscreenButton.height = '40px';
  exitFullscreenButton.color = 'white';
  exitFullscreenButton.background = 'red';
  exitFullscreenButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  exitFullscreenButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  exitFullscreenButton.top = '1%';
  exitFullscreenButton.left = '-10px'; // Position from right edge
  exitFullscreenButton.isVisible = false;
  exitFullscreenButton.onPointerClickObservable.add(() => {
    engine.exitFullscreen();
  });
  advancedTexture.addControl(exitFullscreenButton);
  
  // Handle fullscreen changes
  const handleFullscreenChange = (): void => {
    const isFullscreen = engine.isFullscreen;
    fullscreenButton.isVisible = !isFullscreen;
    exitFullscreenButton.isVisible = isFullscreen;
  };
  
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);
  
  // Start render loop
  engine.runRenderLoop(() => {
    scene.render();
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Text input and generate button (HTML elements)
  const promptInputEl = document.getElementById('layoutPromptInput');
  const generateFromTextBtn = document.getElementById('generateFromTextBtn');
  const modelStatusEl = document.getElementById('modelStatus');

  if (generateFromTextBtn && promptInputEl) {
    generateFromTextBtn.addEventListener('click', () => {
      const prompt = promptInputEl instanceof HTMLInputElement ? promptInputEl.value.trim() : '';
      if (prompt) {
        generateLayoutFromText(prompt, renderGrid, errorEl, modelStatusEl).catch((error) => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (errorEl) {
            errorEl.textContent = `Error: ${errorMsg}`;
          }
        });
      }
    });
  }

  // Rings dropdown handler
  const ringsSelectEl = document.getElementById('ringsSelect');
  if (ringsSelectEl && ringsSelectEl instanceof HTMLSelectElement) {
    // Set initial value to currentRings (default 5)
    ringsSelectEl.value = currentRings.toString();
    
    ringsSelectEl.addEventListener('change', () => {
      const selectedRings = Number.parseInt(ringsSelectEl.value, 10);
      if (!Number.isNaN(selectedRings) && selectedRings >= 0 && selectedRings <= 50) {
        // Update global rings
        currentRings = selectedRings;
        
        // Clear all state
        if (WASM_BABYLON_CHUNKS.wasmModule) {
          // Clear WASM grid
          WASM_BABYLON_CHUNKS.wasmModule.clear_layout();
          // Clear pre-constraints
          WASM_BABYLON_CHUNKS.wasmModule.clear_pre_constraints();
        }
        
        // Clear last user prompt
        lastUserPrompt = null;
        
        // Clear thin instances
        const baseMeshForCleanup = baseMeshes.get('base');
        if (baseMeshForCleanup) {
          baseMeshForCleanup.thinInstanceCount = 0;
        }
        
        if (addLogEntry !== null) {
          addLogEntry(`Rings changed to ${selectedRings}, cleared all state`, 'info');
        }
        
        // Re-render with new rings
        renderGrid();
      }
    });
  }
};

