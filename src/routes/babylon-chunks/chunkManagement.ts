/**
 * Chunk Management Module
 * 
 * Handles chunk-based tile management for hexagonal grid layouts.
 * Each chunk contains tiles arranged in rings around a central position.
 */

import type { TileType } from '../../types';
import * as HexUtils from './hexUtils';
import type { InstancedMesh } from '@babylonjs/core';

/**
 * Tile entry in a chunk's grid
 */
export interface ChunkTile {
  hex: HexUtils.HexCoord;
  tileType: TileType | null;
  enabled: boolean;
  meshInstance: InstancedMesh | null;
}

/**
 * Chunk class representing a collection of tiles in rings around a central position
 */
export class Chunk {
  private grid: Array<ChunkTile>;
  private positionHex: HexUtils.HexCoord;
  private positionCartesian: { x: number; z: number };
  private enabled: boolean;
  private neighbors: Array<HexUtils.HexCoord>;
  /**
   * Whether this chunk's tiles have been generated and cached
   * Once true, the chunk's tile composition should never change
   */
  private tilesGenerated: boolean = false;

  /**
   * Create a new chunk
   * @param positionHex - Central cell position in hex space (q, r)
   * @param rings - Number of rings around the center
   * @param hexSize - Size of hexagon for coordinate conversion
   */
  constructor(
    positionHex: HexUtils.HexCoord,
    rings: number,
    hexSize: number
  ) {
    this.positionHex = positionHex;
    this.enabled = true;
    
    // Convert hex position to Cartesian for absolute positioning
    const worldPos = HexUtils.HEX_UTILS.hexToWorld(positionHex.q, positionHex.r, hexSize);
    this.positionCartesian = { x: worldPos.x, z: worldPos.z };
    
    // Generate grid in rings around the central position
    const hexGrid = HexUtils.HEX_UTILS.generateHexGrid(rings, positionHex.q, positionHex.r);
    
    // Validate that all generated tiles are within the ring count
    const validatedGrid: Array<ChunkTile> = [];
    for (const hex of hexGrid) {
      const distance = HexUtils.HEX_UTILS.distance(positionHex.q, positionHex.r, hex.q, hex.r);
      if (distance <= rings) {
        validatedGrid.push({
          hex,
          tileType: null,
          enabled: true,
          meshInstance: null,
        });
      }
    }
    
    this.grid = validatedGrid;
    
    // Compute neighbor chunk positions
    // For chunks to be packed without gaps or overlap:
    // - A chunk with 'rings' rings contains tiles from distance 0 to 'rings' from its center
    // - Neighbor chunk centers are calculated using offset vector (rings, rings+1) rotated 6 times
    // - This ensures chunks touch at their boundaries: origin's outer boundary (distance 'rings') 
    //   is adjacent to neighbor's outer boundary (distance 'rings' from neighbor center)
    // - For rings=0: uses offset (1, 0) rotated 6 times (distance 1 neighbors)
    // - For rings=1: uses offset (1, 2) rotated 6 times (distance 3 neighbors)
    // - For rings=2: uses offset (2, 3) rotated 6 times (distance 5 neighbors)
    this.neighbors = this.calculateChunkNeighbors(positionHex, rings);
  }

  /**
   * Get the chunk's grid of tiles
   */
  getGrid(): Array<ChunkTile> {
    return this.grid;
  }

  /**
   * Get the chunk's central position in hex space
   */
  getPositionHex(): HexUtils.HexCoord {
    return this.positionHex;
  }

  /**
   * Get the chunk's absolute position in Cartesian space
   */
  getPositionCartesian(): { x: number; z: number } {
    return this.positionCartesian;
  }

  /**
   * Get whether the chunk's tiles are enabled
   */
  getEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the chunk's neighbor positions
   */
  getNeighbors(): Array<HexUtils.HexCoord> {
    return this.neighbors;
  }

  /**
   * Calculate chunk neighbor positions using offset vector rotation
   * Returns exactly 6 neighbor hex coordinates, one in each of the 6 directions
   * 
   * Uses the offset vector (rings, rings+1) for rings>0, or (1, 0) for rings=0, and rotates
   * it 60 degrees counter-clockwise 6 times. This ensures chunks are packed without gaps - 
   * each direction has exactly one neighbor. The outer boundaries of adjacent chunks touch.
   * 
   * The rotation formula in axial coordinates: (q, r) -> (-r, q+r)
   * This produces neighbors at distance 2*rings+1 (or distance 1 for rings=0).
   * 
   * @param center - Center hex coordinate
   * @param rings - Number of rings in the chunk
   * @returns Array of exactly 6 neighbor hex coordinates
   */
  private calculateChunkNeighbors(center: HexUtils.HexCoord, rings: number): Array<HexUtils.HexCoord> {
    const neighbors: Array<HexUtils.HexCoord> = [];
    
    // Base offset vector: (rings, rings+1) for rings>0, or (1, 0) for rings=0
    let offsetQ: number;
    let offsetR: number;
    if (rings === 0) {
      offsetQ = 1;
      offsetR = 0;
    } else {
      offsetQ = rings;
      offsetR = rings + 1;
    }
    
    // Rotate the starting offset by -120 degrees (4 steps clockwise) to correct angular alignment
    // This compensates for the 120-degree offset in the coordinate system
    let currentQ = offsetQ;
    let currentR = offsetR;
    for (let i = 0; i < 4; i++) {
      const nextQ = currentQ + currentR;
      const nextR = -currentQ;
      currentQ = nextQ;
      currentR = nextR;
    }
    
    // Rotate the offset vector 60 degrees clockwise 6 times
    // Rotation formula in axial coordinates for clockwise: (q, r) -> (q+r, -q)
    // Note: Using clockwise rotation for right-handed coordinate system (BabylonJS)
    
    for (let i = 0; i < 6; i++) {
      // Add the current offset to the center
      neighbors.push({ q: center.q + currentQ, r: center.r + currentR });
      
      // Rotate 60 degrees clockwise: (q, r) -> (q+r, -q)
      const nextQ = currentQ + currentR;
      const nextR = -currentQ;
      currentQ = nextQ;
      currentR = nextR;
    }

    return neighbors;
  }

  /**
   * Set the enabled state of the chunk's tiles
   * Iterates over all tiles in the chunk's grid and sets their enabled state
   * Calls mesh.setEnabled() on each tile's mesh instance
   * 
   * @param enabled - Whether to enable or disable all tiles in this chunk
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    
    // Iterate over all tiles in the chunk's grid and set their enabled state
    for (const tile of this.grid) {
      tile.enabled = enabled;
      
      // Set enabled state on the mesh instance if it exists
      if (tile.meshInstance) {
        tile.meshInstance.setEnabled(enabled);
      }
    }
  }

  /**
   * Set tile type for a specific hex coordinate in this chunk
   */
  setTileType(hex: HexUtils.HexCoord, tileType: TileType | null): void {
    const tile = this.grid.find((t) => t.hex.q === hex.q && t.hex.r === hex.r);
    if (tile) {
      tile.tileType = tileType;
    }
  }

  /**
   * Get tile type for a specific hex coordinate in this chunk
   */
  getTileType(hex: HexUtils.HexCoord): TileType | null {
    const tile = this.grid.find((t) => t.hex.q === hex.q && t.hex.r === hex.r);
    return tile ? tile.tileType : null;
  }

  /**
   * Check if this chunk's tiles have been generated and cached
   * Once tiles are generated, the chunk's composition should remain stable
   */
  getTilesGenerated(): boolean {
    return this.tilesGenerated;
  }

  /**
   * Mark this chunk's tiles as generated
   * This ensures the chunk's composition will remain stable
   */
  setTilesGenerated(generated: boolean): void {
    this.tilesGenerated = generated;
  }

  /**
   * Check if all tiles in this chunk have their tile types set
   */
  hasAllTilesGenerated(): boolean {
    for (const tile of this.grid) {
      if (tile.tileType === null) {
        return false;
      }
    }
    return true;
  }
}

/**
 * WorldMap class managing all chunks in the world
 */
export class WorldMap {
  private chunks: globalThis.Map<string, Chunk>;
  /**
   * Spatial index mapping hex coordinates to chunk positions for O(1) lookup
   * Key: hex coordinate string "q,r"
   * Value: chunk position hex coordinate
   */
  private spatialIndex: globalThis.Map<string, HexUtils.HexCoord>;

  constructor() {
    this.chunks = new globalThis.Map<string, Chunk>();
    this.spatialIndex = new globalThis.Map<string, HexUtils.HexCoord>();
  }

  /**
   * Get a chunk key string from hex coordinates
   */
  private getChunkKey(positionHex: HexUtils.HexCoord): string {
    return `${positionHex.q},${positionHex.r}`;
  }

  /**
   * Get a chunk by its position in hex space
   */
  getChunk(positionHex: HexUtils.HexCoord): Chunk | undefined {
    const key = this.getChunkKey(positionHex);
    return this.chunks.get(key);
  }

  /**
   * Create a new chunk at the specified position
   * If chunk already exists, returns the existing chunk (never re-creates)
   * @param positionHex - Central cell position in hex space (q, r)
   * @param rings - Number of rings around the center
   * @param hexSize - Size of hexagon for coordinate conversion
   * @returns The created or existing chunk
   */
  createChunk(
    positionHex: HexUtils.HexCoord,
    rings: number,
    hexSize: number
  ): Chunk {
    const key = this.getChunkKey(positionHex);
    
    // Check if chunk already exists - never re-create existing chunks
    const existing = this.chunks.get(key);
    if (existing) {
      // Chunk already exists, return it without modification
      return existing;
    }
    
    // Create new chunk only if it doesn't exist
    const chunk = new Chunk(positionHex, rings, hexSize);
    this.chunks.set(key, chunk);
    
    // Update spatial index: add all tiles in this chunk to the index
    const chunkGrid = chunk.getGrid();
    for (const tile of chunkGrid) {
      const tileKey = `${tile.hex.q},${tile.hex.r}`;
      this.spatialIndex.set(tileKey, positionHex);
    }
    
    return chunk;
  }

  /**
   * Get all instantiated chunks
   */
  getAllChunks(): Array<Chunk> {
    return Array.from(this.chunks.values());
  }

  /**
   * Get all enabled chunks
   */
  getEnabledChunks(): Array<Chunk> {
    return this.getAllChunks().filter((chunk) => chunk.getEnabled());
  }

  /**
   * Check if a chunk exists at the specified position
   */
  hasChunk(positionHex: HexUtils.HexCoord): boolean {
    const key = this.getChunkKey(positionHex);
    return this.chunks.has(key);
  }

  /**
   * Get the number of chunks
   */
  getChunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Get chunk position for a given tile using spatial index (O(1) lookup)
   * @param tileHex - Hex coordinate of the tile
   * @param rings - Number of rings per chunk (for validation)
   * @returns Chunk position that contains the tile, or null if not found
   */
  getChunkForTileFast(tileHex: HexUtils.HexCoord, rings: number): HexUtils.HexCoord | null {
    const tileKey = `${tileHex.q},${tileHex.r}`;
    const chunkPos = this.spatialIndex.get(tileKey);
    
    if (!chunkPos) {
      return null;
    }
    
    // Verify the tile is actually within the chunk's boundary
    const chunk = this.getChunk(chunkPos);
    if (!chunk) {
      // Chunk was removed but index wasn't updated - clean up
      this.spatialIndex.delete(tileKey);
      return null;
    }
    
    const distance = HexUtils.HEX_UTILS.distance(
      tileHex.q,
      tileHex.r,
      chunkPos.q,
      chunkPos.r
    );
    
    if (distance <= rings) {
      return chunkPos;
    }
    
    // Tile is in index but outside chunk boundary - index may be stale
    return null;
  }

  /**
   * Remove a chunk and update spatial index
   * @param positionHex - Chunk position to remove
   */
  removeChunk(positionHex: HexUtils.HexCoord): void {
    const key = this.getChunkKey(positionHex);
    const chunk = this.chunks.get(key);
    
    if (!chunk) {
      return;
    }
    
    // Remove all tiles from spatial index
    const chunkGrid = chunk.getGrid();
    for (const tile of chunkGrid) {
      const tileKey = `${tile.hex.q},${tile.hex.r}`;
      // Only remove if this chunk owns the tile (check if index points to this chunk)
      const indexedChunk = this.spatialIndex.get(tileKey);
      if (indexedChunk && indexedChunk.q === positionHex.q && indexedChunk.r === positionHex.r) {
        this.spatialIndex.delete(tileKey);
      }
    }
    
    // Remove chunk
    this.chunks.delete(key);
  }
}

/**
 * Determine which chunk contains a given tile
 * A tile belongs to the chunk whose center is closest to the tile and within the chunk's boundary.
 * 
 * This function uses a spatial index if available (via WorldMap), otherwise falls back to linear search.
 * 
 * @param tileHex - Hex coordinate of the tile
 * @param rings - Number of rings per chunk
 * @param existingChunks - Array of existing chunks to check (used as fallback)
 * @param worldMap - Optional WorldMap instance for fast lookup via spatial index
 * @returns Chunk position (hex coordinate) that contains the tile, or null if no chunk found
 */
export function getChunkForTile(
  tileHex: HexUtils.HexCoord,
  rings: number,
  existingChunks: Array<Chunk>,
  worldMap?: WorldMap
): HexUtils.HexCoord | null {
  // Use fast spatial index lookup if WorldMap is provided
  if (worldMap) {
    const result = worldMap.getChunkForTileFast(tileHex, rings);
    if (result) {
      return result;
    }
    // If spatial index lookup fails, fall through to linear search
    // This handles edge cases where index might be stale
  }

  // Fallback to linear search through all chunks
  if (existingChunks.length === 0) {
    return null;
  }

  let closestChunk: HexUtils.HexCoord | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  // First, check if the tile itself is a chunk center (distance 0)
  // In this case, the chunk position should match the tile position
  for (const chunk of existingChunks) {
    const chunkPos = chunk.getPositionHex();
    const distance = HexUtils.HEX_UTILS.distance(tileHex.q, tileHex.r, chunkPos.q, chunkPos.r);

    // If tile is exactly at chunk center, return immediately
    if (distance === 0) {
      return chunkPos;
    }

    // Check if tile is within this chunk's boundary (distance <= rings)
    if (distance <= rings) {
      // If multiple chunks contain this tile (overlap at boundaries), prefer the closest center
      if (distance < minDistance) {
        minDistance = distance;
        closestChunk = chunkPos;
      }
    }
  }

  // If we found a chunk that contains the tile, return it
  if (closestChunk !== null) {
    return closestChunk;
  }

  // No chunk contains this tile (all chunks are at distance > rings)
  return null;
}

/**
 * Calculate chunk radius for distance threshold calculations
 * The chunk radius is the distance from chunk center to the outer boundary
 * 
 * @param rings - Number of rings per chunk
 * @returns Chunk radius in hex distance units
 */
export function calculateChunkRadius(rings: number): number {
  // The chunk radius is simply the number of rings
  // This represents the maximum hex distance from center to outer boundary
  return rings;
}

