/**
 * Babylon-WFC Route Handler
 * 
 * This endpoint demonstrates the Wave Function Collapse (WFC) algorithm
 * visualized in 3D using BabylonJS. It generates a 50x50 grid of 3D tiles
 * using mesh instancing for optimal performance.
 * 
 * **Key Features:**
 * - WFC algorithm implemented in Rust WASM
 * - 11 different 3D tile types
 * - Mesh instancing for performance
 * - Babylon 2D UI for controls
 * - Fullscreen support
 */

import type { WasmBabylonWfc, WasmModuleBabylonWfc, TileType, LayoutConstraints } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';
import { WasmLoadError, WasmInitError } from '../wasm/types';
import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, Vector3, Mesh, StandardMaterial, Color3, InstancedMesh, MeshBuilder } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button } from '@babylonjs/gui';
import { pipeline, type TextGenerationPipeline, env } from '@xenova/transformers';

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
    const moduleUnknown: unknown = await import('../../pkg/wasm_babylon_wfc/wasm_babylon_wfc.js');
    
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
 * Global state object for the babylon-wfc module
 */
const WASM_BABYLON_WFC: WasmBabylonWfc = {
  wasmModule: null,
  wasmModulePath: '../pkg/wasm_babylon_wfc',
};

/**
 * Logging function for system logs
 */
let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;

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
      return new Color3(0.5, 0.5, 0.5); // Gray
    case 'road':
      return new Color3(0.3, 0.3, 0.3); // Dark gray
    case 'forest':
      return new Color3(0.1, 0.5, 0.1); // Dark green
    case 'water':
      return new Color3(0.2, 0.4, 0.8); // Blue
  }
}

/**
 * Validate that the WASM module has all required exports
 */
function validateBabylonWfcModule(exports: unknown): WasmModuleBabylonWfc | null {
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
  
  if (!wasmModuleRecord) {
    missingExports.push('module record (wasmModuleRecord is null)');
  } else {
    if (typeof wasmModuleRecord.generate_layout !== 'function') {
      missingExports.push('generate_layout (function)');
    }
    if (typeof wasmModuleRecord.get_tile_at !== 'function') {
      missingExports.push('get_tile_at (function)');
    }
    if (typeof wasmModuleRecord.clear_layout !== 'function') {
      missingExports.push('clear_layout (function)');
    }
    if (typeof wasmModuleRecord.set_pre_constraint !== 'function') {
      missingExports.push('set_pre_constraint (function)');
    }
    if (typeof wasmModuleRecord.clear_pre_constraints !== 'function') {
      missingExports.push('clear_pre_constraints (function)');
    }
    if (typeof wasmModuleRecord.get_stats !== 'function') {
      missingExports.push('get_stats (function)');
    }
    if (typeof wasmModuleRecord.generate_voronoi_regions !== 'function') {
      missingExports.push('generate_voronoi_regions (function)');
    }
    if (typeof wasmModuleRecord.validate_road_connectivity !== 'function') {
      missingExports.push('validate_road_connectivity (function)');
    }
  }
  
  if (missingExports.length > 0) {
    throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
  }
  
  const memory = memoryValue;
  if (!(memory instanceof WebAssembly.Memory)) {
    return null;
  }
  
  if (!wasmModuleRecord) {
    return null;
  }
  
  const generateLayoutFunc = wasmModuleRecord.generate_layout;
  const getTileAtFunc = wasmModuleRecord.get_tile_at;
  const clearLayoutFunc = wasmModuleRecord.clear_layout;
  const setPreConstraintFunc = wasmModuleRecord.set_pre_constraint;
  const clearPreConstraintsFunc = wasmModuleRecord.clear_pre_constraints;
  const getStatsFunc = wasmModuleRecord.get_stats;
  const generateVoronoiRegionsFunc = wasmModuleRecord.generate_voronoi_regions;
  const validateRoadConnectivityFunc = wasmModuleRecord.validate_road_connectivity;
  
  if (
    typeof generateLayoutFunc !== 'function' ||
    typeof getTileAtFunc !== 'function' ||
    typeof clearLayoutFunc !== 'function' ||
    typeof setPreConstraintFunc !== 'function' ||
    typeof clearPreConstraintsFunc !== 'function' ||
    typeof getStatsFunc !== 'function' ||
    typeof generateVoronoiRegionsFunc !== 'function' ||
    typeof validateRoadConnectivityFunc !== 'function'
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
  };
}

// Qwen model configuration
const MODEL_ID = 'Xenova/qwen1.5-0.5b-chat';

// CORS proxy services for Hugging Face model loading
const CORS_PROXY_SERVICES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
] as const;

/**
 * Check if a URL needs CORS proxying
 */
function needsProxy(url: string): boolean {
  return (
    url.includes('huggingface.co') &&
    !url.includes('cdn.jsdelivr.net') &&
    !url.includes('api.allorigins.win') &&
    !url.includes('corsproxy.io') &&
    !url.includes('api.codetabs.com')
  );
}

/**
 * Custom fetch function with CORS proxy support
 */
async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  
  // If URL doesn't need proxying, use normal fetch
  if (!needsProxy(url)) {
    return fetch(input, init);
  }
  
  // Try each CORS proxy in order
  for (const proxyBase of CORS_PROXY_SERVICES) {
    try {
      const proxyUrl = proxyBase + encodeURIComponent(url);
      
      const response = await fetch(proxyUrl, {
        ...init,
        redirect: 'follow',
      });
      
      // Skip proxies that return error status codes
      if (response.status >= 400 && response.status < 600) {
        continue;
      }
      
      // If response looks good, return it
      if (response.ok) {
        return response;
      }
    } catch {
      // Try next proxy
      continue;
    }
  }
  
  // If all proxies fail, try direct fetch as last resort
  return fetch(input, init);
}

/**
 * Set up custom fetch function for Transformers.js
 */
function setupCustomFetch(): void {
  // Use proper type narrowing instead of type assertion
  if (typeof env === 'object' && env !== null) {
    const envRecord: Record<string, unknown> = env;
    envRecord.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      return customFetch(input, init);
    };
  }
}

// Qwen model state
let textGenerationPipeline: TextGenerationPipeline | null = null;
let isModelLoading = false;
let isModelLoaded = false;

/**
 * Load Qwen model for text-to-layout generation
 */
async function loadQwenModel(onProgress?: (progress: number) => void): Promise<void> {
  if (isModelLoaded && textGenerationPipeline) {
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

    // Set up custom fetch with CORS proxy support before loading model
    setupCustomFetch();

    const pipelineResult = await pipeline('text-generation', MODEL_ID, {
      progress_callback: (progress: { loaded: number; total: number }) => {
        if (onProgress && progress.total > 0) {
          const progressPercent = (progress.loaded / progress.total) * 0.9 + 0.1;
          onProgress(progressPercent);
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-type-assertion
    textGenerationPipeline = pipelineResult as TextGenerationPipeline;

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
 * Extract assistant response from generated text
 */
function extractAssistantResponse(generatedText: string, formattedPrompt: string): string {
  let response = generatedText;

  if (response.includes(formattedPrompt)) {
    response = response.replace(formattedPrompt, '');
  }

  response = response.replace(/<\|im_start\|>assistant\s*/g, '');
  response = response.replace(/<\|im_end\|>/g, '');
  response = response.replace(/<\|im_start\|>/g, '');
  response = response.replace(/^\s*(user|assistant)[:\s]+/i, '');

  const lastAssistantIndex = response.lastIndexOf('assistant');
  if (lastAssistantIndex !== -1) {
    const afterAssistant = response.substring(lastAssistantIndex + 'assistant'.length);
    if (afterAssistant.trim().length > 0) {
      response = afterAssistant;
    }
  }

  response = response.replace(/^\s*user[:\s]+/i, '');
  response = response.trim();

  return response;
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
 * Generate layout description from text prompt using Qwen
 */
async function generateLayoutDescription(prompt: string): Promise<string> {
  if (!textGenerationPipeline) {
    throw new Error('Qwen model not loaded');
  }

  const tokenizer = textGenerationPipeline.tokenizer;
  if (tokenizer && typeof tokenizer.apply_chat_template === 'function') {
    const messages = [
      {
        role: 'user',
        content: `Generate a layout description for a 50x50 grid based on this request: "${prompt}"

Provide a JSON object with these fields:
- buildingDensity: "sparse" | "medium" | "dense"
- clustering: "clustered" | "distributed" | "random"
- grassRatio: number between 0.0 and 1.0
- buildingSizeHint: "small" | "medium" | "large"

Respond with only the JSON object, no additional text.`,
      },
    ];

    const formattedPrompt = tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });

    if (typeof formattedPrompt !== 'string') {
      throw new Error('Chat template did not return a string');
    }

    const result = await textGenerationPipeline(formattedPrompt, {
      max_new_tokens: 150,
      temperature: 0.7,
      do_sample: true,
    });

    let generatedText = '';
    if (Array.isArray(result) && result.length > 0) {
      const firstItem = result[0];
      if (typeof firstItem === 'object' && firstItem !== null && 'generated_text' in firstItem) {
        const generated = firstItem.generated_text;
        if (typeof generated === 'string') {
          generatedText = generated;
        }
      }
    } else if (typeof result === 'object' && result !== null && 'generated_text' in result) {
      const generated = result.generated_text;
      if (typeof generated === 'string') {
        generatedText = generated;
      }
    }

    return extractAssistantResponse(generatedText, formattedPrompt);
  }

  throw new Error('Chat template not available');
}

/**
 * Parse layout constraints from Qwen output
 */
function parseLayoutConstraints(output: string): LayoutConstraints {
  // Try JSON parsing first
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries: Array<[string, unknown]> = Object.entries(parsed);
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
          return {
            buildingDensity: density,
            clustering,
            grassRatio,
            buildingSizeHint: size,
          };
        }
      }
    }
  } catch {
    // JSON parsing failed, try regex
  }

  // Fallback to regex parsing
  const densityMatch = output.match(/buildingDensity["\s:]+(sparse|medium|dense)/i);
  const clusteringMatch = output.match(/clustering["\s:]+(clustered|distributed|random)/i);
  const grassRatioMatch = output.match(/grassRatio["\s:]+([\d.]+)/i);
  const sizeMatch = output.match(/buildingSizeHint["\s:]+(small|medium|large)/i);

  const density = densityMatch && (densityMatch[1] === 'sparse' || densityMatch[1] === 'medium' || densityMatch[1] === 'dense')
    ? densityMatch[1]
    : 'medium';
  const clustering = clusteringMatch && (clusteringMatch[1] === 'clustered' || clusteringMatch[1] === 'distributed' || clusteringMatch[1] === 'random')
    ? clusteringMatch[1]
    : 'random';
  const grassRatio = grassRatioMatch ? parseFloat(grassRatioMatch[1]) : 0.3;
  const size = sizeMatch && (sizeMatch[1] === 'small' || sizeMatch[1] === 'medium' || sizeMatch[1] === 'large')
    ? sizeMatch[1]
    : 'medium';

  return {
    buildingDensity: density,
    clustering,
    grassRatio: Math.max(0, Math.min(1, grassRatio)),
    buildingSizeHint: size,
  };
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
    const x = hexSize * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
    const z = hexSize * ((3 / 2) * r);
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
    // 1. Convert world coordinates to fractional axial coordinates
    const fracQ = (Math.sqrt(3) / 3 * x - (1 / 3) * z) / hexSize;
    const fracR = ((2 / 3) * z) / hexSize;
    
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
   * Generate all tiles in hexagon up to maxLayer
   * Layer 0: 1 tile (center)
   * Layer n: adds 6n tiles (ring)
   * Total: 3*maxLayer*(maxLayer+1) + 1 tiles
   * 
   * Uses Set for deduplication and O(1) lookups, then converts to array.
   */
  generateHexGrid(maxLayer: number, centerQ: number, centerR: number): Array<HexCoord> {
    // Use Set with string keys for deduplication and O(1) lookups
    const gridSet = new Set<string>();
    const centerCube = this.axialToCube(centerQ, centerR);
    
    // Generate grid from center outwards, adding one ring at a time
    for (let layer = 0; layer <= maxLayer; layer++) {
      const ring = this.cubeRing(centerCube, layer);
      for (const cube of ring) {
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
    const expectedSize = 3 * maxLayer * (maxLayer + 1) + 1;
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
   * @param maxLayer - Maximum layer number (distance from center)
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param centerQ - Center q coordinate
   * @param centerR - Center r coordinate
   * @returns True if hex is within maxLayer distance from center (using cube distance)
   */
  isInHexagonPattern(maxLayer: number, q: number, r: number, centerQ: number, centerR: number): boolean {
    const centerCube = this.axialToCube(centerQ, centerR);
    const tileCube = this.axialToCube(q, r);
    const dist = this.cubeDistance(tileCube, centerCube);
    return dist <= maxLayer;
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
 * Building footprint shape type
 */
type FootprintShape = 'rectangular' | 'square' | 'l-shaped' | 'u-shaped';


/**
 * Check if a position conflicts with existing constraints
 * Note: Buildings are allowed to override grass cells, so we don't check grass conflicts
 * Also checks if position is within hexagonal map boundary
 */
function hasConflict(
  x: number,
  y: number,
  _grassCells: Array<{ x: number; y: number }>,
  existingFootprints: Array<Array<{ x: number; y: number }>>,
  width: number,
  height: number,
  maxLayer: number
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return true;
  }

  // Check if position is within hexagon pattern (layer-based)
  const axial = HEX_UTILS.offsetToAxial(x, y);
  const centerOffset = HEX_UTILS.offsetToAxial(Math.floor(width / 2), Math.floor(height / 2));
  if (!HEX_UTILS.isInHexagonPattern(maxLayer, axial.q, axial.r, centerOffset.q, centerOffset.r)) {
    return true;
  }

  // Don't check grass conflicts - buildings can override grass cells
  // Floor tiles will override grass when set as pre-constraints

  for (const footprint of existingFootprints) {
    if (footprint.some((cell) => cell.x === x && cell.y === y)) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate actual boundary length of a rectangular footprint
 */
function calculateRectangularBoundary(
  footprint: Array<{ x: number; y: number }>
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (footprint.length === 0) {
    return null;
  }

  let minX = footprint[0].x;
  let maxX = footprint[0].x;
  let minY = footprint[0].y;
  let maxY = footprint[0].y;

  for (const cell of footprint) {
    if (cell.x < minX) {
      minX = cell.x;
    }
    if (cell.x > maxX) {
      maxX = cell.x;
    }
    if (cell.y < minY) {
      minY = cell.y;
    }
    if (cell.y > maxY) {
      maxY = cell.y;
    }
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Validate that a footprint has minimum boundary length of 3 tiles
 */
function validateFootprintBoundaries(
  footprint: Array<{ x: number; y: number }>,
  minSize: number
): boolean {
  const bounds = calculateRectangularBoundary(footprint);
  if (!bounds) {
    return false;
  }

  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;

  return width >= minSize && height >= minSize;
}

/**
 * Generate a rectangular or square footprint
 */
function generateRectangularFootprint(
  seedX: number,
  seedY: number,
  minSize: number,
  maxSize: number,
  width: number,
  height: number,
  grassCells: Array<{ x: number; y: number }>,
  existingFootprints: Array<Array<{ x: number; y: number }>>,
  maxLayer: number
): Array<{ x: number; y: number }> | null {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const w = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const h = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;

    if (w < minSize || h < minSize) {
      continue;
    }

    const startX = seedX - Math.floor(w / 2);
    const startY = seedY - Math.floor(h / 2);

    const footprint: Array<{ x: number; y: number }> = [];

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = startX + dx;
        const y = startY + dy;

        if (x < 0 || x >= width || y < 0 || y >= height) {
          break;
        }

        if (hasConflict(x, y, grassCells, existingFootprints, width, height, maxLayer)) {
          break;
        }

        footprint.push({ x, y });
      }
    }

    if (footprint.length === w * h && validateFootprintBoundaries(footprint, minSize)) {
      return footprint;
    }
  }

  return null;
}

/**
 * Generate an L-shaped footprint
 */
function generateLShapedFootprint(
  seedX: number,
  seedY: number,
  minSize: number,
  maxSize: number,
  width: number,
  height: number,
  grassCells: Array<{ x: number; y: number }>,
  existingFootprints: Array<Array<{ x: number; y: number }>>,
  maxLayer: number
): Array<{ x: number; y: number }> | null {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const horizontalW = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const horizontalH = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const verticalW = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const verticalH = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;

    if (horizontalW < minSize || horizontalH < minSize || verticalW < minSize || verticalH < minSize) {
      continue;
    }

    const horizontalStartX = seedX - Math.floor(horizontalW / 2);
    const horizontalStartY = seedY - Math.floor(horizontalH / 2);
    const verticalStartX = seedX - Math.floor(verticalW / 2);
    const verticalStartY = seedY + Math.floor(horizontalH / 2);

    const footprint: Array<{ x: number; y: number }> = [];
    let valid = true;

    for (let dy = 0; dy < horizontalH && valid; dy++) {
      for (let dx = 0; dx < horizontalW && valid; dx++) {
        const x = horizontalStartX + dx;
        const y = horizontalStartY + dy;

        if (x < 0 || x >= width || y < 0 || y >= height) {
          valid = false;
          break;
        }

        if (hasConflict(x, y, grassCells, existingFootprints, width, height, maxLayer)) {
          valid = false;
          break;
        }

        footprint.push({ x, y });
      }
    }

    if (!valid) {
      continue;
    }

    for (let dy = 0; dy < verticalH && valid; dy++) {
      for (let dx = 0; dx < verticalW && valid; dx++) {
        const x = verticalStartX + dx;
        const y = verticalStartY + dy;

        if (x < 0 || x >= width || y < 0 || y >= height) {
          valid = false;
          break;
        }

        if (hasConflict(x, y, grassCells, existingFootprints, width, height, maxLayer)) {
          valid = false;
          break;
        }

        if (!footprint.some((cell) => cell.x === x && cell.y === y)) {
          footprint.push({ x, y });
        }
      }
    }

    if (valid && validateFootprintBoundaries(footprint, minSize)) {
      return footprint;
    }
  }

  return null;
}

/**
 * Generate a U-shaped footprint
 */
function generateUShapedFootprint(
  seedX: number,
  seedY: number,
  minSize: number,
  maxSize: number,
  width: number,
  height: number,
  grassCells: Array<{ x: number; y: number }>,
  existingFootprints: Array<Array<{ x: number; y: number }>>,
  maxLayer: number
): Array<{ x: number; y: number }> | null {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const baseW = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const baseH = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const sideW = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const sideH = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;

    if (baseW < minSize || baseH < minSize || sideW < minSize || sideH < minSize) {
      continue;
    }

    const baseStartX = seedX - Math.floor(baseW / 2);
    const baseStartY = seedY - Math.floor(baseH / 2);
    const leftSideStartX = baseStartX - Math.floor(sideW / 2);
    const leftSideStartY = baseStartY;
    const rightSideStartX = baseStartX + baseW - Math.floor(sideW / 2);
    const rightSideStartY = baseStartY;

    const footprint: Array<{ x: number; y: number }> = [];
    let valid = true;

    for (let dy = 0; dy < baseH && valid; dy++) {
      for (let dx = 0; dx < baseW && valid; dx++) {
        const x = baseStartX + dx;
        const y = baseStartY + dy;

        if (x < 0 || x >= width || y < 0 || y >= height) {
          valid = false;
          break;
        }

        if (hasConflict(x, y, grassCells, existingFootprints, width, height, maxLayer)) {
          valid = false;
          break;
        }

        footprint.push({ x, y });
      }
    }

    if (!valid) {
      continue;
    }

    for (let dy = 0; dy < sideH && valid; dy++) {
      for (let dx = 0; dx < sideW && valid; dx++) {
        const leftX = leftSideStartX + dx;
        const leftY = leftSideStartY + dy;
        const rightX = rightSideStartX + dx;
        const rightY = rightSideStartY + dy;

        if (leftX >= 0 && leftX < width && leftY >= 0 && leftY < height) {
          if (!hasConflict(leftX, leftY, grassCells, existingFootprints, width, height, maxLayer)) {
            if (!footprint.some((cell) => cell.x === leftX && cell.y === leftY)) {
              footprint.push({ x: leftX, y: leftY });
            }
          } else {
            valid = false;
            break;
          }
        } else {
          valid = false;
          break;
        }

        if (rightX >= 0 && rightX < width && rightY >= 0 && rightY < height) {
          if (!hasConflict(rightX, rightY, grassCells, existingFootprints, width, height, maxLayer)) {
            if (!footprint.some((cell) => cell.x === rightX && cell.y === rightY)) {
              footprint.push({ x: rightX, y: rightY });
            }
          } else {
            valid = false;
            break;
          }
        } else {
          valid = false;
          break;
        }
      }
    }

    if (valid && validateFootprintBoundaries(footprint, minSize)) {
      return footprint;
    }
  }

  return null;
}

/**
 * Generate a building footprint of the specified shape
 * @deprecated Not currently used - kept for potential future adjacency constraints
 */
export function generateBuildingFootprint(
  seedX: number,
  seedY: number,
  shape: FootprintShape,
  minSize: number,
  maxSize: number,
  width: number,
  height: number,
  grassCells: Array<{ x: number; y: number }>,
  existingFootprints: Array<Array<{ x: number; y: number }>>,
  maxLayer: number
): Array<{ x: number; y: number }> | null {
  switch (shape) {
    case 'rectangular':
    case 'square':
      return generateRectangularFootprint(seedX, seedY, minSize, maxSize, width, height, grassCells, existingFootprints, maxLayer);
    case 'l-shaped':
      return generateLShapedFootprint(seedX, seedY, minSize, maxSize, width, height, grassCells, existingFootprints, maxLayer);
    case 'u-shaped':
      return generateUShapedFootprint(seedX, seedY, minSize, maxSize, width, height, grassCells, existingFootprints, maxLayer);
  }
}

/**
 * Hex A* pathfinding for road connectivity validation
 * 
 * Uses cube coordinates for distance calculations and explores 6 hex neighbors.
 * Returns path from start to goal, or null if unreachable.
 * 
 * Note: Currently not used in road connectivity validation (BFS is used instead),
 * but available for future pathfinding needs.
 */
export function hexAStar(
  start: HexCoord,
  goal: HexCoord,
  isValid: (q: number, r: number) => boolean
): Array<HexCoord> | null {
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
 * Get all hex coordinates that have valid terrain (grass or forest) from Voronoi regions
 * Roads and buildings can only be placed on grass or forest tiles, not water
 */
function getValidTerrainHexes(
  hexGrid: Array<HexCoord>,
  voronoiConstraints: Array<{ q: number; r: number; tileType: TileType }>
): Array<HexCoord> {
  const validHexes: Array<HexCoord> = [];
  const voronoiMap = new Map<string, TileType>();
  
  for (const constraint of voronoiConstraints) {
    voronoiMap.set(`${constraint.q},${constraint.r}`, constraint.tileType);
  }
  
  for (const hex of hexGrid) {
    const tileType = voronoiMap.get(`${hex.q},${hex.r}`);
    if (tileType && (tileType.type === 'grass' || tileType.type === 'forest')) {
      validHexes.push(hex);
    }
  }
  
  return validHexes;
}

/**
 * Check if a hex coordinate is adjacent to at least one road
 */
function isAdjacentToRoad(
  q: number,
  r: number,
  roadConstraints: Array<{ q: number; r: number; tileType: TileType }>
): boolean {
  const roadSet = new Set<string>();
  for (const road of roadConstraints) {
    roadSet.add(`${road.q},${road.r}`);
  }
  
  const neighbors = HEX_UTILS.getNeighbors(q, r);
  for (const neighbor of neighbors) {
    if (roadSet.has(`${neighbor.q},${neighbor.r}`)) {
      return true;
    }
  }
  
  return false;
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
 */
function buildPathBetweenRoads(
  start: HexCoord,
  end: HexCoord,
  isValid: (q: number, r: number) => boolean
): Array<HexCoord> | null {
  const path = hexAStar(start, end, isValid);
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
  if (!WASM_BABYLON_WFC.wasmModule) {
    if (addLogEntry !== null) {
      addLogEntry('WASM module not available for Voronoi generation', 'error');
    }
    return [];
  }

  // Use hexagon pattern - layer 30 gives 2791 tiles
  const maxLayer = 30;
  // Center at (0, 0) for simplicity - hexagon centered at origin
  const centerQ = 0;
  const centerR = 0;

  // Generate hexagon grid for reference
  const hexGrid = HEX_UTILS.generateHexGrid(maxLayer, centerQ, centerR);
  const totalTiles = hexGrid.length;

  if (addLogEntry !== null) {
    addLogEntry(`Hexagon Grid Generation: Generated ${hexGrid.length} tiles (expected: 2791 for layer 30)`, 'info');
  }

  // Step 1: Generate Voronoi regions for forest, water, and grass using WASM
  // Seed counts: forest=3-5, water=2-4, grass=5-8 (configurable)
  const forestSeeds = 4;
  const waterSeeds = 3;
  const grassSeeds = 6;

  if (addLogEntry !== null) {
    addLogEntry(`Generating Voronoi regions: ${forestSeeds} forest, ${waterSeeds} water, ${grassSeeds} grass seeds`, 'info');
  }

  const voronoiJson = WASM_BABYLON_WFC.wasmModule.generate_voronoi_regions(
    maxLayer,
    centerQ,
    centerR,
    forestSeeds,
    waterSeeds,
    grassSeeds
  );

  // Parse Voronoi regions from JSON
  const voronoiConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  try {
    const parsed: unknown = JSON.parse(voronoiJson);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          // Helper to safely get property from unknown object
          // We've already validated item is an object, but TypeScript needs help
          const getPropertyFromUnknown = (obj: unknown, key: string): unknown => {
            if (typeof obj === 'object' && obj !== null) {
              const descriptor = Object.getOwnPropertyDescriptor(obj, key);
              return descriptor ? descriptor.value : undefined;
            }
            return undefined;
          };

          const qCandidate = getPropertyFromUnknown(item, 'q');
          const rCandidate = getPropertyFromUnknown(item, 'r');
          const tileTypeCandidate = getPropertyFromUnknown(item, 'tileType');

          if (
            typeof qCandidate === 'number' &&
            typeof rCandidate === 'number' &&
            typeof tileTypeCandidate === 'number'
          ) {
            const tileType = tileTypeFromNumber(tileTypeCandidate);
            if (tileType) {
              voronoiConstraints.push({ q: qCandidate, r: rCandidate, tileType });
            }
          }
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry !== null) {
      addLogEntry(`Failed to parse Voronoi regions: ${errorMsg}`, 'warning');
    }
  }

  if (addLogEntry !== null) {
    const forestCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'forest').length;
    const waterCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'water').length;
    const grassCount = voronoiConstraints.filter((pc) => pc.tileType.type === 'grass').length;
    addLogEntry(`Voronoi regions: ${forestCount} forest, ${waterCount} water, ${grassCount} grass`, 'info');
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
  const validTerrainHexes = getValidTerrainHexes(hexGrid, voronoiConstraints);

  if (addLogEntry !== null) {
    addLogEntry(`Valid terrain for roads/buildings: ${validTerrainHexes.length} hexes (grass/forest only)`, 'info');
  }

  // Calculate target road count (10% of valid terrain)
  const targetRoadCount = Math.floor(validTerrainHexes.length * 0.1);

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

  // Step 3b: Build connected network using growing tree algorithm
  // Start with first seed point
  const roadNetwork: Array<HexCoord> = [];
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
    const path = buildPathBetweenRoads(nearestRoad, seed, isValidForRoad);
    if (path && path.length > 0) {
      // Add all hexes along the path to the network
      for (const pathHex of path) {
        const pathKey = `${pathHex.q},${pathHex.r}`;
        if (!occupiedHexes.has(pathKey)) {
          roadNetwork.push(pathHex);
          occupiedHexes.add(pathKey);
        }
      }
    } else {
      // If no path found, try to add seed directly (should be rare)
      if (isValidForRoad(seed.q, seed.r)) {
        roadNetwork.push(seed);
        occupiedHexes.add(`${seed.q},${seed.r}`);
      }
    }
  }

  if (addLogEntry !== null) {
    addLogEntry(`Built initial connected network: ${roadNetwork.length} roads`, 'info');
  }

  // Step 3c: Expand network to reach target density
  // Add roads adjacent to existing network until we reach target count
  while (roadNetwork.length < targetRoadCount) {
    const adjacentHexes = getAdjacentValidTerrain(roadNetwork, validTerrainHexes, occupiedHexes);
    
    if (adjacentHexes.length === 0) {
      // No more valid adjacent hexes, stop expanding
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
  if (WASM_BABYLON_WFC.wasmModule) {
    roadsConnected = WASM_BABYLON_WFC.wasmModule.validate_road_connectivity(roadsJson);
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

  // Find available hexes for buildings (only on valid terrain, not already occupied, adjacent to roads)
  for (const hex of validTerrainHexes) {
    const hexKey = `${hex.q},${hex.r}`;
    if (!occupiedHexes.has(hexKey) && isAdjacentToRoad(hex.q, hex.r, roadConstraints)) {
      availableBuildingHexes.push(hex);
    }
  }

  if (addLogEntry !== null) {
    addLogEntry(`Available building locations (adjacent to roads): ${availableBuildingHexes.length} hexes`, 'info');
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

  // Place buildings based on density
  const buildingDensity = constraints.buildingDensity;
  let buildingRatio = 0.1;
  if (buildingDensity === 'sparse') {
    buildingRatio = 0.05;
  } else if (buildingDensity === 'dense') {
    buildingRatio = 0.15;
  }

  const buildingCount = Math.floor(availableBuildingHexes.length * buildingRatio);
  let placedBuildings = 0;
  for (let i = 0; i < buildingCount && i < availableBuildingHexes.length; i++) {
    const hex = availableBuildingHexes[i];
    if (hex) {
      // Double-check adjacency (in case roads changed during retries)
      if (isAdjacentToRoad(hex.q, hex.r, roadConstraints)) {
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
 * Generate layout from text prompt
 */
async function generateLayoutFromText(
  prompt: string,
  renderGrid: () => void,
  errorEl: HTMLElement | null,
  modelStatusEl: HTMLElement | null
): Promise<void> {
  if (!WASM_BABYLON_WFC.wasmModule) {
    if (errorEl) {
      errorEl.textContent = 'WASM module not loaded';
    }
    return;
  }

  try {
    if (modelStatusEl) {
      modelStatusEl.textContent = 'Loading Qwen model...';
    }

    await loadQwenModel((progress) => {
      if (modelStatusEl) {
        modelStatusEl.textContent = `Loading model: ${Math.floor(progress * 100)}%`;
      }
    });

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Generating layout description...';
    }

    const layoutDescription = await generateLayoutDescription(prompt);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Parsing constraints...';
    }

    const constraints = parseLayoutConstraints(layoutDescription);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Applying constraints...';
    }

    WASM_BABYLON_WFC.wasmModule.clear_pre_constraints();

    const preConstraints = constraintsToPreConstraints(constraints);

    // Set pre-constraints using hex coordinates directly (no conversion needed)
    for (const preConstraint of preConstraints) {
      const tileNum = tileTypeToNumber(preConstraint.tileType);
      WASM_BABYLON_WFC.wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Generating layout...';
    }

    WASM_BABYLON_WFC.wasmModule.generate_layout();

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Rendering...';
    }

    renderGrid();

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Ready';
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (errorEl) {
      errorEl.textContent = `Error generating layout: ${errorMsg}`;
    }
    if (modelStatusEl) {
      modelStatusEl.textContent = 'Error';
    }
  }
}

/**
 * Initialize the babylon-wfc route
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
  
  // Initialize WASM module
  try {
    const wasmModule = await loadWasmModule<WasmModuleBabylonWfc>(
      getInitWasm,
      validateBabylonWfcModule
    );
    
    if (!wasmModule) {
      throw new WasmInitError('WASM module failed validation');
    }
    
    WASM_BABYLON_WFC.wasmModule = wasmModule;
    
    // Set up JavaScript random function for WASM
    const globalObj: { [key: string]: unknown } = globalThis;
    globalObj.js_random = (): number => Math.random();
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
  
  // Create base meshes for each tile type (11 types) using hex tiles
  // **Learning Point**: We create one base hex mesh per tile type, then use
  // instancing to create instances efficiently.
  const baseMeshes = new Map<TileType['type'], Mesh>();
  const materials = new Map<TileType['type'], StandardMaterial>();
  
  // Hex tile parameters
  const hexSize = 1.5;
  const hexHeight = 0.3;
  
  const tileTypes: TileType[] = [
    { type: 'grass' },
    { type: 'building' },
    { type: 'road' },
    { type: 'forest' },
    { type: 'water' },
  ];
  
  for (const tileType of tileTypes) {
    // Create hex tile using cylinder with 6 sides
    const mesh = MeshBuilder.CreateCylinder(`base_${tileType.type}`, {
      height: hexHeight,
      diameter: hexSize * 2,
      tessellation: 6,
    }, scene);
    mesh.isVisible = false;
    mesh.position.y = hexHeight / 2;
    // Rotate 30 degrees (π/6 radians) around Y-axis to match pointy-top hex orientation
    // This aligns the cylinder with the pointy-top hex coordinate formulas
    mesh.rotation.y = Math.PI / 6;
    
    const material = new StandardMaterial(`material_${tileType.type}`, scene);
    material.diffuseColor = getTileColor(tileType);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    mesh.material = material;
    
    baseMeshes.set(tileType.type, mesh);
    materials.set(tileType.type, material);
  }
  
  // Store instances for cleanup
  const instances: InstancedMesh[] = [];
  
  /**
   * Get statistics for hexagon tiles only
   * 
   * This function queries WASM for each hexagon tile and counts tile types.
   * Uses hash map storage, so no bounds checking needed.
   * 
   * @param maxLayer - Maximum layer number (distance from center)
   * @param centerQ - Center q coordinate (axial)
   * @param centerR - Center r coordinate (axial)
   * @returns Stats object with tile counts, or null if WASM module unavailable
   */
  const getHexagonStats = (
    maxLayer: number,
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
    if (!WASM_BABYLON_WFC.wasmModule) {
      return null;
    }
    
    // Generate hexagon grid
    const hexGrid = HEX_UTILS.generateHexGrid(maxLayer, centerQ, centerR);
    
    // Initialize counters
    let grass = 0;
    let building = 0;
    let road = 0;
    let forest = 0;
    let water = 0;
    
    // Query each hexagon tile from WASM
    for (const hex of hexGrid) {
      const getTileAt = WASM_BABYLON_WFC.wasmModule.get_tile_at.bind(WASM_BABYLON_WFC.wasmModule);
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
  const renderGrid = (): void => {
    // Clear existing instances
    for (const instance of instances) {
      const disposeMethod = instance.dispose.bind(instance);
      disposeMethod();
    }
    instances.length = 0;
    
    if (!WASM_BABYLON_WFC.wasmModule) {
      return;
    }
    
    // Set default constraints if none are set
    // Clear existing pre-constraints and set new ones
    WASM_BABYLON_WFC.wasmModule.clear_pre_constraints();
    
    const defaultConstraints = getDefaultConstraints();
    const preConstraints = constraintsToPreConstraints(defaultConstraints);
    
    // Set pre-constraints using hex coordinates directly (no conversion needed)
    for (const preConstraint of preConstraints) {
      const tileNum = tileTypeToNumber(preConstraint.tileType);
      WASM_BABYLON_WFC.wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
    }
    
    // Generate new layout
    const generateLayout = WASM_BABYLON_WFC.wasmModule.generate_layout.bind(WASM_BABYLON_WFC.wasmModule);
    generateLayout();
    
    // Create instances for each hex tile - render all hexagon pattern tiles
    // Layer-based hexagon: layer 0 = 1 tile, layer n adds 6n tiles
    // Total tiles up to layer n: 3n(n+1) + 1
    // For layer 30: 3×30×31 + 1 = 2791 tiles
    const hexSize = 1.5;
    const hexHeight = 0.3;
    const renderMaxLayer = 30; // Maximum layer (distance from center)
    
    // Center at (0, 0) - hexagon centered at origin
    const renderCenterQ = 0;
    const renderCenterR = 0;
    
    // Generate hexagon grid - all tiles will be rendered
    const renderHexGrid = HEX_UTILS.generateHexGrid(renderMaxLayer, renderCenterQ, renderCenterR);
    
    // Calculate center hex's world position for proper centering
    const centerWorldPos = HEX_UTILS.hexToWorld(renderCenterQ, renderCenterR, hexSize);
    
    // Debug: Log rendering stats
    if (addLogEntry !== null) {
      const logFn = addLogEntry;
      logFn(`Rendering: Generated ${renderHexGrid.length} hexagon tiles for rendering`, 'info');
      logFn(`Rendering: Center hex at (${renderCenterQ}, ${renderCenterR}) -> world (${centerWorldPos.x.toFixed(2)}, ${centerWorldPos.z.toFixed(2)})`, 'info');
    }
    
    let renderedCount = 0;
    for (const hex of renderHexGrid) {
      // Query WASM for tile type at this hex coordinate
      const getTileAt = WASM_BABYLON_WFC.wasmModule.get_tile_at.bind(WASM_BABYLON_WFC.wasmModule);
      const tileNum = getTileAt(hex.q, hex.r);
      const tileType = tileTypeFromNumber(tileNum);
      
      if (!tileType) {
        continue;
      }
      
      const baseMesh = baseMeshes.get(tileType.type);
      if (!baseMesh) {
        continue;
      }
      
      // Convert axial to world position for rendering
      const worldPos = HEX_UTILS.hexToWorld(hex.q, hex.r, hexSize);
      // Center the grid by subtracting center hex's position
      // This ensures the center hex is at (0, 0) in world space
      
      const instance = baseMesh.createInstance(`tile_${hex.q}_${hex.r}`);
      instance.position.x = worldPos.x - centerWorldPos.x;
      instance.position.z = worldPos.z - centerWorldPos.z;
      instance.position.y = hexHeight / 2;
      
      instances.push(instance);
      renderedCount += 1;
    }
    
    // Debug: Log actual rendered count
    if (addLogEntry !== null) {
      const logFn = addLogEntry;
      logFn(`Rendering: Actually rendered ${renderedCount} tiles`, 'info');
    }
    
    // Log grid statistics
    if (WASM_BABYLON_WFC.wasmModule && addLogEntry !== null) {
      const logEntryFn: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void = addLogEntry;
      try {
        // Calculate expected hexagon tile count
        const expectedHexagonTiles = 3 * renderMaxLayer * (renderMaxLayer + 1) + 1;
        logEntryFn(`Stats: Expected hexagon tiles: ${expectedHexagonTiles} (layer ${renderMaxLayer})`, 'info');
        
        // Get WASM stats (from hash map)
        const statsJson = WASM_BABYLON_WFC.wasmModule.get_stats();
        const parsed: unknown = JSON.parse(statsJson);
        
        // Validate the structure without type casting
        // Check that parsed is an object with all required numeric properties
        if (typeof parsed === 'object' && parsed !== null) {
          // Extract and validate each property individually
          const parsedObj = parsed;
          let grassValue: number | undefined;
          let buildingValue: number | undefined;
          let roadValue: number | undefined;
          let forestValue: number | undefined;
          let waterValue: number | undefined;
          let totalValue: number | undefined;
          
          if ('grass' in parsedObj) {
            const val = parsedObj.grass;
            if (typeof val === 'number') {
              grassValue = val;
            }
          }
          if ('building' in parsedObj) {
            const val = parsedObj.building;
            if (typeof val === 'number') {
              buildingValue = val;
            }
          }
          if ('road' in parsedObj) {
            const val = parsedObj.road;
            if (typeof val === 'number') {
              roadValue = val;
            }
          }
          if ('forest' in parsedObj) {
            const val = parsedObj.forest;
            if (typeof val === 'number') {
              forestValue = val;
            }
          }
          if ('water' in parsedObj) {
            const val = parsedObj.water;
            if (typeof val === 'number') {
              waterValue = val;
            }
          }
          if ('total' in parsedObj) {
            const val = parsedObj.total;
            if (typeof val === 'number') {
              totalValue = val;
            }
          }
          
          if (
            typeof grassValue === 'number' &&
            typeof buildingValue === 'number' &&
            typeof roadValue === 'number' &&
            typeof forestValue === 'number' &&
            typeof waterValue === 'number' &&
            typeof totalValue === 'number'
          ) {
            // WASM stats (from hash map)
            const wasmStats = {
              grass: grassValue,
              building: buildingValue,
              road: roadValue,
              forest: forestValue,
              water: waterValue,
              total: totalValue,
            };
            
            // Log WASM stats
            logEntryFn(`Stats: WASM total: ${wasmStats.total} tiles`, 'info');
            
            // Get filtered hexagon stats (only counts hexagon tiles)
            const hexagonStats = getHexagonStats(renderMaxLayer, renderCenterQ, renderCenterR);
            
            if (hexagonStats) {
              logEntryFn(`Stats: Hexagon filtered total: ${hexagonStats.total} tiles (expected: ${expectedHexagonTiles})`, 'info');
              
              // Log filtered stats (hexagon tiles only)
              const statsMessage = `Grid Stats (Hexagon Only): Grass: ${hexagonStats.grass}, Building: ${hexagonStats.building}, Road: ${hexagonStats.road}, Forest: ${hexagonStats.forest}, Water: ${hexagonStats.water}, Total: ${hexagonStats.total}`;
              logEntryFn(statsMessage, 'info');
              
              // Log comparison
              logEntryFn(`Stats Comparison: WASM: ${wasmStats.total}, Hexagon (filtered): ${hexagonStats.total}, Expected: ${expectedHexagonTiles}`, 'info');
            } else {
              logEntryFn('Failed to get hexagon stats: WASM module unavailable', 'warning');
            }
          } else {
            logEntryFn('Invalid stats structure from WASM', 'warning');
          }
        } else {
          logEntryFn('Invalid stats structure from WASM', 'warning');
        }
        } catch (error) {
          // If stats parsing fails, log error but don't break rendering
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          logEntryFn(`Failed to get grid stats: ${errorMsg}`, 'warning');
      }
    }
  };
  
  // Initial render
  renderGrid();
  
  // Set up Babylon 2D UI
  const advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI('UI');
  
  // Recompute button
  const recomputeButton = Button.CreateSimpleButton('recomputeButton', 'Recompute Wave Collapse');
  recomputeButton.width = '200px';
  recomputeButton.height = '40px';
  recomputeButton.color = 'white';
  recomputeButton.background = 'green';
  recomputeButton.top = '10px';
  recomputeButton.left = '10px';
  recomputeButton.onPointerClickObservable.add(() => {
    if (WASM_BABYLON_WFC.wasmModule) {
      renderGrid();
    }
  });
  advancedTexture.addControl(recomputeButton);
  
  // Fullscreen button
  const fullscreenButton = Button.CreateSimpleButton('fullscreenButton', 'Fullscreen');
  fullscreenButton.width = '150px';
  fullscreenButton.height = '40px';
  fullscreenButton.color = 'white';
  fullscreenButton.background = 'blue';
  fullscreenButton.top = '10px';
  fullscreenButton.left = '220px';
  fullscreenButton.onPointerClickObservable.add(() => {
    engine.enterFullscreen(false);
  });
  advancedTexture.addControl(fullscreenButton);
  
  // Exit fullscreen button (initially hidden)
  const exitFullscreenButton = Button.CreateSimpleButton('exitFullscreenButton', 'Exit Fullscreen');
  exitFullscreenButton.width = '150px';
  exitFullscreenButton.height = '40px';
  exitFullscreenButton.color = 'white';
  exitFullscreenButton.background = 'red';
  exitFullscreenButton.top = '10px';
  exitFullscreenButton.left = '220px';
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
};

