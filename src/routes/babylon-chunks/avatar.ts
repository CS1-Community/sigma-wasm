/**
 * Avatar Module
 * 
 * Handles avatar mesh loading and position updates from movement controller.
 */

import { Scene, Mesh, Vector3, StandardMaterial, Color3 } from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { Player } from './player';

/**
 * Avatar class representing the player's visual representation in the scene
 */
export class Avatar {
  private player: Player;
  private scene: Scene;
  private mesh: Mesh | null = null;
  private enabled: boolean = true;

  /**
   * Create a new avatar
   * @param player - Reference to parent player instance
   * @param scene - BabylonJS scene reference
   */
  constructor(player: Player, scene: Scene) {
    this.player = player;
    this.scene = scene;
  }

  /**
   * Load avatar model from GLB file
   * @param url - URL to the GLB model file
   */
  async loadModel(url: string): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync('', url, '', this.scene);

      if (result.meshes.length === 0) {
        throw new Error('No meshes found in GLB model');
      }

      // Find the root mesh (the top-level container that contains all submeshes)
      // GLB files typically have a root node that contains all geometry as children
      let rootMesh: Mesh | null = null;

      // Find the root mesh (one without a parent, or the first mesh if all have parents)
      for (const mesh of result.meshes) {
        if (mesh instanceof Mesh) {
          // If this mesh has no parent, it's likely the root
          if (!mesh.parent) {
            rootMesh = mesh;
            break;
          }
        }
      }

      // If no root found (all meshes have parents), use the first mesh
      if (!rootMesh && result.meshes.length > 0) {
        const firstMesh = result.meshes[0];
        if (firstMesh instanceof Mesh) {
          rootMesh = firstMesh;
        }
      }

      if (!rootMesh) {
        throw new Error('Could not find root mesh in GLB model');
      }

      // Ensure root mesh and all child meshes are visible
      const setMeshVisible = (mesh: Mesh): void => {
        mesh.isVisible = true;
        mesh.setEnabled(true);
        const childMeshes = mesh.getChildMeshes();
        for (const childMesh of childMeshes) {
          if (childMesh instanceof Mesh) {
            setMeshVisible(childMesh);
          }
        }
      };
      setMeshVisible(rootMesh);

      // Ensure child meshes have materials (preserve original materials from GLB)
      // If any child mesh lacks a material, apply a default one
      const ensureMaterials = (mesh: Mesh): void => {
        if (!mesh.material) {
          const defaultMaterial = new StandardMaterial(`avatarMaterial_${mesh.name}`, this.scene);
          defaultMaterial.emissiveColor = new Color3(1, 0.5, 0); // Orange color for visibility
          defaultMaterial.disableLighting = true;
          mesh.material = defaultMaterial;
        }
        const childMeshes = mesh.getChildMeshes();
        for (const childMesh of childMeshes) {
          if (childMesh instanceof Mesh) {
            ensureMaterials(childMesh);
          }
        }
      };
      ensureMaterials(rootMesh);

      // Set initial position at origin, but raise it above the ground
      // Use 0.6m Y offset to be above the map
      const yOffset = 0.6;
      rootMesh.position = new Vector3(0, yOffset, 0);
      rootMesh.rotation = Vector3.Zero();

      this.mesh = rootMesh;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load avatar model: ${errorMsg}`);
    }
  }

  /**
   * Update avatar position and rotation from movement controller
   * Should be called every frame or at regular intervals
   */
  tick(): void {
    if (!this.mesh || !this.enabled) {
      return;
    }

    const movementController = this.player.getMovementController();
    const position = movementController.getPosition();
    const rotation = movementController.getRotation();

    // Update mesh position
    // Keep Y position at 0.6m offset to be above the map
    const yOffset = 0.6;
    this.mesh.position.x = position.x;
    this.mesh.position.y = yOffset;
    this.mesh.position.z = position.z;

    // Update mesh rotation (yaw only, around Y axis)
    this.mesh.rotation.y = rotation.y;
  }

  /**
   * Get the avatar mesh
   */
  getMesh(): Mesh | null {
    return this.mesh;
  }

  /**
   * Get current world position (absolute position)
   * Always returns the absolute world position, which remains stable even when floating origin shifts meshes
   * This ensures chunk loading and tile calculations work correctly with floating origin
   */
  getPosition(): Vector3 {
    if (this.mesh) {
      // Use getAbsolutePosition() to get world position, not local position
      // This ensures position is correct even when floating origin shifts meshes
      return this.mesh.getAbsolutePosition();
    }
    return Vector3.Zero();
  }

  /**
   * Enable or disable the avatar
   * When disabled, the mesh is hidden and updates are skipped
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.mesh) {
      const setMeshEnabled = (mesh: Mesh): void => {
        mesh.setEnabled(enabled);
        mesh.isVisible = enabled;
        const childMeshes = mesh.getChildMeshes();
        for (const childMesh of childMeshes) {
          if (childMesh instanceof Mesh) {
            setMeshEnabled(childMesh);
          }
        }
      };
      setMeshEnabled(this.mesh);
    }
  }

  /**
   * Get whether the avatar is enabled
   */
  getEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
  }
}

