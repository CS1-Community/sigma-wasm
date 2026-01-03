/**
 * Canvas Management Module
 * 
 * Handles BabylonJS engine, scene, rendering, and UI setup.
 */

import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, Vector3, Mesh, Color3, Color4, CreateLines, StandardMaterial, DynamicTexture, InstancedMesh } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { SceneLoader } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle } from '@babylonjs/gui';
import type { TileType, LayoutConstraints } from '../../types';
import type { WasmManager } from './wasmManagement';
import { tileTypeFromNumber, tileTypeToNumber } from './wasmManagement';
import * as HexUtils from './hexUtils';
import type { WorldMap, Chunk } from './chunkManagement';
import { CameraManager } from './cameraManager';
import { CONSTRAINTS } from './constraints';
import { getTileColor as getTileColorFromConfig, getAllTileTypes, DEFAULT_TILE_MODEL_URL } from './tiles';

/**
 * Tile Configuration - centralized tile dimensions
 */
export const TILE_CONFIG = {
  modelWidth: 17.3, // flat-to-flat dimension for pointy-top hex
  modelDepth: 20.0, // pointy-top to pointy-top dimension
  hexHeight: 0.3,   // vertical dimension
  get hexSize(): number {
    return this.modelDepth / 3.0; // distance from center to vertex
  },
} as const;

/**
 * Camera Configuration - initial camera positioning
 */
export const CAMERA_CONFIG = {
  initialAlpha: 0,   // horizontal rotation (radians)
  initialBeta: 0,    // vertical rotation (0 = straight down)
  initialRadius: 250, // distance from target (meters)
  gridCenter: { x: 0, y: 0, z: 0 },
} as const;

/**
 * Get color for a tile type
 * Uses the TILES config object for centralized configuration
 */
export function getTileColor(tileType: TileType): Color3 {
  return getTileColorFromConfig(tileType);
}

/**
 * Get default layout constraints for initial render
 */
export function getDefaultConstraints(): LayoutConstraints {
  return {
    buildingDensity: CONSTRAINTS.defaultBuildingDensity,
    clustering: CONSTRAINTS.defaultClustering,
    grassRatio: CONSTRAINTS.defaultGrassRatio,
    buildingSizeHint: CONSTRAINTS.defaultBuildingSizeHint,
  };
}

/**
 * Show thinking animation on layout generation container
 */
export async function showThinkingAnimation(
  logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
): Promise<void> {
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
    
    if (logFn) {
      const timestamp = new Date().toLocaleTimeString();
      logFn(`[${timestamp}] Started thinking animation`, 'info');
    }
  }
}

/**
 * Hide thinking animation on layout generation container
 */
export function hideThinkingAnimation(
  logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
): void {
  const containerEl = document.getElementById('layoutGenerationContainer');
  if (containerEl instanceof HTMLElement) {
    containerEl.classList.remove('thinking');
    if (logFn) {
      const timestamp = new Date().toLocaleTimeString();
      logFn(`[${timestamp}] Finished thinking animation`, 'info');
    }
  }
}

/**
 * Canvas Manager class for BabylonJS setup and rendering
 */
export class CanvasManager {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private cameraManager: CameraManager | null = null;
  private baseMeshes: Map<string, Mesh> = new Map();
  private materials: Map<TileType['type'], StandardMaterial> = new Map();
  private currentRings = 1;
  private wasmManager: WasmManager;
  private logFn: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null;
  private generatePreConstraintsFn: ((constraints: LayoutConstraints, worldMap?: WorldMap, chunksToGenerate?: Array<Chunk>) => Array<{ q: number; r: number; tileType: TileType }>) | null = null;
  private worldMap: WorldMap | null = null;
  private isTestMode: boolean = false;
  private currentTileText: TextBlock | null = null;
  private previousTileText: TextBlock | null = null;
  private currentChunkText: TextBlock | null = null;
  private player: { getAvatar: () => { getMesh: () => Mesh | null } } | null = null;
  private floatingOriginThreshold: number = 1000; // Distance threshold for floating origin updates
  private currentFloatingOrigin: Vector3 = Vector3.Zero(); // Current floating origin position

  constructor(
    wasmManager: WasmManager,
    logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void,
    generatePreConstraintsFn?: (constraints: LayoutConstraints, worldMap?: WorldMap, chunksToGenerate?: Array<Chunk>) => Array<{ q: number; r: number; tileType: TileType }>,
    isTestMode?: boolean
  ) {
    this.wasmManager = wasmManager;
    this.logFn = logFn ?? null;
    this.generatePreConstraintsFn = generatePreConstraintsFn ?? null;
    this.isTestMode = isTestMode ?? false;
  }

  /**
   * Log a message
   */
  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    if (this.logFn) {
      this.logFn(message, type);
    }
  }

  /**
   * Set the function to generate pre-constraints
   */
  setGeneratePreConstraintsFn(fn: (constraints: LayoutConstraints, worldMap?: WorldMap, chunksToGenerate?: Array<Chunk>) => Array<{ q: number; r: number; tileType: TileType }>): void {
    this.generatePreConstraintsFn = fn;
  }

  /**
   * Set the world map for chunk-based rendering
   */
  setMap(worldMap: WorldMap): void {
    this.worldMap = worldMap;
  }

  /**
   * Get current rings
   */
  getCurrentRings(): number {
    return this.currentRings;
  }

  /**
   * Set current rings
   */
  setCurrentRings(rings: number): void {
    this.currentRings = rings;
  }

  /**
   * Initialize the canvas manager
   */
  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    // Initialize BabylonJS engine
    this.engine = new Engine(canvas, true);
    
    // Create scene
    this.scene = new Scene(this.engine);
    
    // Initialize floating origin at (0, 0, 0)
    // This will be updated to follow the player avatar position
    this.currentFloatingOrigin = Vector3.Zero();
    
    // Set up camera manager with default mode 'simple-follow'
    if (this.scene) {
      this.cameraManager = new CameraManager(this.scene, canvas, 'simple-follow');
    }
    
    // Set up lighting
    const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene);
    hemisphericLight.intensity = 0.7;
    
    const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -1, -1), this.scene);
    directionalLight.intensity = 0.5;
    
    // Load GLB model
    await this.loadGLBModel();
    
    // Create axis visualizer if in test mode
    if (this.isTestMode) {
      this.createAxisVisualizer();
    }
    
    // Set up UI
    this.setupUI();
    
    // Start render loop
    if (this.engine && this.scene) {
      this.engine.runRenderLoop(() => {
        if (this.scene) {
          this.scene.render();
        }
      });
    }
    
    // Handle window resize
    window.addEventListener('resize', () => {
      if (this.engine) {
        this.engine.resize();
      }
    });
  }

  /**
   * Load GLB model for hex tiles
   */
  private async loadGLBModel(): Promise<void> {
    if (!this.scene) {
      throw new Error('Scene not initialized');
    }

    try {
      if (this.logFn) {
        this.log('Loading hex_tile.glb model...', 'info');
      }
      
      // Use default model URL from TILES config
      // Currently all tile types use the same model, but in the future each type can have its own URL
      const glbUrl = DEFAULT_TILE_MODEL_URL;
      const result = await SceneLoader.ImportMeshAsync('', glbUrl, '', this.scene);
      
      if (result.meshes.length === 0) {
        throw new Error('No meshes found in GLB model');
      }
      
      // Find a mesh with actual geometry (not a container node)
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
        if (this.logFn) {
          this.log(`Failed to find mesh with vertices. Available meshes:`, 'error');
          for (const mesh of result.meshes) {
            if (mesh instanceof Mesh) {
              const vertexCount = mesh.getTotalVertices();
              const childCount = mesh.getChildMeshes().length;
              this.log(`  - ${mesh.name}: vertices=${vertexCount}, children=${childCount}`, 'error');
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
      
      if (this.logFn) {
        this.log(`Found mesh with geometry: name=${baseMesh.name}, vertices=${vertexCount}`, 'info');
      }
      
      // Use model at its actual size (scale 1.0)
      baseMesh.scaling = new Vector3(1.0, 1.0, 1.0);
      
      // Create a base mesh for each tile type with its own material
      // This matches the working pattern from babylon-wfc.ts
      // Get all tile types from TILES config
      const tileTypes = getAllTileTypes();
      
      for (const tileType of tileTypes) {
        // Clone the base mesh for each tile type
        const clonedMesh = baseMesh.clone(`base_${tileType.type}`);
        clonedMesh.isVisible = false;
        clonedMesh.setEnabled(false);
        
        // Create material for this tile type
        const material = new StandardMaterial(`material_${tileType.type}`, this.scene);
        const color = getTileColor(tileType);
        material.diffuseColor = color;
        material.specularColor = new Color3(0.1, 0.1, 0.1); // Low specular
        
        // Assign material to the cloned mesh
        clonedMesh.material = material;
        
        // Store both the base mesh and material
        this.baseMeshes.set(tileType.type, clonedMesh);
        this.materials.set(tileType.type, material);
      }
      
      // Hide and disable the original base mesh
      baseMesh.isVisible = false;
      baseMesh.setEnabled(false);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Failed to load hex tile model: ${errorMsg}`, 'error');
      throw error;
    }
  }

  /**
   * Create axis visualizer with X, Y, Z labels
   * Only shown in test mode
   */
  private createAxisVisualizer(): void {
    if (!this.scene) {
      return;
    }

    const axisLength = 50;
    const origin = Vector3.Zero();

    // X axis (red) - pointing right
    const xAxisPoints = [
      origin,
      new Vector3(axisLength, 0, 0)
    ];
    const xAxis = CreateLines('xAxis', { points: xAxisPoints }, this.scene);
    const xMaterial = new StandardMaterial('xAxisMaterial', this.scene);
    xMaterial.emissiveColor = new Color3(1, 0, 0); // Red
    xMaterial.disableLighting = true;
    xAxis.color = new Color3(1, 0, 0);
    xAxis.material = xMaterial;

    // Y axis (green) - pointing up
    const yAxisPoints = [
      origin,
      new Vector3(0, axisLength, 0)
    ];
    const yAxis = CreateLines('yAxis', { points: yAxisPoints }, this.scene);
    const yMaterial = new StandardMaterial('yAxisMaterial', this.scene);
    yMaterial.emissiveColor = new Color3(0, 1, 0); // Green
    yMaterial.disableLighting = true;
    yAxis.color = new Color3(0, 1, 0);
    yAxis.material = yMaterial;

    // Z axis (blue) - pointing forward (in Babylon.js, Z is depth)
    const zAxisPoints = [
      origin,
      new Vector3(0, 0, axisLength)
    ];
    const zAxis = CreateLines('zAxis', { points: zAxisPoints }, this.scene);
    const zMaterial = new StandardMaterial('zAxisMaterial', this.scene);
    zMaterial.emissiveColor = new Color3(0, 0, 1); // Blue
    zMaterial.disableLighting = true;
    zAxis.color = new Color3(0, 0, 1);
    zAxis.material = zMaterial;

    // Create labels using DynamicTexture
    const labelSize = 256;
    const labelOffset = axisLength + 5;

    // X label
    const xLabelTexture = new DynamicTexture('xLabelTexture', { width: labelSize, height: labelSize }, this.scene, false);
    const xLabelContext = xLabelTexture.getContext();
    if (xLabelContext && xLabelContext instanceof CanvasRenderingContext2D) {
      xLabelContext.fillStyle = 'red';
      xLabelContext.font = 'bold 128px Arial';
      xLabelContext.textAlign = 'center';
      xLabelContext.textBaseline = 'middle';
      xLabelContext.fillText('X', labelSize / 2, labelSize / 2);
      xLabelTexture.update();
    }
    const xLabelPlane = Mesh.CreatePlane('xLabelPlane', 10, this.scene);
    xLabelPlane.position = new Vector3(labelOffset, 0, 0);
    xLabelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const xLabelMaterial = new StandardMaterial('xLabelMaterial', this.scene);
    xLabelMaterial.emissiveTexture = xLabelTexture;
    xLabelMaterial.disableLighting = true;
    xLabelMaterial.backFaceCulling = false;
    xLabelPlane.material = xLabelMaterial;

    // Y label
    const yLabelTexture = new DynamicTexture('yLabelTexture', { width: labelSize, height: labelSize }, this.scene, false);
    const yLabelContext = yLabelTexture.getContext();
    if (yLabelContext && yLabelContext instanceof CanvasRenderingContext2D) {
      yLabelContext.fillStyle = 'green';
      yLabelContext.font = 'bold 128px Arial';
      yLabelContext.textAlign = 'center';
      yLabelContext.textBaseline = 'middle';
      yLabelContext.fillText('Y', labelSize / 2, labelSize / 2);
      yLabelTexture.update();
    }
    const yLabelPlane = Mesh.CreatePlane('yLabelPlane', 10, this.scene);
    yLabelPlane.position = new Vector3(0, labelOffset, 0);
    yLabelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const yLabelMaterial = new StandardMaterial('yLabelMaterial', this.scene);
    yLabelMaterial.emissiveTexture = yLabelTexture;
    yLabelMaterial.disableLighting = true;
    yLabelMaterial.backFaceCulling = false;
    yLabelPlane.material = yLabelMaterial;

    // Z label
    const zLabelTexture = new DynamicTexture('zLabelTexture', { width: labelSize, height: labelSize }, this.scene, false);
    const zLabelContext = zLabelTexture.getContext();
    if (zLabelContext && zLabelContext instanceof CanvasRenderingContext2D) {
      zLabelContext.fillStyle = 'blue';
      zLabelContext.font = 'bold 128px Arial';
      zLabelContext.textAlign = 'center';
      zLabelContext.textBaseline = 'middle';
      zLabelContext.fillText('Z', labelSize / 2, labelSize / 2);
      zLabelTexture.update();
    }
    const zLabelPlane = Mesh.CreatePlane('zLabelPlane', 10, this.scene);
    zLabelPlane.position = new Vector3(0, 0, labelOffset);
    zLabelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const zLabelMaterial = new StandardMaterial('zLabelMaterial', this.scene);
    zLabelMaterial.emissiveTexture = zLabelTexture;
    zLabelMaterial.disableLighting = true;
    zLabelMaterial.backFaceCulling = false;
    zLabelPlane.material = zLabelMaterial;
  }

  /**
   * Set up Babylon 2D UI
   */
  private setupUI(): void {
    if (!this.engine || !this.scene) {
      return;
    }

    const advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI('UI');
    
    // Recompute button
    const recomputeButton = Button.CreateSimpleButton('recomputeButton', 'Recompute Wave Collapse');
    recomputeButton.width = '200px';
    recomputeButton.height = '40px';
    recomputeButton.color = 'white';
    recomputeButton.background = 'green';
    recomputeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    recomputeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    recomputeButton.top = '1%';
    recomputeButton.left = '-220px';
    recomputeButton.onPointerClickObservable.add(() => {
      this.renderGrid();
    });
    advancedTexture.addControl(recomputeButton);
    
    // Fullscreen button
    const fullscreenButton = Button.CreateSimpleButton('fullscreenButton', 'Fullscreen');
    fullscreenButton.width = '150px';
    fullscreenButton.height = '40px';
    fullscreenButton.color = 'white';
    fullscreenButton.background = 'blue';
    fullscreenButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    fullscreenButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    fullscreenButton.top = '1%';
    fullscreenButton.left = '-10px';
    fullscreenButton.onPointerClickObservable.add(() => {
      if (this.engine) {
        this.engine.enterFullscreen(false);
      }
    });
    advancedTexture.addControl(fullscreenButton);
    
    // Exit fullscreen button
    const exitFullscreenButton = Button.CreateSimpleButton('exitFullscreenButton', 'Exit Fullscreen');
    exitFullscreenButton.width = '150px';
    exitFullscreenButton.height = '40px';
    exitFullscreenButton.color = 'white';
    exitFullscreenButton.background = 'red';
    exitFullscreenButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    exitFullscreenButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    exitFullscreenButton.top = '1%';
    exitFullscreenButton.left = '-10px';
    exitFullscreenButton.isVisible = false;
    exitFullscreenButton.onPointerClickObservable.add(() => {
      if (this.engine) {
        this.engine.exitFullscreen();
      }
    });
    advancedTexture.addControl(exitFullscreenButton);
    
    // Handle fullscreen changes
    const handleFullscreenChange = (): void => {
      if (this.engine) {
        const isFullscreen = this.engine.isFullscreen;
        fullscreenButton.isVisible = !isFullscreen;
        exitFullscreenButton.isVisible = isFullscreen;
      }
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    // Create tile/chunk info overlay in top left
    this.createTileChunkOverlay(advancedTexture);
  }

  /**
   * Create tile/chunk info overlay in top left
   */
  private createTileChunkOverlay(advancedTexture: AdvancedDynamicTexture): void {
    // Create background rectangle for better visibility
    const background = new Rectangle('tileChunkBackground');
    background.width = '200px';
    background.height = '85px';
    background.color = 'transparent';
    background.background = 'rgba(0, 0, 0, 0.5)';
    background.thickness = 2;
    background.cornerRadius = 5;
    background.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    background.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    background.top = '1%';
    background.left = '1%';
    advancedTexture.addControl(background);

    // Current Tile label
    const tileLabel = new TextBlock('tileLabel', 'Current Tile:');
    tileLabel.color = 'white';
    tileLabel.fontSize = 14;
    tileLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    tileLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    tileLabel.paddingTop = '5px';
    tileLabel.paddingLeft = '10px';
    background.addControl(tileLabel);

    // Current Tile value - positioned right after the label
    this.currentTileText = new TextBlock('currentTileText', '(-, -)');
    this.currentTileText.color = '#003300';
    this.currentTileText.fontSize = 14;
    this.currentTileText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.currentTileText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.currentTileText.paddingTop = '5px';
    this.currentTileText.paddingLeft = '0px';
    this.currentTileText.left = '115px'; // Position after "Current Tile: " label with extra spacing
    background.addControl(this.currentTileText);

    // Previous Tile label
    const previousTileLabel = new TextBlock('previousTileLabel', 'Previous Tile:');
    previousTileLabel.color = 'white';
    previousTileLabel.fontSize = 14;
    previousTileLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    previousTileLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    previousTileLabel.paddingTop = '25px';
    previousTileLabel.paddingLeft = '10px';
    background.addControl(previousTileLabel);

    // Previous Tile value - positioned right after the label
    this.previousTileText = new TextBlock('previousTileText', '(-, -)');
    this.previousTileText.color = 'orange';
    this.previousTileText.fontSize = 14;
    this.previousTileText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.previousTileText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.previousTileText.paddingTop = '25px';
    this.previousTileText.paddingLeft = '0px';
    this.previousTileText.left = '115px'; // Position after "Previous Tile: " label with extra spacing
    background.addControl(this.previousTileText);

    // Current Chunk label
    const chunkLabel = new TextBlock('chunkLabel', 'Current Chunk:');
    chunkLabel.color = 'white';
    chunkLabel.fontSize = 14;
    chunkLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    chunkLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    chunkLabel.paddingTop = '45px';
    chunkLabel.paddingLeft = '10px';
    background.addControl(chunkLabel);

    // Current Chunk value - positioned right after the label
    this.currentChunkText = new TextBlock('currentChunkText', '(-, -)');
    this.currentChunkText.color = '#003300';
    this.currentChunkText.fontSize = 14;
    this.currentChunkText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.currentChunkText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.currentChunkText.paddingTop = '45px';
    this.currentChunkText.paddingLeft = '0px';
    this.currentChunkText.left = '115px'; // Position after "Current Chunk: " label with extra spacing
    background.addControl(this.currentChunkText);
  }

  /**
   * Update the tile/chunk display
   */
  updateTileChunkDisplay(
    tileHex: { q: number; r: number } | null, 
    chunkHex: { q: number; r: number } | null,
    previousTileHex: { q: number; r: number } | null = null
  ): void {
    if (this.currentTileText) {
      if (tileHex) {
        this.currentTileText.text = `(${tileHex.q}, ${tileHex.r})`;
      } else {
        this.currentTileText.text = '(-, -)';
      }
    }
    
    if (this.previousTileText) {
      if (previousTileHex) {
        this.previousTileText.text = `(${previousTileHex.q}, ${previousTileHex.r})`;
      } else {
        this.previousTileText.text = '(-, -)';
      }
    }
    
    if (this.currentChunkText) {
      if (chunkHex) {
        this.currentChunkText.text = `(${chunkHex.q}, ${chunkHex.r})`;
      } else {
        this.currentChunkText.text = '(-, -)';
      }
    }
  }

  /**
   * Render the WFC grid
   */
  renderGrid(constraints?: LayoutConstraints): void {
    
    const wasmModule = this.wasmManager.getModule();
    if (!wasmModule) {
      return;
    }
    
    const constraintsToUse = constraints ?? getDefaultConstraints();
    
    // If using chunk-based rendering, we need to generate pre-constraints for all chunks
    if (this.worldMap) {
      const enabledChunks = this.worldMap.getEnabledChunks();
      
      if (enabledChunks.length > 0) {
        // Separate chunks into those that need generation and those that are already generated
        const chunksNeedingGeneration: Array<Chunk> = [];
        const chunksAlreadyGenerated: Array<Chunk> = [];
        
        for (const chunk of enabledChunks) {
          if (chunk.getTilesGenerated() && chunk.hasAllTilesGenerated()) {
            chunksAlreadyGenerated.push(chunk);
          } else {
            chunksNeedingGeneration.push(chunk);
          }
        }
        
        // Collect all hex coordinates from chunks that need generation
        const newHexCoords = new Set<string>();
        for (const chunk of chunksNeedingGeneration) {
          const chunkGrid = chunk.getGrid();
          for (const chunkTile of chunkGrid) {
            newHexCoords.add(`${chunkTile.hex.q},${chunkTile.hex.r}`);
          }
        }
        
        // Collect all hex coordinates from all enabled chunks (for pre-constraints)
        const allHexCoords = new Set<string>();
        for (const chunk of enabledChunks) {
          const chunkGrid = chunk.getGrid();
          for (const chunkTile of chunkGrid) {
            allHexCoords.add(`${chunkTile.hex.q},${chunkTile.hex.r}`);
          }
        }
        
        // Find the bounding box to determine the center and rings needed
        let minQ = Number.POSITIVE_INFINITY;
        let maxQ = Number.NEGATIVE_INFINITY;
        let minR = Number.POSITIVE_INFINITY;
        let maxR = Number.NEGATIVE_INFINITY;
        
        for (const hexKey of allHexCoords) {
          const parts = hexKey.split(',');
          if (parts.length === 2) {
            const q = Number.parseInt(parts[0] ?? '0', 10);
            const r = Number.parseInt(parts[1] ?? '0', 10);
            if (!Number.isNaN(q) && !Number.isNaN(r)) {
              minQ = Math.min(minQ, q);
              maxQ = Math.max(maxQ, q);
              minR = Math.min(minR, r);
              maxR = Math.max(maxR, r);
            }
          }
        }
        
        // Calculate required rings to cover all chunks from origin (0, 0)
        // Since constraintsToPreConstraints is hardcoded to center at (0, 0),
        // we need to ensure we generate enough rings from (0, 0) to cover all tiles
        let maxDistanceFromOrigin = 0;
        for (const hexKey of allHexCoords) {
          const parts = hexKey.split(',');
          if (parts.length === 2) {
            const q = Number.parseInt(parts[0] ?? '0', 10);
            const r = Number.parseInt(parts[1] ?? '0', 10);
            if (!Number.isNaN(q) && !Number.isNaN(r)) {
              const distance = HexUtils.HEX_UTILS.distance(0, 0, q, r);
              maxDistanceFromOrigin = Math.max(maxDistanceFromOrigin, distance);
            }
          }
        }
        const requiredRings = Math.max(maxDistanceFromOrigin, this.currentRings);
        
        if (this.logFn) {
          this.log(`Total hex coordinates in chunks: ${allHexCoords.size}`, 'info');
          this.log(`Max distance from origin: ${maxDistanceFromOrigin}, required rings: ${requiredRings}`, 'info');
        }
        
        // Only generate layout for new chunks that need generation
        // Existing chunks maintain their cached tile composition
        if (chunksNeedingGeneration.length > 0) {
          // Generate pre-constraints only for new chunks
          if (this.generatePreConstraintsFn) {
            // Only clear pre-constraints for new hex coordinates
            // Keep existing pre-constraints to maintain existing chunk composition
            // Temporarily override rings to cover all chunks
            const originalRings = this.currentRings;
            this.currentRings = requiredRings;
            
            // Generate constraints with expanded area
            const expandedConstraints: LayoutConstraints = {
              ...constraintsToUse,
              rings: requiredRings,
            };
            
            const preConstraints = this.generatePreConstraintsFn(expandedConstraints, this.worldMap, chunksNeedingGeneration);
            
            if (this.logFn) {
              this.log(`Generated ${preConstraints.length} pre-constraints for ${chunksNeedingGeneration.length} new chunks`, 'info');
            }
            
            // Filter to only include hexes that are in new chunks
            let setCount = 0;
            for (const preConstraint of preConstraints) {
              const hexKey = `${preConstraint.q},${preConstraint.r}`;
              if (newHexCoords.has(hexKey)) {
                const tileNum = tileTypeToNumber(preConstraint.tileType);
                wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
                setCount++;
              }
            }
            
            if (this.logFn) {
              this.log(`Set ${setCount} pre-constraints for new chunk tiles`, 'info');
            }
            
            // Restore original rings
            this.currentRings = originalRings;
          }
          
          // Generate layout only for new chunks
          wasmModule.generate_layout();
          
          // Cache tile types in chunks that were just generated
          for (const chunk of chunksNeedingGeneration) {
            const chunkGrid = chunk.getGrid();
            for (const chunkTile of chunkGrid) {
              // Query WASM for tile type and cache it in the chunk
              const tileNum = wasmModule.get_tile_at(chunkTile.hex.q, chunkTile.hex.r);
              const tileType = tileTypeFromNumber(tileNum);
              if (tileType) {
                chunk.setTileType(chunkTile.hex, tileType);
              }
            }
            // Mark chunk as generated - its composition is now locked
            chunk.setTilesGenerated(true);
            
            if (this.logFn) {
              const chunkPos = chunk.getPositionHex();
              this.log(`Cached tile composition for chunk at (${chunkPos.q}, ${chunkPos.r})`, 'info');
            }
          }
        } else {
          // All chunks already generated - no layout generation needed
          if (this.logFn) {
            this.log(`All ${enabledChunks.length} chunks already generated, skipping layout generation`, 'info');
          }
        }
      }
    } else {
      // Original single-grid pre-constraint generation
      if (!constraints && this.generatePreConstraintsFn) {
        wasmModule.clear_pre_constraints();
        const preConstraints = this.generatePreConstraintsFn(constraintsToUse, this.worldMap ?? undefined);
        for (const preConstraint of preConstraints) {
          const tileNum = tileTypeToNumber(preConstraint.tileType);
          wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
        }
      } else if (constraints && this.generatePreConstraintsFn) {
        // If constraints are provided, still generate pre-constraints
        wasmModule.clear_pre_constraints();
        const preConstraints = this.generatePreConstraintsFn(constraints, this.worldMap ?? undefined);
        for (const preConstraint of preConstraints) {
          const tileNum = tileTypeToNumber(preConstraint.tileType);
          wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
        }
      }
    }
    
    // Note: generate_layout() is now called conditionally above for chunk-based rendering
    // For non-chunk rendering, we still need to generate layout
    if (!this.worldMap) {
      wasmModule.generate_layout();
    }
    
    // Create instances for each hex tile
    const hexSize = TILE_CONFIG.hexSize;
    const hexHeight = TILE_CONFIG.hexHeight;
    
    // Get any base mesh (they're all the same geometry, just different materials)
    // Use grass as default since it should always exist
    const baseMesh = this.baseMeshes.get('grass');
    if (!baseMesh) {
      this.log('Base mesh not found for rendering', 'error');
      return;
    }
    
    // Prepare data for thin instances
    const validHexes: Array<{ hex: { q: number; r: number }; tileType: TileType; worldPos: Vector3 }> = [];
    
    // If worldMap is available, use chunk-based rendering
    if (this.worldMap) {
      const enabledChunks = this.worldMap.getEnabledChunks();
      
      if (this.logFn) {
        this.log(`Rendering ${enabledChunks.length} enabled chunks`, 'info');
      }
      
      // Collect tiles from all enabled chunks
      // Use a Set to deduplicate tiles at the same hex coordinate (chunks overlap at boundaries)
      const tileMap = new Map<string, { hex: { q: number; r: number }; tileType: TileType; worldPos: Vector3 }>();
      let totalTilesChecked = 0;
      let totalTilesFound = 0;
      let duplicateTiles = 0;
      
      for (const chunk of enabledChunks) {
        const chunkGrid = chunk.getGrid();
        const chunkPos = chunk.getPositionHex();
        let chunkTilesFound = 0;
        
        for (const chunkTile of chunkGrid) {
          totalTilesChecked++;
          
          // Skip disabled tiles
          if (!chunkTile.enabled) {
            continue;
          }
          
          // Use cached tile type from chunk (maintains stable composition)
          // Only query WASM if tile type is not cached (shouldn't happen for generated chunks)
          let tileType = chunk.getTileType(chunkTile.hex);
          if (!tileType) {
            // Fallback: query WASM if tile type not cached (for chunks not yet generated)
            const tileNum = wasmModule.get_tile_at(chunkTile.hex.q, chunkTile.hex.r);
            tileType = tileTypeFromNumber(tileNum);
            if (tileType) {
              // Cache it for future renders
              chunk.setTileType(chunkTile.hex, tileType);
            }
          }
          
          if (!tileType) {
            continue;
          }
          
          chunkTilesFound++;
          totalTilesFound++;
          
          // Convert axial to world position
          const worldPos = HexUtils.HEX_UTILS.hexToWorld(chunkTile.hex.q, chunkTile.hex.r, hexSize);
          // Use absolute position (no centering needed for chunk-based rendering)
          const absolutePos = new Vector3(
            worldPos.x,
            hexHeight / 2.0,
            worldPos.z
          );
          
          // Use hex coordinate as key to deduplicate overlapping tiles from adjacent chunks
          const hexKey = `${chunkTile.hex.q},${chunkTile.hex.r}`;
          if (tileMap.has(hexKey)) {
            duplicateTiles++;
          }
          tileMap.set(hexKey, { hex: chunkTile.hex, tileType, worldPos: absolutePos });
        }
        
        if (this.logFn) {
          this.log(`Chunk at (${chunkPos.q}, ${chunkPos.r}): checked ${chunkGrid.length} tiles, found ${chunkTilesFound}`, 'info');
        }
      }
      
      // Convert map to array for rendering, sorted by hex coordinate for consistent ordering
      const sortedTiles = Array.from(tileMap.entries()).sort((a, b) => {
        const [q1, r1] = a[0].split(',').map((v) => Number.parseInt(v, 10));
        const [q2, r2] = b[0].split(',').map((v) => Number.parseInt(v, 10));
        if (q1 !== q2) {
          return q1 - q2;
        }
        return r1 - r2;
      });
      
      for (const [, tile] of sortedTiles) {
        validHexes.push(tile);
      }
      
      // Detect gaps between chunks (only in test mode - expensive operation)
      // A gap is a hex position that is between chunk boundaries but not covered by any chunk
      let gapsFound = 0;
      const gapPositions: Array<{ q: number; r: number }> = [];
      
      if (this.isTestMode && enabledChunks.length > 0) {
        // Get rings from first chunk (all chunks should have same rings)
        const firstChunk = enabledChunks[0];
        if (firstChunk) {
          const firstChunkGrid = firstChunk.getGrid();
          // Calculate rings from grid size: 3*rings*(rings+1) + 1 = gridSize
          // Solve: 3*rings^2 + 3*rings + 1 - gridSize = 0
          // rings = (-3 + sqrt(9 + 12*(gridSize-1))) / 6
          const gridSize = firstChunkGrid.length;
          const rings = Math.round((-3 + Math.sqrt(9 + 12 * (gridSize - 1))) / 6);
          
          // Collect all hex positions that are actually covered
          const actualCoverage = new Set<string>();
          for (const chunk of enabledChunks) {
            const chunkGrid = chunk.getGrid();
            for (const tile of chunkGrid) {
              actualCoverage.add(`${tile.hex.q},${tile.hex.r}`);
            }
          }
          
          // Find the bounding area: all positions within (2*rings) distance of any chunk center
          // This is the area where chunks should be, and gaps would be visible
          const boundingArea = new Set<string>();
          for (const chunk of enabledChunks) {
            const chunkPos = chunk.getPositionHex();
            // Check all positions within distance (2*rings + rings) = 3*rings from chunk center
            // This covers the chunk itself plus the area where neighbors should be
            for (let checkDist = 0; checkDist <= 3 * rings; checkDist++) {
              const checkRing = HexUtils.HEX_UTILS.cubeRing(
                HexUtils.HEX_UTILS.axialToCube(chunkPos.q, chunkPos.r),
                checkDist
              );
              for (const cube of checkRing) {
                const axial = HexUtils.HEX_UTILS.cubeToAxial(cube);
                boundingArea.add(`${axial.q},${axial.r}`);
              }
            }
          }
          
          // Check for gaps: positions in bounding area that aren't covered
          for (const hexKey of boundingArea) {
            if (!actualCoverage.has(hexKey)) {
              const parts = hexKey.split(',');
              if (parts.length === 2) {
                const q = Number.parseInt(parts[0] ?? '0', 10);
                const r = Number.parseInt(parts[1] ?? '0', 10);
                if (!Number.isNaN(q) && !Number.isNaN(r)) {
                  // Check if this position is between chunks (within rings distance of at least one chunk center)
                  let isBetweenChunks = false;
                  for (const chunk of enabledChunks) {
                    const chunkPos = chunk.getPositionHex();
                    const dist = HexUtils.HEX_UTILS.distance(chunkPos.q, chunkPos.r, q, r);
                    // If it's beyond the chunk's own tiles (distance > rings) but close enough to be in the gap area
                    if (dist > rings && dist <= 2 * rings) {
                      isBetweenChunks = true;
                      break;
                    }
                  }
                  
                  if (isBetweenChunks) {
                    gapsFound++;
                    gapPositions.push({ q, r });
                  }
                }
              }
            }
          }
        }
      }
      
      if (this.logFn) {
        this.log(`Total tiles checked: ${totalTilesChecked}, tiles found in WASM: ${totalTilesFound}`, 'info');
        const duplicateLogType = duplicateTiles > 0 ? 'error' : 'info';
        this.log(`Duplicate tiles (overlapping chunks): ${duplicateTiles}, unique tiles: ${validHexes.length}`, duplicateLogType);
        
        if (this.isTestMode) {
          if (gapsFound > 0) {
            this.log(`GAPS DETECTED: Found ${gapsFound} gaps between chunks!`, 'error');
            const sampleGaps = gapPositions.slice(0, 5);
            for (const gap of sampleGaps) {
              this.log(`  Gap at hex (${gap.q}, ${gap.r})`, 'error');
            }
            if (gapPositions.length > 5) {
              this.log(`  ... and ${gapPositions.length - 5} more gaps`, 'error');
            }
          } else {
            this.log('No gaps detected between chunks', 'info');
          }
        }
        
        // Count tiles from each chunk that made it into the final render
        const chunkTileCounts = new Map<string, number>();
        for (const tile of validHexes) {
          // Find which chunk(s) this tile belongs to
          for (const chunk of enabledChunks) {
            const chunkPos = chunk.getPositionHex();
            const chunkGrid = chunk.getGrid();
            const belongsToChunk = chunkGrid.some((ct) => ct.hex.q === tile.hex.q && ct.hex.r === tile.hex.r);
            if (belongsToChunk) {
              const chunkKey = `${chunkPos.q},${chunkPos.r}`;
              chunkTileCounts.set(chunkKey, (chunkTileCounts.get(chunkKey) ?? 0) + 1);
            }
          }
        }
        
        this.log(`Tiles per chunk in final render:`, 'info');
        for (const [chunkKey, count] of chunkTileCounts.entries()) {
          this.log(`  Chunk ${chunkKey}: ${count} tiles`, 'info');
        }
        
        // Log sample positions from different chunks
        const sampleChunks = enabledChunks.slice(0, 3);
        for (const chunk of sampleChunks) {
          const chunkPos = chunk.getPositionHex();
          const chunkGrid = chunk.getGrid();
          if (chunkGrid.length > 0) {
            const firstTile = chunkGrid[0];
            if (firstTile) {
              const worldPos = HexUtils.HEX_UTILS.hexToWorld(firstTile.hex.q, firstTile.hex.r, hexSize);
              this.log(`Chunk (${chunkPos.q}, ${chunkPos.r}) first tile at hex (${firstTile.hex.q}, ${firstTile.hex.r}) -> world (${worldPos.x.toFixed(2)}, ${worldPos.z.toFixed(2)})`, 'info');
            }
          }
        }
        
        // Log ALL tiles from neighbor chunks to verify they're in the render list
        for (const chunk of enabledChunks) {
          const chunkPos = chunk.getPositionHex();
          if (chunkPos.q === 0 && chunkPos.r === 0) {
            continue; // Skip origin chunk
          }
          
          const chunkGrid = chunk.getGrid();
          const chunkTilesInRender: Array<{ hex: string; world: string }> = [];
          
          // Iterate over ALL tiles in the chunk's grid
          for (const chunkTile of chunkGrid) {
            // Check if this tile is in the render list
            const hexKey = `${chunkTile.hex.q},${chunkTile.hex.r}`;
            const tileData = tileMap.get(hexKey);
            
            if (tileData) {
              chunkTilesInRender.push({
                hex: `(${chunkTile.hex.q}, ${chunkTile.hex.r})`,
                world: `(${tileData.worldPos.x.toFixed(2)}, ${tileData.worldPos.z.toFixed(2)})`,
              });
            }
          }
          
          if (chunkTilesInRender.length > 0) {
            const chunkWorldPos = chunk.getPositionCartesian();
            const centerTile = chunkGrid.find((ct) => ct.hex.q === chunkPos.q && ct.hex.r === chunkPos.r);
            const centerTileWorldPos = centerTile ? HexUtils.HEX_UTILS.hexToWorld(centerTile.hex.q, centerTile.hex.r, hexSize) : null;
            
            this.log(`Chunk (${chunkPos.q}, ${chunkPos.r}) tiles in render (${chunkTilesInRender.length} of ${chunkGrid.length}):`, 'info');
            this.log(`  Chunk center world position: (${chunkWorldPos.x.toFixed(2)}, ${chunkWorldPos.z.toFixed(2)})`, 'info');
            if (centerTile) {
              this.log(`  Center tile hex: (${centerTile.hex.q}, ${centerTile.hex.r})`, 'info');
              if (centerTileWorldPos) {
                this.log(`  Center tile world position: (${centerTileWorldPos.x.toFixed(2)}, ${centerTileWorldPos.z.toFixed(2)})`, 'info');
                const xDiff = Math.abs(chunkWorldPos.x - centerTileWorldPos.x);
                const zDiff = Math.abs(chunkWorldPos.z - centerTileWorldPos.z);
                if (xDiff > 0.01 || zDiff > 0.01) {
                  this.log(`  MISMATCH: Chunk center world pos does not match center tile world pos! (x diff: ${xDiff.toFixed(2)}, z diff: ${zDiff.toFixed(2)})`, 'error');
                }
              }
            } else {
              this.log(`  ERROR: Center tile (${chunkPos.q}, ${chunkPos.r}) not found in chunk grid!`, 'error');
            }
            for (const tile of chunkTilesInRender) {
              this.log(`  tile at hex ${tile.hex} -> world ${tile.world}`, 'info');
            }
          } else {
            this.log(`WARNING: Chunk (${chunkPos.q}, ${chunkPos.r}) has no tiles in render!`, 'error');
          }
        }
      }
    } else {
      // Fallback to original single-grid rendering
      const renderRings = this.currentRings;
      
      if (this.logFn) {
        this.log(`Rendering with rings: ${renderRings} (expected tiles: ${3 * renderRings * (renderRings + 1) + 1})`, 'info');
      }
      
      // Center at (0, 0) - hexagon centered at origin
      const renderCenterQ = 0;
      const renderCenterR = 0;
      
      // Generate hexagon grid
      const renderHexGrid = HexUtils.HEX_UTILS.generateHexGrid(renderRings, renderCenterQ, renderCenterR);
      
      const centerWorldPos = HexUtils.HEX_UTILS.hexToWorld(renderCenterQ, renderCenterR, hexSize);
      
      for (const hex of renderHexGrid) {
        // Query WASM for tile type at this hex coordinate
        const tileNum = wasmModule.get_tile_at(hex.q, hex.r);
        const tileType = tileTypeFromNumber(tileNum);
        
        if (!tileType) {
          continue;
        }
        
        // Convert axial to world position
        const worldPos = HexUtils.HEX_UTILS.hexToWorld(hex.q, hex.r, hexSize);
        // Center the grid by subtracting center hex's position
        const centeredPos = new Vector3(
          worldPos.x - centerWorldPos.x,
          hexHeight / 2.0,
          worldPos.z - centerWorldPos.z
        );
        
        validHexes.push({ hex, tileType, worldPos: centeredPos });
      }
    }
    
    // Create or update individual mesh instances for each tile
    if (!this.scene) {
      this.log('Scene not initialized', 'error');
      return;
    }
    
    // Track which tiles need instances created/updated
    const tilesToProcess = new Map<string, { hex: { q: number; r: number }; tileType: TileType; worldPos: Vector3 }>();
    for (const tile of validHexes) {
      const hexKey = `${tile.hex.q},${tile.hex.r}`;
      tilesToProcess.set(hexKey, tile);
    }
    
    // Update or create instances for tiles in enabled chunks
    if (this.worldMap) {
      const enabledChunks = this.worldMap.getEnabledChunks();
      let instancesCreated = 0;
      let instancesUpdated = 0;
      
      for (const chunk of enabledChunks) {
        const chunkGrid = chunk.getGrid();
        
        for (const chunkTile of chunkGrid) {
          // Skip disabled tiles
          if (!chunkTile.enabled) {
            // Dispose of instance if it exists
            if (chunkTile.meshInstance) {
              chunkTile.meshInstance.dispose();
              chunkTile.meshInstance = null;
            }
            continue;
          }
          
          const hexKey = `${chunkTile.hex.q},${chunkTile.hex.r}`;
          const tileData = tilesToProcess.get(hexKey);
          
          if (!tileData) {
            // Tile should not be rendered, dispose instance if exists
            if (chunkTile.meshInstance) {
              chunkTile.meshInstance.dispose();
              chunkTile.meshInstance = null;
            }
            continue;
          }
          
          // Get the base mesh for this tile type (each tile type has its own base mesh with material)
          const tileTypeBaseMesh = this.baseMeshes.get(tileData.tileType.type);
          if (!tileTypeBaseMesh) {
            continue;
          }
          
          // Create instance if it doesn't exist
          if (!chunkTile.meshInstance) {
            const instanceName = `tile_${chunkTile.hex.q}_${chunkTile.hex.r}`;
            chunkTile.meshInstance = tileTypeBaseMesh.createInstance(instanceName);
            instancesCreated++;
          }
          
          // Update instance position
          const instance = chunkTile.meshInstance;
          instance.position = tileData.worldPos.clone();
          
          // Instance already has the correct material from its base mesh
          // Ensure instance is visible and enabled
          instance.isVisible = true;
          instance.setEnabled(true);
          instancesUpdated++;
        }
      }
      
      if (this.logFn) {
        this.log(`Created ${instancesCreated} new instances, updated ${instancesUpdated} instances`, 'info');
      }
    } else {
      // Fallback: create instances for non-chunk rendering
      // This is a simplified version for the fallback case
      let instancesCreated = 0;
      
      for (const tile of validHexes) {
        // Get the base mesh for this tile type
        const tileTypeBaseMesh = this.baseMeshes.get(tile.tileType.type);
        if (!tileTypeBaseMesh) {
          continue;
        }
        
        const instanceName = `tile_${tile.hex.q}_${tile.hex.r}`;
        const existingInstance = this.scene.getMeshByName(instanceName);
        
        if (existingInstance instanceof InstancedMesh) {
          existingInstance.position = tile.worldPos.clone();
          existingInstance.isVisible = true;
          existingInstance.setEnabled(true);
        } else {
          const instance = tileTypeBaseMesh.createInstance(instanceName);
          instance.position = tile.worldPos.clone();
          instance.isVisible = true;
          instance.setEnabled(true);
          instancesCreated++;
        }
      }
      
      if (this.logFn) {
        this.log(`Created ${instancesCreated} instances for fallback rendering`, 'info');
      }
    }
    
    // Base mesh should remain hidden - instances render independently
    // Instances don't need the base mesh to be visible
    baseMesh.isVisible = false;
    baseMesh.setEnabled(false);
  }

  /**
   * Reset camera to initial position
   */
  resetCamera(): void {
    if (!this.cameraManager) {
      return;
    }

    // Reset to free camera mode with initial settings
    this.cameraManager.setMode('free');
    const camera = this.cameraManager.getCamera();
    if (camera) {
      const gridCenter = new Vector3(
        CAMERA_CONFIG.gridCenter.x,
        CAMERA_CONFIG.gridCenter.y,
        CAMERA_CONFIG.gridCenter.z
      );
      camera.alpha = CAMERA_CONFIG.initialAlpha;
      camera.beta = CAMERA_CONFIG.initialBeta;
      camera.radius = CAMERA_CONFIG.initialRadius;
      camera.setTarget(gridCenter);
    }
  }

  /**
   * Get the camera
   */
  getCamera(): ArcRotateCamera | null {
    if (this.cameraManager) {
      return this.cameraManager.getCamera();
    }
    return null;
  }

  /**
   * Get the camera manager
   */
  getCameraManager(): CameraManager | null {
    return this.cameraManager;
  }

  /**
   * Get the scene
   */
  getScene(): Scene | null {
    return this.scene;
  }

  /**
   * Set the player reference for floating origin tracking
   * The floating origin will follow the player avatar's root mesh position
   * @param player - Player instance with getAvatar() method
   */
  setPlayer(player: { getAvatar: () => { getMesh: () => Mesh | null } }): void {
    this.player = player;
    
    if (this.logFn) {
      this.log('Floating origin tracking enabled for player avatar', 'info');
    }
  }

  /**
   * Update floating origin to follow player avatar position
   * Should be called every frame or at regular intervals
   * This maintains precision by keeping the coordinate system centered on the player
   * 
   * Implements floating origin by shifting all meshes when player moves beyond threshold
   * This prevents floating-point precision errors at large distances
   */
  updateFloatingOrigin(): void {
    if (!this.scene || !this.player) {
      return;
    }

    const avatar = this.player.getAvatar();
    const avatarMesh = avatar.getMesh();
    
    if (!avatarMesh) {
      return;
    }

    // Get current avatar world position
    const avatarPosition = avatarMesh.getAbsolutePosition();
    
    // Check if avatar has moved beyond threshold from current floating origin
    const distanceFromOrigin = Vector3.Distance(avatarPosition, this.currentFloatingOrigin);
    
    // Update floating origin if player has moved significantly
    // This maintains precision by keeping the coordinate system centered on the player
    if (distanceFromOrigin > this.floatingOriginThreshold) {
      // Calculate offset to shift all meshes (clone to avoid mutating avatarPosition)
      const offset = avatarPosition.clone().subtract(this.currentFloatingOrigin);
      
      // Shift all meshes in the scene to maintain precision
      // This effectively moves the world coordinate system to keep player near origin
      // All meshes including the avatar are shifted to maintain relative positions
      const meshes = this.scene.meshes;
      for (const mesh of meshes) {
        // Shift mesh position by the offset
        mesh.position.subtractInPlace(offset);
      }
      
      // Shift all lights in the scene that have a position property
      const lights = this.scene.lights;
      for (const light of lights) {
        // Only shift lights that have a position property (e.g., PointLight, SpotLight)
        // DirectionalLight and HemisphericLight don't have position, they use direction
        if ('position' in light && light.position instanceof Vector3) {
          light.position.subtractInPlace(offset);
        }
      }
      
      // Update current floating origin to player's position
      this.currentFloatingOrigin = avatarPosition.clone();
      
      if (this.logFn) {
        this.log(`Floating origin updated to player position: (${this.currentFloatingOrigin.x.toFixed(2)}, ${this.currentFloatingOrigin.y.toFixed(2)}, ${this.currentFloatingOrigin.z.toFixed(2)})`, 'info');
      }
    }
  }

  /**
   * Update test mode and recreate axis visualizer if needed
   */
  setTestMode(isTestMode: boolean): void {
    if (this.isTestMode === isTestMode) {
      return;
    }

    this.isTestMode = isTestMode;

    if (!this.scene) {
      return;
    }

    // Remove existing axis visualizer if any
    const xAxis = this.scene.getMeshByName('xAxis');
    const yAxis = this.scene.getMeshByName('yAxis');
    const zAxis = this.scene.getMeshByName('zAxis');
    const xLabelPlane = this.scene.getMeshByName('xLabelPlane');
    const yLabelPlane = this.scene.getMeshByName('yLabelPlane');
    const zLabelPlane = this.scene.getMeshByName('zLabelPlane');

    if (xAxis) {
      xAxis.dispose();
    }
    if (yAxis) {
      yAxis.dispose();
    }
    if (zAxis) {
      zAxis.dispose();
    }
    if (xLabelPlane) {
      xLabelPlane.dispose();
    }
    if (yLabelPlane) {
      yLabelPlane.dispose();
    }
    if (zLabelPlane) {
      zLabelPlane.dispose();
    }

    // Create axis visualizer if in test mode
    if (this.isTestMode) {
      this.createAxisVisualizer();
    }
  }

  /**
   * Set the background color of the scene
   */
  setBackgroundColor(hexColor: string): void {
    if (!this.scene) {
      return;
    }

    // Parse hex color to RGB
    const hex = hexColor.replace('#', '');
    const r = Number.parseInt(hex.substring(0, 2), 16) / 255;
    const g = Number.parseInt(hex.substring(2, 4), 16) / 255;
    const b = Number.parseInt(hex.substring(4, 6), 16) / 255;

    // Set clear color (RGBA, alpha = 1.0 for opaque)
    this.scene.clearColor = new Color4(r, g, b, 1.0);
  }

  /**
   * Dispose of the canvas manager and clean up resources
   */
  dispose(): void {
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }

    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }

    if (this.cameraManager) {
      this.cameraManager.dispose();
      this.cameraManager = null;
    }

    this.baseMeshes.clear();
    this.materials.clear();
    this.worldMap = null;
  }
}

