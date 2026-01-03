/**
 * Movement Controller Module
 * 
 * Handles keyboard input (WASD/Arrow keys) for avatar movement using BabylonJS input system.
 */

import { Scene, Vector3 } from '@babylonjs/core';

/**
 * Movement Controller class for handling keyboard input and updating position/rotation
 */
export class MovementController {
  private scene: Scene;
  private position: Vector3;
  private rotation: Vector3; // yaw rotation in radians
  private moveSpeed: number;
  private rotationSpeed: number;
  private keysPressed: Set<string>;
  private lastUpdateTime: number;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((event: KeyboardEvent) => void) | null = null;
  private enabled: boolean = true;

  /**
   * Create a new movement controller
   * @param scene - BabylonJS scene reference
   * @param moveSpeed - Movement speed in units per second (default: 10)
   * @param rotationSpeed - Rotation speed in radians per second (default: 2)
   */
  constructor(scene: Scene, moveSpeed: number = 10, rotationSpeed: number = 2) {
    this.scene = scene;
    this.position = Vector3.Zero();
    this.rotation = Vector3.Zero();
    this.moveSpeed = moveSpeed;
    this.rotationSpeed = rotationSpeed;
    this.keysPressed = new Set<string>();
    this.lastUpdateTime = performance.now();
  }

  /**
   * Initialize keyboard input handlers
   */
  initialize(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) {
      return;
    }

    // Handle keydown events
    const keydownHandler = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 'a' || key === 's' || key === 'd' ||
          key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright') {
        this.keysPressed.add(key);
        event.preventDefault();
      }
      // Track Shift key for speed boost
      if (key === 'shift' || event.shiftKey) {
        this.keysPressed.add('shift');
      }
    };

    // Handle keyup events
    const keyupHandler = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      this.keysPressed.delete(key);
      // Remove Shift if the Shift key itself was released
      if (key === 'shift') {
        this.keysPressed.delete('shift');
      }
    };

    // Add event listeners
    window.addEventListener('keydown', keydownHandler);
    window.addEventListener('keyup', keyupHandler);

    // Store handlers for cleanup
    this.keydownHandler = keydownHandler;
    this.keyupHandler = keyupHandler;
  }

  /**
   * Update position and rotation based on current input
   * Should be called every frame or at regular intervals
   */
  update(): void {
    if (!this.enabled) {
      return;
    }

    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastUpdateTime) / 1000; // Convert to seconds
    this.lastUpdateTime = currentTime;

    // Handle rotation (A/D or Left/Right arrows)
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft')) {
      this.rotation.y -= this.rotationSpeed * deltaTime;
    }
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) {
      this.rotation.y += this.rotationSpeed * deltaTime;
    }

    // Handle movement (W/S or Up/Down arrows)
    // Calculate forward direction from rotation
    const forwardX = Math.sin(this.rotation.y);
    const forwardZ = Math.cos(this.rotation.y);

    // Apply 5x speed boost when Shift is pressed
    const speedMultiplier = this.keysPressed.has('shift') ? 5 : 1;
    const currentMoveSpeed = this.moveSpeed * speedMultiplier;

    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup')) {
      // Move forward
      this.position.x += forwardX * currentMoveSpeed * deltaTime;
      this.position.z += forwardZ * currentMoveSpeed * deltaTime;
    }
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown')) {
      // Move backward
      this.position.x -= forwardX * currentMoveSpeed * deltaTime;
      this.position.z -= forwardZ * currentMoveSpeed * deltaTime;
    }
  }

  /**
   * Get current position
   */
  getPosition(): Vector3 {
    return this.position.clone();
  }

  /**
   * Get current rotation (yaw angle)
   */
  getRotation(): Vector3 {
    return this.rotation.clone();
  }

  /**
   * Set position
   */
  setPosition(position: Vector3): void {
    this.position = position.clone();
  }

  /**
   * Set rotation
   */
  setRotation(rotation: Vector3): void {
    this.rotation = rotation.clone();
  }

  /**
   * Enable or disable the movement controller
   * When disabled, input is ignored and position/rotation are not updated
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // Clear all pressed keys when disabling
      this.keysPressed.clear();
    }
  }

  /**
   * Get whether the movement controller is enabled
   */
  getEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Dispose of resources and clean up event listeners
   */
  dispose(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler);
      this.keyupHandler = null;
    }

    this.keysPressed.clear();
  }
}

