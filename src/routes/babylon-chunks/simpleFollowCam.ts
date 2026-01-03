/**
 * Simple Follow Camera Module
 * 
 * Implements an arc rotate camera that smoothly follows a target mesh.
 * Pattern inspired by SmoothFollowCameraController - follows example exactly.
 */

import { Scene, ArcRotateCamera, Vector3, Mesh, Observer, Quaternion, Scalar } from '@babylonjs/core';

/**
 * Configuration for simple follow camera
 */
const FOLLOW_CAMERA_CONFIG = {
  defaultRadius: 40, // meters - distance from target
  defaultAlpha: 0,   // horizontal rotation (radians)
  defaultBeta: Math.PI / 4, // vertical rotation (45 degrees)
  defaultOffset: new Vector3(0, 10.2, -20), // default offset from target (x, y, z)
  zoomMin: -50, // minimum zoom distance (offset.z)
  zoomMax: -5,  // maximum zoom distance (offset.z)
  dragSensitivity: 0.02, // drag sensitivity (matching the example)
} as const;

/**
 * Simple Follow Camera class
 * Manages an arc rotate camera that smoothly follows a target mesh
 * Follows SmoothFollowCameraController pattern exactly
 */
export class SimpleFollowCam {
  private scene: Scene;
  private camera: ArcRotateCamera | null = null;
  private targetMesh: Mesh | null = null;
  private beforeRenderObserver: Observer<Scene> | null = null;
  private offset: Vector3;
  private readonly dragSensitivity: number;
  private canvas: HTMLCanvasElement | null = null;

  /**
   * Create a new simple follow camera
   * @param scene - BabylonJS scene reference
   * @param canvas - HTML canvas element for camera controls
   * @param radius - Distance from target in meters (default: 40)
   * @param alpha - Horizontal rotation in radians (default: 0)
   * @param beta - Vertical rotation in radians (default: PI/4)
   * @param offset - Camera offset from target (default: (0, 10.2, -20))
   */
  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    radius: number = FOLLOW_CAMERA_CONFIG.defaultRadius,
    alpha: number = FOLLOW_CAMERA_CONFIG.defaultAlpha,
    beta: number = FOLLOW_CAMERA_CONFIG.defaultBeta,
    offset: Vector3 = FOLLOW_CAMERA_CONFIG.defaultOffset.clone(),
    dragSensitivity: number = FOLLOW_CAMERA_CONFIG.dragSensitivity
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.offset = offset.clone();
    this.dragSensitivity = dragSensitivity;

    // Create camera with initial target at origin
    const initialTarget = Vector3.Zero();
    this.camera = new ArcRotateCamera(
      'simpleFollowCamera',
      alpha,
      beta,
      radius,
      initialTarget,
      scene
    );
    this.camera.attachControl(canvas, true);

    // Set up render observer for smooth following (exactly like the example)
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.updateCamera();
    });

    // Set up wheel handler for zoom (like the example)
    this.setupWheelHandler();
  }

  /**
   * Set up wheel handler for zoom (matching the example)
   */
  private setupWheelHandler(): void {
    if (this.canvas) {
      this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    }
  }

  /**
   * Handle wheel event for zoom (matching the example exactly)
   */
  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Update offset.z based on scroll (exactly like the example - uses deltaX)
    this.offset.z += e.deltaX * this.dragSensitivity * 6;
    this.offset.z = Math.max(
      FOLLOW_CAMERA_CONFIG.zoomMin,
      Math.min(FOLLOW_CAMERA_CONFIG.zoomMax, this.offset.z)
    );
  };

  /**
   * Set the target mesh to follow
   * @param mesh - Mesh to follow, or null to clear target
   */
  setTarget(mesh: Mesh | null): void {
    const wasNull = this.targetMesh === null;
    this.targetMesh = mesh;
    
    // If we just set a target and camera exists, initialize camera position immediately
    if (mesh && wasNull && this.camera) {
      // Use absolute position to ensure correct positioning with floating origin
      const targetPosition = mesh.getAbsolutePosition();
      const targetRotationY = mesh.rotation.y;
      const yRot = Quaternion.FromEulerAngles(0, targetRotationY, 0);
      const rotatedOffset = this.offset.rotateByQuaternionToRef(yRot, Vector3.Zero());
      const desiredPos = targetPosition.add(rotatedOffset);
      
      // Snap camera to proper position immediately on first target set
      this.camera.position.copyFrom(desiredPos);
      this.camera.lockedTarget = targetPosition;
    }
  }

  /**
   * Reset lerping state (call when switching to this camera mode)
   */
  resetLerping(): void {
    // No-op - not needed with simplified approach
  }

  /**
   * Update camera (called every frame via onBeforeRenderObservable)
   * Matches the example's updateCamera pattern exactly
   */
  private updateCamera = (): void => {
    if (!this.camera || !this.targetMesh) {
      return;
    }

    // Always smooth follow (we don't have dragging in this simplified version)
    this.smoothFollowTarget();
  };

  /**
   * Smoothly follow the target using offset-based positioning
   * Matches the example's smoothFollowTarget() exactly
   */
  private smoothFollowTarget(): void {
    if (!this.camera || !this.targetMesh) {
      return;
    }

    // Rotate offset by target's Y rotation (exactly like the example)
    // Use absolute position to ensure correct positioning with floating origin
    const targetPosition = this.targetMesh.getAbsolutePosition();
    const yRot = Quaternion.FromEulerAngles(0, this.targetMesh.rotation.y, 0);
    const rotatedOffset = this.offset.rotateByQuaternionToRef(yRot, Vector3.Zero());
    const desiredPos = targetPosition.add(rotatedOffset);

    // Calculate dynamic smoothing based on offset.z (exactly like the example)
    // Closer camera (smaller offset.z, more negative) = more responsive (higher smoothing value)
    // Farther camera (larger offset.z, less negative) = more relaxed (lower smoothing value)
    const normalizedOffset = (this.offset.z - FOLLOW_CAMERA_CONFIG.zoomMin) / 
      (FOLLOW_CAMERA_CONFIG.zoomMax - FOLLOW_CAMERA_CONFIG.zoomMin);
    const dynamicSmoothing = Scalar.Lerp(0.05, 0.25, normalizedOffset);

    // Smoothly lerp camera position to desired position (exactly like the example)
    Vector3.LerpToRef(
      this.camera.position,
      desiredPos,
      dynamicSmoothing,
      this.camera.position
    );

    // Set locked target using absolute position to ensure correct positioning with floating origin
    this.camera.lockedTarget = targetPosition;
  }

  /**
   * Get the camera instance
   */
  getCamera(): ArcRotateCamera | null {
    return this.camera;
  }

  /**
   * Set camera radius (distance from target)
   * Note: For ArcRotateCamera compatibility, but offset.z is the real control
   */
  setRadius(radius: number): void {
    // Update offset.z to match radius (negative because it's behind player)
    this.offset.z = -radius;
    this.offset.z = Math.max(
      FOLLOW_CAMERA_CONFIG.zoomMin,
      Math.min(FOLLOW_CAMERA_CONFIG.zoomMax, this.offset.z)
    );
  }

  /**
   * Set camera offset
   * @param offset - The new camera offset vector
   */
  setOffset(offset: Vector3): void {
    this.offset.copyFrom(offset);
  }

  /**
   * Get camera offset
   */
  getOffset(): Vector3 {
    return this.offset.clone();
  }

  /**
   * Get current camera radius
   */
  getRadius(): number {
    if (this.camera) {
      return this.camera.radius;
    }
    return Math.abs(this.offset.z);
  }

  /**
   * Get target camera radius
   */
  getTargetRadius(): number {
    return Math.abs(this.offset.z);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }

    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this.handleWheel);
    }

    if (this.camera) {
      this.camera.dispose();
      this.camera = null;
    }
    this.targetMesh = null;
  }
}
