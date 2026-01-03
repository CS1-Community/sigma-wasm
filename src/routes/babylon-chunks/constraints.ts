/**
 * Constraints Configuration Module
 * 
 * Centralized configuration for layout generation constraints.
 * This provides easy access to default values and constraint settings.
 */

/**
 * Voronoi seed configuration
 */
export interface VoronoiSeeds {
  forest: number;
  water: number;
  grass: number;
}

/**
 * Building density ratios
 */
export interface BuildingDensityRatios {
  sparse: number;
  medium: number;
  dense: number;
}

/**
 * Road generation configuration
 */
export interface RoadConfig {
  defaultDensity: number;
  seedPointRatio: number; // Ratio of seed points to target road count (0.25 = 25%)
}

/**
 * Border road configuration
 */
export interface BorderRoadConfig {
  roadsPerBorder: number; // Number of roads required at each border (6 borders per chunk)
  connectToNeighbors: boolean; // Whether to connect to adjacent chunk border roads
}

/**
 * Constraints configuration object
 */
export const CONSTRAINTS = {
  /**
   * Default Voronoi region seeds
   */
  voronoiSeeds: {
    forest: 4,
    water: 3,
    grass: 6,
  } as VoronoiSeeds,

  /**
   * Default road density (0.0 to 1.0)
   */
  roadDensity: 0.1,

  /**
   * Road generation configuration
   */
  road: {
    defaultDensity: 0.1,
    seedPointRatio: 0.25, // 25% of target road count
  } as RoadConfig,

  /**
   * Border road configuration
   */
  borderRoad: {
    roadsPerBorder: 1, // One road at each of the 6 borders
    connectToNeighbors: true, // Connect to adjacent chunk border roads when possible
  } as BorderRoadConfig,

  /**
   * Building density ratios (percentage of available hexes)
   */
  buildingDensity: {
    sparse: 0.05,  // 5%
    medium: 0.1,   // 10%
    dense: 0.15,   // 15%
  } as BuildingDensityRatios,

  /**
   * Default building density level
   */
  defaultBuildingDensity: 'medium' as 'sparse' | 'medium' | 'dense',

  /**
   * Default building size hint
   */
  defaultBuildingSizeHint: 'medium' as 'small' | 'medium' | 'large',

  /**
   * Default clustering mode
   */
  defaultClustering: 'random' as 'clustered' | 'distributed' | 'random',

  /**
   * Default grass ratio (0.0 to 1.0)
   */
  defaultGrassRatio: 0.3,

  /**
   * Minimum adjacent roads required for building placement
   */
  minAdjacentRoads: 1,

  /**
   * Maximum rings allowed in grid
   */
  maxRings: 50,
} as const;

