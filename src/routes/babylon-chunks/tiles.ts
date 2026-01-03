/**
 * Tiles Configuration Module
 * 
 * Centralized configuration for tile types, model URLs, and visual properties.
 * Users can easily define custom tile types and their associated models.
 */

import { Color3 } from '@babylonjs/core';
import type { TileType } from '../../types';

/**
 * Configuration for a single tile type
 */
export interface TileConfig {
  /**
   * The tile type identifier (must match TileType union)
   */
  type: TileType['type'];
  
  /**
   * URL to the GLB/GLTF model file for this tile type
   * If not provided, uses the default model URL
   */
  modelUrl?: string;
  
  /**
   * Color for this tile type (RGB values 0-1)
   */
  color: { r: number; g: number; b: number };
  
  /**
   * WASM number mapping for this tile type
   * This must match the Rust WASM module's tile type numbering
   */
  wasmNumber: number;
  
  /**
   * Display name for this tile type (optional, defaults to type)
   */
  displayName?: string;
}

/**
 * Default model URL for hex tiles
 * This is used when a tile type doesn't specify its own modelUrl
 * Currently all tile types use this same URL, but in the future each type can have its own
 */
export const DEFAULT_TILE_MODEL_URL = 'https://raw.githubusercontent.com/EricEisaman/assets/main/items/hex_tile.glb';

/**
 * Tiles configuration object
 * 
 * Users can modify this object to:
 * - Add custom tile types
 * - Change model URLs for specific tile types
 * - Adjust colors for visual appearance
 * - Map tile types to WASM numbers
 * 
 * Example usage:
 * ```typescript
 * // Add a new tile type
 * TILES.custom = {
 *   type: 'custom',
 *   modelUrl: 'https://example.com/custom_tile.glb',
 *   color: { r: 0.5, g: 0.5, b: 0.5 },
 *   wasmNumber: 5,
 *   displayName: 'Custom Tile'
 * };
 * ```
 */
export const TILES: Record<TileType['type'], TileConfig> = {
  grass: {
    type: 'grass',
    color: { r: 0.2, g: 0.8, b: 0.2 }, // Green
    wasmNumber: 0,
    displayName: 'Grass',
  },
  building: {
    type: 'building',
    color: { r: 0.96, g: 0.96, b: 0.96 }, // Off-white
    wasmNumber: 1,
    displayName: 'Building',
  },
  road: {
    type: 'road',
    color: { r: 0.326, g: 0.336, b: 0.326 }, // Very dark gray
    wasmNumber: 2,
    displayName: 'Road',
  },
  forest: {
    type: 'forest',
    color: { r: 0.05, g: 0.3, b: 0.05 }, // Dark green
    wasmNumber: 3,
    displayName: 'Forest',
  },
  water: {
    type: 'water',
    color: { r: 0, g: 0.149, b: 1.0 }, // Bright brilliant blue
    wasmNumber: 4,
    displayName: 'Water',
  },
} as const;

/**
 * Get the model URL for a tile type
 * Returns the tile-specific URL if provided, otherwise returns the default URL
 */
export function getTileModelUrl(tileType: TileType['type']): string {
  const tileConfig = TILES[tileType];
  return tileConfig?.modelUrl ?? DEFAULT_TILE_MODEL_URL;
}

/**
 * Get the color for a tile type as a Color3 object
 */
export function getTileColor(tileType: TileType): Color3 {
  const tileConfig = TILES[tileType.type];
  if (tileConfig) {
    return new Color3(tileConfig.color.r, tileConfig.color.g, tileConfig.color.b);
  }
  // Fallback to white if tile type not found
  return new Color3(1, 1, 1);
}

/**
 * Get the WASM number for a tile type
 */
export function getTileWasmNumber(tileType: TileType['type']): number {
  const tileConfig = TILES[tileType];
  return tileConfig?.wasmNumber ?? -1;
}

/**
 * Get all tile types as an array
 */
export function getAllTileTypes(): Array<TileType> {
  return Object.keys(TILES).map((type) => ({ type: type as TileType['type'] }));
}

/**
 * Get tile config for a specific tile type
 */
export function getTileConfig(tileType: TileType['type']): TileConfig | undefined {
  return TILES[tileType];
}

