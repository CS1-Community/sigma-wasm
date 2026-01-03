/**
 * Camera Manager Module
 * 
 * Manages camera mode switching between Free Camera and Simple Follow modes.
 */

import { Scene, ArcRotateCamera, Vector3 } from '@babylonjs/core';
import { SimpleFollowCam } from './simpleFollowCam';
import { CAMERA_CONFIG } from './canvasManagement';
import type { Player } from './player';

/**
 * Camera mode type
 */
type CameraMode = 'free' | 'simple-follow';

/**
 * Camera Manager class
 * Handles switching between different camera modes
 */
export class CameraManager {
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private mode: CameraMode;
  private freeCamera: ArcRotateCamera | null = null;
  private followCamera: SimpleFollowCam | null = null;
  private player: Player | null = null;

  /**
   * Create a new camera manager
   * @param scene - BabylonJS scene reference
   * @param canvas - HTML canvas element for camera controls
   * @param initialMode - Initial camera mode (default: 'simple-follow')
   */
  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    initialMode: CameraMode = 'simple-follow'
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.mode = initialMode;

    // Initialize cameras based on mode
    this.initializeCameras();
  }

  /**
   * Initialize cameras based on current mode
   */
  private initializeCameras(): void {
    if (this.mode === 'free') {
      this.initializeFreeCamera();
    } else {
      this.initializeFollowCamera();
    }
  }

  /**
   * Initialize free camera (targets grid center)
   */
  private initializeFreeCamera(): void {
    // Dispose follow camera if it exists
    if (this.followCamera) {
      this.followCamera.dispose();
      this.followCamera = null;
    }

    // Create free camera if it doesn't exist
    if (!this.freeCamera) {
      const gridCenter = new Vector3(
        CAMERA_CONFIG.gridCenter.x,
        CAMERA_CONFIG.gridCenter.y,
        CAMERA_CONFIG.gridCenter.z
      );
      this.freeCamera = new ArcRotateCamera(
        'freeCamera',
        CAMERA_CONFIG.initialAlpha,
        CAMERA_CONFIG.initialBeta,
        CAMERA_CONFIG.initialRadius,
        gridCenter,
        this.scene
      );
      this.freeCamera.attachControl(this.canvas, true);
    }
  }

  /**
   * Initialize follow camera
   */
  private initializeFollowCamera(): void {
    // Dispose free camera if it exists
    if (this.freeCamera) {
      this.freeCamera.dispose();
      this.freeCamera = null;
    }

    // Create follow camera if it doesn't exist
    if (!this.followCamera) {
      this.followCamera = new SimpleFollowCam(
        this.scene,
        this.canvas
      );

      // Set target if player is available
      if (this.player) {
        const avatar = this.player.getAvatar();
        const avatarMesh = avatar.getMesh();
        if (avatarMesh) {
          this.followCamera.setTarget(avatarMesh);
          // Reset lerping to capture starting position when switching modes
          this.followCamera.resetLerping();
        }
      }
    } else {
      // Camera already exists - reset lerping when switching back to follow mode
      if (this.player) {
        const avatar = this.player.getAvatar();
        const avatarMesh = avatar.getMesh();
        if (avatarMesh) {
          this.followCamera.setTarget(avatarMesh);
          this.followCamera.resetLerping();
        }
      }
    }
  }

  /**
   * Set camera mode
   * @param mode - Camera mode to switch to
   */
  setMode(mode: CameraMode): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.initializeCameras();
  }

  /**
   * Get current camera mode
   */
  getMode(): CameraMode {
    return this.mode;
  }

  /**
   * Set player reference for follow camera
   * @param player - Player instance, or null to clear
   */
  setPlayer(player: Player | null): void {
    this.player = player;

    // Update follow camera target if in follow mode
    if (this.mode === 'simple-follow' && this.followCamera) {
      if (player) {
        const avatar = player.getAvatar();
        const avatarMesh = avatar.getMesh();
        if (avatarMesh) {
          this.followCamera.setTarget(avatarMesh);
        } else {
          this.followCamera.setTarget(null);
        }
      } else {
        this.followCamera.setTarget(null);
      }
    }
  }

  /**
   * Update camera state (for follow mode)
   * Note: The follow camera now uses onBeforeRenderObservable internally,
   * so this method is mainly for ensuring target is set correctly
   */
  update(): void {
    if (this.mode === 'simple-follow' && this.followCamera) {
      // Ensure target is set if player exists but target wasn't set yet
      if (this.player && this.followCamera) {
        const avatar = this.player.getAvatar();
        const avatarMesh = avatar.getMesh();
        if (avatarMesh) {
          // Check if target needs to be set (in case it wasn't set initially)
          // The followCamera will handle updating the position via onBeforeRenderObservable
          this.followCamera.setTarget(avatarMesh);
        }
      }
    }
  }

  /**
   * Get the active camera
   */
  getCamera(): ArcRotateCamera | null {
    if (this.mode === 'free') {
      return this.freeCamera;
    } else {
      return this.followCamera?.getCamera() ?? null;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.freeCamera) {
      this.freeCamera.dispose();
      this.freeCamera = null;
    }
    if (this.followCamera) {
      this.followCamera.dispose();
      this.followCamera = null;
    }
    this.player = null;
  }
}

