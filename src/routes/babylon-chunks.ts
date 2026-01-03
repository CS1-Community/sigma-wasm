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

import type { LayoutConstraints } from '../types';
import { WasmLoadError, WasmInitError } from '../wasm/types';
import { WasmManager } from './babylon-chunks/wasmManagement';
import { PatternCacheManager } from './babylon-chunks/dbManagement';
import { LlmManager } from './babylon-chunks/llmManagement';
import { CanvasManager } from './babylon-chunks/canvasManagement';
import { generateLayoutFromText, constraintsToPreConstraints } from './babylon-chunks/layoutGeneration';
import { WorldMap, getChunkForTile, calculateChunkRadius } from './babylon-chunks/chunkManagement';
import { TILE_CONFIG } from './babylon-chunks/canvasManagement';
import { Player } from './babylon-chunks/player';
import * as HexUtils from './babylon-chunks/hexUtils';

/**
 * Runtime Configuration
 */
type ConfigMode = 'normal' | 'test';

const CONFIG: { mode: ConfigMode } = {
  mode: 'normal',
};

/**
 * Log Mode Configuration
 */
type LogMode = 'minimal' | 'verbose' | 'disabled';

let currentLogMode: LogMode = 'minimal';
let isInitializationPhase = true;

/**
 * Result of finding nearest neighbor chunk
 */
interface NearestNeighborResult {
  neighbor: HexUtils.HexCoord;
  distance: number;
  isInstantiated: boolean;
}

/**
 * Calculate chunk neighbor positions given a center and rings
 * Uses the same logic as Chunk.calculateChunkNeighbors but as a standalone function
 */
function calculateChunkNeighbors(center: HexUtils.HexCoord, rings: number): Array<HexUtils.HexCoord> {
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
 * Find the immediate neighbor chunk of the current chunk that is nearest to the current tile
 * Only considers the 6 immediate neighbors of the current chunk
 * @param currentChunkHex - Hex coordinate of current chunk
 * @param worldMap - World map instance
 * @param currentTileHex - Hex coordinate of current tile
 * @param rings - Number of rings per chunk (needed for chunk spacing calculation)
 * @returns Nearest neighbor chunk info, or null if no neighbor found
 */
function findNearestNeighborChunk(
  currentChunkHex: HexUtils.HexCoord,
  worldMap: WorldMap,
  currentTileHex: HexUtils.HexCoord,
  rings: number
): NearestNeighborResult | null {
  // Get the 6 immediate neighbors of the current chunk
  const immediateNeighbors = calculateChunkNeighbors(currentChunkHex, rings);
  
  if (immediateNeighbors.length === 0) {
    return null;
  }

  let nearestNeighbor: HexUtils.HexCoord | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  // Find which of the immediate neighbors is closest to the current tile (in hex distance)
  for (const neighborPos of immediateNeighbors) {
    const hexDistance = HexUtils.HEX_UTILS.distance(
      currentTileHex.q,
      currentTileHex.r,
      neighborPos.q,
      neighborPos.r
    );

    if (hexDistance < minDistance) {
      minDistance = hexDistance;
      nearestNeighbor = neighborPos;
    }
  }

  if (!nearestNeighbor) {
    return null;
  }

  // Convert hex distance to world distance for the return value
  const neighborWorldPos = HexUtils.HEX_UTILS.hexToWorld(
    nearestNeighbor.q,
    nearestNeighbor.r,
    TILE_CONFIG.hexSize
  );
  const tileWorldPos = HexUtils.HEX_UTILS.hexToWorld(
    currentTileHex.q,
    currentTileHex.r,
    TILE_CONFIG.hexSize
  );
  const dx = tileWorldPos.x - neighborWorldPos.x;
  const dz = tileWorldPos.z - neighborWorldPos.z;
  const worldDistance = Math.sqrt(dx * dx + dz * dz);

  return {
    neighbor: nearestNeighbor,
    distance: worldDistance,
    isInstantiated: worldMap.hasChunk(nearestNeighbor),
  };
}

/**
 * Cache for distance checking optimization
 * Stores the last current chunk and max distance to avoid recalculating when unchanged
 */
interface DistanceCheckCache {
  lastChunkHex: HexUtils.HexCoord | null;
  maxDistance: number;
  lastChunkCount: number;
}

const distanceCheckCache: DistanceCheckCache = {
  lastChunkHex: null,
  maxDistance: 0,
  lastChunkCount: 0,
};

/**
 * Disable chunks that are more than 4 chunk radius away from the current chunk
 * All chunks, including the origin chunk, are subject to the distance threshold
 * Uses caching to avoid recalculating when current chunk hasn't changed
 * @param currentChunkHex - Hex coordinate of current chunk
 * @param worldMap - World map instance
 * @param rings - Number of rings per chunk
 * @param logFn - Optional logging function
 * @returns true if any chunks were disabled or re-enabled, false otherwise
 */
function disableDistantChunks(
  currentChunkHex: HexUtils.HexCoord,
  worldMap: WorldMap,
  rings: number,
  logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
): boolean {
  const maxDistance = 4 * calculateChunkRadius(rings);
  const allChunks = worldMap.getAllChunks();
  const currentChunkCount = allChunks.length;
  
  // Check if we can skip recalculation
  const chunkChanged = distanceCheckCache.lastChunkHex === null ||
    distanceCheckCache.lastChunkHex.q !== currentChunkHex.q ||
    distanceCheckCache.lastChunkHex.r !== currentChunkHex.r;
  
  const distanceThresholdChanged = distanceCheckCache.maxDistance !== maxDistance;
  const chunkCountChanged = distanceCheckCache.lastChunkCount !== currentChunkCount;
  
  // Only recalculate if current chunk changed, distance threshold changed, or chunks were added/removed
  if (!chunkChanged && !distanceThresholdChanged && !chunkCountChanged) {
    return false; // No changes needed
  }
  
  // Update cache
  distanceCheckCache.lastChunkHex = { q: currentChunkHex.q, r: currentChunkHex.r };
  distanceCheckCache.maxDistance = maxDistance;
  distanceCheckCache.lastChunkCount = currentChunkCount;
  
  let disabledCount = 0;
  let reEnabledCount = 0;

  for (const chunk of allChunks) {
    const chunkPos = chunk.getPositionHex();
    
    // Early exit: if chunk is already disabled and we're checking the same chunk,
    // we can skip distance calculation for chunks that were already beyond threshold
    // However, we still need to check in case they moved back into range
    const distance = HexUtils.HEX_UTILS.distance(
      currentChunkHex.q,
      currentChunkHex.r,
      chunkPos.q,
      chunkPos.r
    );

    if (distance > maxDistance) {
      if (chunk.getEnabled()) {
        chunk.setEnabled(false);
        disabledCount++;
        if (logFn) {
          logFn(`Disabled distant chunk at (${chunkPos.q}, ${chunkPos.r}) - distance: ${distance.toFixed(2)}, max: ${maxDistance.toFixed(2)}`, 'info');
        }
      }
    } else {
      // Re-enable chunks that are within range
      if (!chunk.getEnabled()) {
        chunk.setEnabled(true);
        reEnabledCount++;
        if (logFn) {
          logFn(`Re-enabled chunk at (${chunkPos.q}, ${chunkPos.r}) - distance: ${distance.toFixed(2)}`, 'info');
        }
      }
    }
  }

  const anyChanges = disabledCount > 0 || reEnabledCount > 0;

  if (logFn && disabledCount > 0) {
    logFn(`Disabled ${disabledCount} distant chunks (beyond ${maxDistance.toFixed(2)} hex distance)`, 'info');
  }

  return anyChanges;
}

/**
 * Ensure the nearest neighbor chunk is instantiated and visible if within threshold
 * @param currentChunkHex - Hex coordinate of current chunk
 * @param worldMap - World map instance
 * @param currentTileHex - Hex coordinate of current tile
 * @param rings - Number of rings per chunk
 * @param hexSize - Size of hexagon for coordinate conversion
 * @param logFn - Optional logging function
 * @returns true if a re-render is needed, false otherwise
 */
function ensureNearestNeighborChunkIsVisible(
  currentChunkHex: HexUtils.HexCoord,
  worldMap: WorldMap,
  currentTileHex: HexUtils.HexCoord,
  rings: number,
  hexSize: number,
  logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
): boolean {
  const chunkRadius = calculateChunkRadius(rings);
  const threshold = chunkRadius * 3;
  const thresholdWorld = threshold * hexSize * 1.5;
  
  const nearestNeighbor = findNearestNeighborChunk(
    currentChunkHex,
    worldMap,
    currentTileHex,
    rings
  );
  
  if (!nearestNeighbor || nearestNeighbor.distance > thresholdWorld) {
    return false;
  }
  
  // Check if chunk is instantiated (exists in world map)
  if (!nearestNeighbor.isInstantiated) {
    // Chunk doesn't exist - create it
    const newChunk = worldMap.createChunk(
      nearestNeighbor.neighbor,
      rings,
      hexSize
    );
    
    // Verify chunk was created correctly
    const chunkExists = worldMap.hasChunk(nearestNeighbor.neighbor);
    const chunkGrid = newChunk.getGrid();
    const chunkWorldPos = newChunk.getPositionCartesian();
    
    if (logFn) {
      logFn(`Instantiated nearest neighbor chunk at (${nearestNeighbor.neighbor.q}, ${nearestNeighbor.neighbor.r})`, 'info');
      logFn(`Chunk verification: exists=${chunkExists}, enabled=${newChunk.getEnabled()}, tiles=${chunkGrid.length}`, 'info');
      logFn(`Chunk world position: (x: ${chunkWorldPos.x.toFixed(2)}, z: ${chunkWorldPos.z.toFixed(2)})`, 'info');
    }
    
    return true;
  }
  
  // Chunk already exists - just ensure it's enabled
  const neighborChunk = worldMap.getChunk(nearestNeighbor.neighbor);
  if (neighborChunk && !neighborChunk.getEnabled()) {
    neighborChunk.setEnabled(true);
    if (logFn) {
      logFn(`Enabled nearest neighbor chunk at (${nearestNeighbor.neighbor.q}, ${nearestNeighbor.neighbor.r})`, 'info');
    }
    return true;
  }
  
  return false;
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
  
  // Setup logging with mode filtering
  let addLogEntry: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null = null;
  if (systemLogsContentEl) {
    const baseLogFn = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.textContent = `[${timestamp}] ${message}`;
      systemLogsContentEl.appendChild(logEntry);
      systemLogsContentEl.scrollTop = systemLogsContentEl.scrollHeight;
    };

    // Wrapper that filters logs based on mode
    addLogEntry = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
      // Disabled mode: no logging
      if (currentLogMode === 'disabled') {
        return;
      }

      // Minimal mode: only log during initialization
      if (currentLogMode === 'minimal') {
        if (!isInitializationPhase) {
          return;
        }
      }

      // Verbose mode: log everything except chunk grid tile looping logs
      if (currentLogMode === 'verbose') {
        // Skip logs that involve looping over chunk grid tiles
        if (message.includes('checked') && message.includes('tiles, found')) {
          return; // Skip: "Chunk at (q, r): checked X tiles, found Y"
        }
        if (message.includes('tiles in render') && (message.includes('of') || message.includes('WARNING'))) {
          return; // Skip: "Chunk (q, r) tiles in render (X of Y):" and "WARNING: Chunk has no tiles in render!"
        }
        if (message.includes('tile at hex') && message.includes('-> world')) {
          return; // Skip: "tile at hex (q, r) -> world (x, z)"
        }
        if (message.includes('first tile at hex') || message.includes('last tile')) {
          return; // Skip: "Chunk (q, r) first tile at hex..."
        }
        if (message.includes('Chunk grid:')) {
          return; // Skip chunk grid tile logs
        }
        if (message.includes('Iterate over') || message.includes('ALL tiles')) {
          return; // Skip iteration logs
        }
      }

      baseLogFn(message, type);
    };
  }

  // Wire up log mode select
  const logModeSelectEl = document.getElementById('logModeSelect');
  if (logModeSelectEl && logModeSelectEl instanceof HTMLSelectElement) {
    logModeSelectEl.addEventListener('change', () => {
      const value = logModeSelectEl.value;
      if (value === 'minimal' || value === 'verbose' || value === 'disabled') {
        currentLogMode = value;
      }
    });
  }

  // Initialize modules with dependency injection
  const wasmManager = new WasmManager();
  const llmManager = new LlmManager(addLogEntry ?? undefined);
  const patternCache = new PatternCacheManager(
    addLogEntry ?? undefined,
    (text: string) => llmManager.generateEmbedding(text)
  );
  
  // Get initial rings value from dropdown (default 10)
  const initialRingsSelectEl = document.getElementById('ringsSelect');
  let initialRings = 10; // Default value
  if (initialRingsSelectEl && initialRingsSelectEl instanceof HTMLSelectElement) {
    const selectedRings = Number.parseInt(initialRingsSelectEl.value, 10);
    if (!Number.isNaN(selectedRings) && selectedRings >= 0 && selectedRings <= 50) {
      initialRings = selectedRings;
    }
  }
  
  const canvasManager = new CanvasManager(wasmManager, addLogEntry ?? undefined, undefined, CONFIG.mode === 'test');
  canvasManager.setCurrentRings(initialRings);

  // Set up pre-constraints generation function for canvas manager
  canvasManager.setGeneratePreConstraintsFn((constraints: LayoutConstraints) => {
    const wasmModule = wasmManager.getModule();
    if (!wasmModule) {
      return [];
    }
    return constraintsToPreConstraints(
      constraints,
      wasmModule,
      canvasManager.getCurrentRings(),
      (rings) => canvasManager.setCurrentRings(rings),
      addLogEntry ?? undefined
    );
  });

  // Initialize pattern cache in background (non-blocking)
  void patternCache.initializeCommonPatterns().catch((error) => {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (addLogEntry) {
      addLogEntry(`Pattern cache initialization failed: ${errorMsg}`, 'warning');
    }
  });
  
  // Initialize WASM module
  try {
    await wasmManager.initialize();
    
    // Log WASM version for debugging and cache verification
    const wasmModule = wasmManager.getModule();
    if (wasmModule && addLogEntry) {
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
  
  // Initialize canvas manager
  await canvasManager.initialize(canvas);
  
  // Set initial background color from dropdown
  const initialBackgroundColorSelectEl = document.getElementById('backgroundColorSelect');
  if (initialBackgroundColorSelectEl && initialBackgroundColorSelectEl instanceof HTMLSelectElement) {
    canvasManager.setBackgroundColor(initialBackgroundColorSelectEl.value);
  }
  
  // Create map for chunk management
  const worldMap = new WorldMap();
  
  // Create origin chunk at (0, 0)
  const originPosition = { q: 0, r: 0 };
  const originChunk = worldMap.createChunk(
    originPosition,
    canvasManager.getCurrentRings(),
    TILE_CONFIG.hexSize
  );
  
  // Compute neighbors for origin chunk (already computed in constructor)
  if (addLogEntry) {
    const neighbors = originChunk.getNeighbors();
    addLogEntry(`Origin chunk created at (0, 0) with ${neighbors.length} neighbors`, 'info');
    for (const neighbor of neighbors) {
      addLogEntry(`Origin chunk neighbor: (${neighbor.q}, ${neighbor.r})`, 'info');
    }
  }
  
  // Always create player instance (will be disabled in test mode)
  const scene = canvasManager.getScene();
  let player: Player | null = null;
  if (scene) {
    player = new Player(scene);
    const avatarUrl = 'https://raw.githubusercontent.com/EricEisaman/assets/main/items/arrow.glb';
    await player.initialize(avatarUrl);
    
    // Log avatar instantiation with position and rotation
    if (addLogEntry) {
      const avatar = player.getAvatar();
      const avatarMesh = avatar.getMesh();
      if (avatarMesh) {
        const pos = avatarMesh.position;
        const rot = avatarMesh.rotation;
        addLogEntry(`Avatar instantiated - position: (x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}), rotation: ${rot.y.toFixed(4)} rad`, 'info');
      }
    }
    
    // Enable/disable based on mode
    player.setEnabled(CONFIG.mode === 'normal', addLogEntry ?? undefined);
    
    // Set player reference in camera manager for follow mode
    const cameraManager = canvasManager.getCameraManager();
    if (cameraManager) {
      cameraManager.setPlayer(player);
    }
    
    // Set player reference in canvas manager for floating origin tracking
    canvasManager.setPlayer(player);
  }
  
  // Run tests if mode is test
  if (CONFIG.mode === 'test') {
    const originChunk = worldMap.getChunk(originPosition);
    if (originChunk && addLogEntry) {
      const neighbors = originChunk.getNeighbors();
      addLogEntry(`Test mode: Origin chunk has ${neighbors.length} neighbors`, 'info');
      
      // Instantiate and log the first neighbor
      if (neighbors.length > 0) {
        const firstNeighbor = neighbors[0];
        if (firstNeighbor) {
          const neighborChunk = worldMap.createChunk(
            firstNeighbor,
            canvasManager.getCurrentRings(),
            TILE_CONFIG.hexSize
          );
          const neighborPos = neighborChunk.getPositionHex();
          addLogEntry(`Test mode: Instantiated neighbor chunk at (${neighborPos.q}, ${neighborPos.r})`, 'success');
        }
      }
    }
  }
  
  // Set map in canvas manager for rendering
  canvasManager.setMap(worldMap);
  
  // Initial render
  canvasManager.renderGrid();
  
  // Mark initialization phase as complete after initial render
  isInitializationPhase = false;
  
  // Set up avatar-based chunk loading (always set up, but only active when player is enabled)
  let frameCount = 0;
  let previousTileHex: HexUtils.HexCoord | null = null;
  let currentChunkHex: HexUtils.HexCoord | null = null;
  const CHECK_INTERVAL = 20; // Check every 20 frames (approx 3 times per second at 60fps)
  
  // Single function to check and update tile/chunk - used by both UI and processing
  // currentTileHex is always obtained from player.getCurrentTileHex() - player is the source of truth
  const checkAndUpdateTile = (
    currentTileHex: HexUtils.HexCoord,
    worldMapInstance: WorldMap,
    canvasManagerInstance: CanvasManager
  ): boolean => {
    // Check if current tile has changed - compare integer coordinates exactly
    // Only process if coordinates actually differ
    const tileChanged = previousTileHex === null || 
        previousTileHex.q !== currentTileHex.q || 
        previousTileHex.r !== currentTileHex.r;
    
    if (!tileChanged) {
      // Tile hasn't changed - just update UI with current values from player
      canvasManagerInstance.updateTileChunkDisplay(currentTileHex, currentChunkHex, previousTileHex);
      return false;
    }
    
    // Tile actually changed - save previous tile
    previousTileHex = currentTileHex;
    
    // ALWAYS log when tile changes - this must happen every time tile changes
    if (addLogEntry) {
      addLogEntry(`Current tile: (${currentTileHex.q}, ${currentTileHex.r})`, 'info');
    }
    
    // Determine current chunk
    const allChunks = worldMapInstance.getAllChunks();
    const chunkForTile = getChunkForTile(
      currentTileHex,
      canvasManagerInstance.getCurrentRings(),
      allChunks,
      worldMapInstance
    );
    
    // Always set currentChunkHex if chunkForTile is found
    if (chunkForTile) {
      // Check if chunk changed
      const wasNull = currentChunkHex === null;
      const chunkChanged = wasNull ||
                           (currentChunkHex !== null && (
                             currentChunkHex.q !== chunkForTile.q ||
                             currentChunkHex.r !== chunkForTile.r
                           ));
      
      if (chunkChanged) {
        currentChunkHex = chunkForTile;
        
        // Log chunk change
        if (addLogEntry) {
          if (wasNull) {
            addLogEntry(`Initial chunk detected: (${chunkForTile.q}, ${chunkForTile.r})`, 'info');
          } else {
            addLogEntry(`Current chunk changed to (${chunkForTile.q}, ${chunkForTile.r})`, 'info');
          }
        }
      }
    }
    
    // Update UI display - use currentTileHex from player (source of truth)
    canvasManagerInstance.updateTileChunkDisplay(currentTileHex, currentChunkHex, previousTileHex);
    
    return true;
  };
  
  if (player && scene) {
    scene.onBeforeRenderObservable.add(() => {
      frameCount++;
      
      // Update player every frame (will be no-op if disabled)
      if (player) {
        player.update();
      }
      
      // Update camera manager (for follow mode)
      const cameraManager = canvasManager.getCameraManager();
      if (cameraManager) {
        cameraManager.update();
      }
      
      // Update floating origin to follow player avatar position
      // This maintains precision by keeping coordinate system centered on player
      canvasManager.updateFloatingOrigin();
      
      // Check chunk loading every CHECK_INTERVAL frames (only if player is enabled)
      if (frameCount % CHECK_INTERVAL === 0 && player && player.getEnabled()) {
        // Get current tile hex coordinate from player - player is the source of truth
        const currentTileHex = player.getCurrentTileHex(TILE_CONFIG.hexSize);
        
        // Use the same function for both UI update and processing
        const tileChanged = checkAndUpdateTile(currentTileHex, worldMap, canvasManager);
        
        // Always check all chunks for disable/enable based on distance (not just when tile changes)
        // This ensures all chunks, including origin, are properly evaluated
        let chunksChanged = false;
        if (currentChunkHex) {
          chunksChanged = disableDistantChunks(
            currentChunkHex,
            worldMap,
            canvasManager.getCurrentRings(),
            addLogEntry ?? undefined
          );
        }
        
        // Only process neighbor loading if tile actually changed
        if (tileChanged && currentChunkHex) {
          
          // Find and log nearest neighbor chunk (only if we have a current chunk) - ONLY when tile changes
          // Use currentTileHex from player (source of truth) - already fetched above
          const chunkRadius = calculateChunkRadius(canvasManager.getCurrentRings());
          const threshold = chunkRadius * 3;
          const thresholdWorld = threshold * TILE_CONFIG.hexSize * 1.5;
          
          const nearestNeighbor = findNearestNeighborChunk(
            currentChunkHex,
            worldMap,
            currentTileHex,
            canvasManager.getCurrentRings()
          );
          
          // Log nearest neighbor stats when tile changes
          if (addLogEntry) {
            if (nearestNeighbor) {
              addLogEntry(`Nearest neighbor chunk: (${nearestNeighbor.neighbor.q}, ${nearestNeighbor.neighbor.r})`, 'info');
              addLogEntry(`Distance to nearest neighbor: ${nearestNeighbor.distance.toFixed(2)}`, 'info');
              addLogEntry(`Threshold distance: ${thresholdWorld.toFixed(2)}`, 'info');
              addLogEntry(`Nearest neighbor instantiated: ${nearestNeighbor.isInstantiated}`, 'info');
            } else {
              addLogEntry(`No nearest neighbor chunk found for current chunk (${currentChunkHex.q}, ${currentChunkHex.r})`, 'info');
            }
          }
          
          // Ensure nearest neighbor is instantiated and enabled if within threshold
          const needsRender = ensureNearestNeighborChunkIsVisible(
            currentChunkHex,
            worldMap,
            currentTileHex,
            canvasManager.getCurrentRings(),
            TILE_CONFIG.hexSize,
            addLogEntry ?? undefined
          );
          
          if (needsRender || chunksChanged) {
            canvasManager.renderGrid();
          }
        } else if (chunksChanged) {
          // If chunks changed but tile didn't, still need to re-render
          canvasManager.renderGrid();
        }
      }
    });
      
      // Observer will be cleaned up when scene is disposed
    }
  
  // Text input and generate button (HTML elements)
  const promptInputEl = document.getElementById('layoutPromptInput');
  const generateFromTextBtn = document.getElementById('generateFromTextBtn');
  const modelStatusEl = document.getElementById('modelStatus');

  if (generateFromTextBtn && promptInputEl) {
    generateFromTextBtn.addEventListener('click', () => {
      const prompt = promptInputEl instanceof HTMLInputElement ? promptInputEl.value.trim() : '';
      if (prompt) {
        generateLayoutFromText(
          prompt,
          wasmManager,
          llmManager,
          patternCache,
          canvasManager,
          (constraints?: LayoutConstraints) => canvasManager.renderGrid(constraints),
          errorEl,
          modelStatusEl,
          addLogEntry ?? undefined
        ).catch((error) => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (errorEl) {
            errorEl.textContent = `Error: ${errorMsg}`;
          }
        });
      }
    });
  }

  /**
   * Reinitialize everything - ONLY called when rings or runtime mode changes
   * This is a heavy operation that disposes and recreates the entire scene, map, and player.
   * DO NOT call this for other changes (e.g., background color, layout generation).
   */
  const reinitialize = async (): Promise<void> => {
    try {
      // Get current rings value from dropdown
      const ringsSelectEl = document.getElementById('ringsSelect');
      let currentRings = canvasManager.getCurrentRings();
      if (ringsSelectEl && ringsSelectEl instanceof HTMLSelectElement) {
        const selectedRings = Number.parseInt(ringsSelectEl.value, 10);
        if (!Number.isNaN(selectedRings) && selectedRings >= 0 && selectedRings <= 50) {
          currentRings = selectedRings;
        }
      }

      // Clear system logs
      if (systemLogsContentEl) {
        systemLogsContentEl.innerHTML = '';
      }

      // Clean up chunk loading observer if it exists
      // Note: Observer cleanup is handled by scene disposal in canvasManager.dispose()

      // Dispose of player if it exists
      if (player) {
        player.dispose();
        player = null;
      }

      // Dispose of old canvas manager
      canvasManager.dispose();

      // Clear WASM state
      const wasmModule = wasmManager.getModule();
      if (wasmModule) {
        wasmModule.clear_layout();
        wasmModule.clear_pre_constraints();
      }

      // Create new canvas manager with updated test mode
      const newCanvasManager = new CanvasManager(wasmManager, addLogEntry ?? undefined, undefined, CONFIG.mode === 'test');
      
      // Set the rings value before initialization
      newCanvasManager.setCurrentRings(currentRings);

      // Set up pre-constraints generation function
      newCanvasManager.setGeneratePreConstraintsFn((constraints: LayoutConstraints) => {
        const module = wasmManager.getModule();
        if (!module) {
          return [];
        }
        return constraintsToPreConstraints(
          constraints,
          module,
          newCanvasManager.getCurrentRings(),
          (rings) => newCanvasManager.setCurrentRings(rings),
          addLogEntry ?? undefined
        );
      });

      // Initialize canvas manager
      await newCanvasManager.initialize(canvas);

      // Set background color from dropdown
      const backgroundColorSelectEl = document.getElementById('backgroundColorSelect');
      if (backgroundColorSelectEl && backgroundColorSelectEl instanceof HTMLSelectElement) {
        newCanvasManager.setBackgroundColor(backgroundColorSelectEl.value);
      }

      // Create new map for chunk management
      const newWorldMap = new WorldMap();

      // Create origin chunk at (0, 0) with current rings value
      const originPosition = { q: 0, r: 0 };
      const originChunk = newWorldMap.createChunk(
        originPosition,
        currentRings,
        TILE_CONFIG.hexSize
      );

      // Compute neighbors for origin chunk
      if (addLogEntry) {
        const neighbors = originChunk.getNeighbors();
        addLogEntry(`Origin chunk created at (0, 0) with ${neighbors.length} neighbors (rings: ${currentRings})`, 'info');
        for (const neighbor of neighbors) {
          addLogEntry(`Origin chunk neighbor: (${neighbor.q}, ${neighbor.r})`, 'info');
        }
      }

      // Always create player instance (will be disabled in test mode)
      const newScene = newCanvasManager.getScene();
      if (newScene) {
        player = new Player(newScene);
        const avatarUrl = 'https://raw.githubusercontent.com/EricEisaman/assets/main/items/arrow.glb';
        await player.initialize(avatarUrl);
        
        // Log avatar instantiation with position and rotation
        if (addLogEntry) {
          const avatar = player.getAvatar();
          const avatarMesh = avatar.getMesh();
          if (avatarMesh) {
            const pos = avatarMesh.position;
            const rot = avatarMesh.rotation;
            addLogEntry(`Avatar instantiated - position: (x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}), rotation: ${rot.y.toFixed(4)} rad`, 'info');
          }
        }
        
        // Reset position and rotation when rings or mode changes
        player.reset();
        
        // Enable/disable based on mode
        player.setEnabled(CONFIG.mode === 'normal', addLogEntry ?? undefined);
        
        // Set player reference in camera manager for follow mode
        const newCameraManager = newCanvasManager.getCameraManager();
        if (newCameraManager) {
          newCameraManager.setPlayer(player);
        }
        
        // Set player reference in canvas manager for floating origin tracking
        newCanvasManager.setPlayer(player);
      } else {
        player = null;
      }

      // Run tests if mode is test
      if (CONFIG.mode === 'test') {
        const originChunk = newWorldMap.getChunk(originPosition);
        if (originChunk && addLogEntry) {
          const neighbors = originChunk.getNeighbors();
          addLogEntry(`Test mode: Origin chunk has ${neighbors.length} neighbors`, 'info');
          
          // Instantiate and log the first neighbor
          if (neighbors.length > 0) {
            const firstNeighbor = neighbors[0];
            if (firstNeighbor) {
              const neighborChunk = newWorldMap.createChunk(
                firstNeighbor,
                currentRings,
                TILE_CONFIG.hexSize
              );
              const neighborPos = neighborChunk.getPositionHex();
              addLogEntry(`Test mode: Instantiated neighbor chunk at (${neighborPos.q}, ${neighborPos.r})`, 'success');
            }
          }
        }
      }

      // Set map in canvas manager for rendering
      newCanvasManager.setMap(newWorldMap);

      // Initial render
      newCanvasManager.renderGrid();

      // Set up avatar-based chunk loading (always set up, but only active when player is enabled)
      frameCount = 0;
      previousTileHex = null;
      currentChunkHex = null;

      if (player && newScene) {
        newScene.onBeforeRenderObservable.add(() => {
          frameCount++;
          
          // Update player every frame (will be no-op if disabled)
          if (player) {
            player.update();
          }
          
          // Update camera manager (for follow mode)
          const newCameraManager = newCanvasManager.getCameraManager();
          if (newCameraManager) {
            newCameraManager.update();
          }
          
          // Update floating origin to follow player avatar position
          // This maintains precision by keeping coordinate system centered on player
          newCanvasManager.updateFloatingOrigin();
          
          // Check chunk loading every CHECK_INTERVAL frames (only if player is enabled)
          if (frameCount % CHECK_INTERVAL === 0 && player && player.getEnabled()) {
            // Get current tile hex coordinate from player - player is the source of truth
            const currentTileHex = player.getCurrentTileHex(TILE_CONFIG.hexSize);
            
            // Use the same function for both UI update and processing
            const tileChanged = checkAndUpdateTile(currentTileHex, newWorldMap, newCanvasManager);
            
            // Always check all chunks for disable/enable based on distance (not just when tile changes)
            // This ensures all chunks, including origin, are properly evaluated
            let chunksChanged = false;
            if (currentChunkHex) {
              chunksChanged = disableDistantChunks(
                currentChunkHex,
                newWorldMap,
                newCanvasManager.getCurrentRings(),
                addLogEntry ?? undefined
              );
            }
            
            // Only process neighbor loading if tile actually changed
            if (tileChanged && currentChunkHex) {
              // Use currentTileHex from player (source of truth) - already fetched above
              const chunkRadius = calculateChunkRadius(newCanvasManager.getCurrentRings());
              const threshold = chunkRadius * 3;
              const thresholdWorld = threshold * TILE_CONFIG.hexSize * 1.5;
              
              const nearestNeighbor = findNearestNeighborChunk(
                currentChunkHex,
                newWorldMap,
                currentTileHex,
                newCanvasManager.getCurrentRings()
              );
              
              // Log nearest neighbor stats when tile changes
              if (addLogEntry) {
                if (nearestNeighbor) {
                  addLogEntry(`Nearest neighbor chunk: (${nearestNeighbor.neighbor.q}, ${nearestNeighbor.neighbor.r})`, 'info');
                  addLogEntry(`Distance to nearest neighbor: ${nearestNeighbor.distance.toFixed(2)}`, 'info');
                  addLogEntry(`Threshold distance: ${thresholdWorld.toFixed(2)}`, 'info');
                  addLogEntry(`Nearest neighbor instantiated: ${nearestNeighbor.isInstantiated}`, 'info');
                } else {
                  addLogEntry(`No nearest neighbor chunk found for current chunk (${currentChunkHex.q}, ${currentChunkHex.r})`, 'info');
                }
              }
              
              // Ensure nearest neighbor is instantiated and enabled if within threshold
              const needsRender = ensureNearestNeighborChunkIsVisible(
                currentChunkHex,
                newWorldMap,
                currentTileHex,
                newCanvasManager.getCurrentRings(),
                TILE_CONFIG.hexSize,
                addLogEntry ?? undefined
              );
              
              if (needsRender || chunksChanged) {
                newCanvasManager.renderGrid();
              }
            } else if (chunksChanged) {
              // If chunks changed but tile didn't, still need to re-render
              newCanvasManager.renderGrid();
            }
          }
        });
        
        // Observer will be cleaned up when scene is disposed
      }

      // Update the canvasManager reference
      // Note: We can't reassign const, so we'll need to update the handlers
      // For now, we'll store it in a way that allows updates
      Object.assign(canvasManager, newCanvasManager);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errorEl) {
        errorEl.textContent = `Reinitialization error: ${errorMsg}`;
      }
      if (addLogEntry) {
        addLogEntry(`Reinitialization error: ${errorMsg}`, 'error');
      }
    }
  };

  // Rings dropdown handler
  const ringsSelectEl = document.getElementById('ringsSelect');
  if (ringsSelectEl && ringsSelectEl instanceof HTMLSelectElement) {
    // Set initial value to currentRings (default 5)
    ringsSelectEl.value = canvasManager.getCurrentRings().toString();
    
    ringsSelectEl.addEventListener('change', () => {
      const selectedRings = Number.parseInt(ringsSelectEl.value, 10);
      if (!Number.isNaN(selectedRings) && selectedRings >= 0 && selectedRings <= 50) {
        // Update rings in canvas manager
        canvasManager.setCurrentRings(selectedRings);
        
        // Reinitialize everything
        void reinitialize();
      }
    });
  }

  // Runtime mode dropdown handler
  const runtimeModeSelectEl = document.getElementById('runtimeModeSelect');
  if (runtimeModeSelectEl && runtimeModeSelectEl instanceof HTMLSelectElement) {
    // Set initial value to current mode
    runtimeModeSelectEl.value = CONFIG.mode;
    
    runtimeModeSelectEl.addEventListener('change', () => {
      const selectedMode = runtimeModeSelectEl.value;
      if (selectedMode === 'normal' || selectedMode === 'test') {
        // Update CONFIG mode
        CONFIG.mode = selectedMode;
        
        // Reinitialize everything
        void reinitialize();
      }
    });
  }

  // Background color dropdown handler
  const backgroundColorSelectEl = document.getElementById('backgroundColorSelect');
  if (backgroundColorSelectEl && backgroundColorSelectEl instanceof HTMLSelectElement) {
    // Set initial background color
    canvasManager.setBackgroundColor(backgroundColorSelectEl.value);
    
    backgroundColorSelectEl.addEventListener('change', () => {
      const selectedColor = backgroundColorSelectEl.value;
      // Update background color immediately (no need to reinitialize)
      canvasManager.setBackgroundColor(selectedColor);
    });
  }

  // Camera mode dropdown handler
  const cameraModeSelectEl = document.getElementById('cameraModeSelect');
  if (cameraModeSelectEl && cameraModeSelectEl instanceof HTMLSelectElement) {
    const cameraManager = canvasManager.getCameraManager();
    if (cameraManager) {
      // Set initial camera mode from dropdown (default: 'simple-follow')
      const initialMode = cameraModeSelectEl.value;
      if (initialMode === 'free' || initialMode === 'simple-follow') {
        cameraManager.setMode(initialMode);
      }
      
      cameraModeSelectEl.addEventListener('change', () => {
        const selectedMode = cameraModeSelectEl.value;
        if (selectedMode === 'free' || selectedMode === 'simple-follow') {
          cameraManager.setMode(selectedMode);
        }
      });
    }
  }
};
