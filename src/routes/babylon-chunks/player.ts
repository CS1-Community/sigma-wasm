/**
 * Player Module
 * 
 * Manages player state, avatar, and movement controller.
 */

import { Scene, Vector3 } from '@babylonjs/core';
import { MovementController } from './movementController';
import { Avatar } from './avatar';
import * as HexUtils from './hexUtils';

/**
 * Player class managing avatar and movement
 */
export class Player {
  private movementController: MovementController;
  private avatar: Avatar;

  /**
   * Create a new player
   * @param scene - BabylonJS scene reference
   * @param moveSpeed - Movement speed in units per second (default: 10)
   * @param rotationSpeed - Rotation speed in radians per second (default: 2)
   */
  constructor(scene: Scene, moveSpeed: number = 10, rotationSpeed: number = 2) {
    this.movementController = new MovementController(scene, moveSpeed, rotationSpeed);
    this.avatar = new Avatar(this, scene);
  }

  /**
   * Initialize player: set up movement controller and load avatar model
   * @param avatarUrl - URL to the avatar GLB model file
   */
  async initialize(avatarUrl: string): Promise<void> {
    this.movementController.initialize();
    await this.avatar.loadModel(avatarUrl);
  }

  /**
   * Update player state (movement controller and avatar)
   * Should be called every frame or at regular intervals
   */
  update(): void {
    this.movementController.update();
    this.avatar.tick();
  }

  /**
   * Get the movement controller
   */
  getMovementController(): MovementController {
    return this.movementController;
  }

  /**
   * Get the avatar
   */
  getAvatar(): Avatar {
    return this.avatar;
  }

  /**
   * Enable or disable the player
   * When disabled, both movement controller and avatar are disabled
   * @param enabled - Whether to enable the player
   * @param logFn - Optional logging function to log activation/deactivation
   */
  setEnabled(enabled: boolean, logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void): void {
    const wasEnabled = this.getEnabled();
    this.movementController.setEnabled(enabled);
    this.avatar.setEnabled(enabled);
    
    if (logFn && wasEnabled !== enabled) {
      if (enabled) {
        logFn('Player activated', 'success');
      } else {
        logFn('Player deactivated', 'info');
      }
    }
  }

  /**
   * Reset player position and rotation to origin
   * Position is reset to (0, 0, 0) in movement controller
   * Avatar will position itself at the correct Y height in tick()
   */
  reset(): void {
    this.movementController.setPosition(Vector3.Zero());
    this.movementController.setRotation(Vector3.Zero());
    // Update avatar immediately to reflect reset
    this.avatar.tick();
  }

  /**
   * Get whether the player is enabled
   */
  getEnabled(): boolean {
    return this.movementController.getEnabled() && this.avatar.getEnabled();
  }

  /**
   * Get the current tile hex coordinate based on player's position
   * @param hexSize - Size of hexagon for coordinate conversion
   * @returns Current tile hex coordinate
   */
  getCurrentTileHex(hexSize: number): HexUtils.HexCoord {
    const avatar = this.getAvatar();
    const avatarPos = avatar.getPosition();
    return HexUtils.HEX_UTILS.worldToHex(-avatarPos.x, avatarPos.z, hexSize);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.avatar.dispose();
    this.movementController.dispose();
  }
}

