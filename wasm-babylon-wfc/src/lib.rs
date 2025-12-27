use wasm_bindgen::prelude::*;
use std::sync::{LazyLock, Mutex};
use std::collections::{HashMap, HashSet, BinaryHeap};
use std::cmp::Ordering;

/// Tile type enumeration for 5 simple tile types
/// 
/// **Learning Point**: Simplified tile types for hex grid layout generation.
/// Each tile type represents a terrain or structure type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(i32)]
pub enum TileType {
    Grass = 0,
    Building = 1,
    Road = 2,
    Forest = 3,
    Water = 4,
}

/// State structure using hash map for efficient sparse grid storage
/// 
/// **Learning Point**: Uses HashMap<(i32, i32), TileType> for O(1) lookups and
/// no size limitations. Keys are (q, r) hex coordinates.
struct WfcState {
    grid: HashMap<(i32, i32), TileType>,
    pre_constraints: HashMap<(i32, i32), TileType>,
}

impl WfcState {
    fn new() -> Self {
        WfcState {
            grid: HashMap::new(),
            pre_constraints: HashMap::new(),
        }
    }
    
    fn clear(&mut self) {
        self.grid.clear();
        // DO NOT clear pre_constraints - they must persist
    }
    
    /// Set a pre-constraint at a specific hex position (q, r)
    /// Returns true if the constraint was set successfully
    fn set_pre_constraint(&mut self, q: i32, r: i32, tile_type: TileType) -> bool {
        self.pre_constraints.insert((q, r), tile_type);
        true
    }
    
    /// Clear all pre-constraints
    fn clear_pre_constraints(&mut self) {
        self.pre_constraints.clear();
    }
    
    /// Get tile at hex coordinate (q, r)
    fn get_tile(&self, q: i32, r: i32) -> Option<TileType> {
        self.grid.get(&(q, r)).copied()
    }
    
    /// Get all 6 hex neighbors of a coordinate
    fn get_hex_neighbors(&self, q: i32, r: i32) -> Vec<(i32, i32)> {
        vec![
            (q + 1, r),
            (q - 1, r),
            (q, r + 1),
            (q, r - 1),
            (q + 1, r - 1),
            (q - 1, r + 1),
        ]
    }
}

/// Hex coordinate structure for Voronoi generation
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct HexCoord {
    q: i32,
    r: i32,
}

/// Seed point for Voronoi region generation
#[derive(Clone, Copy, Debug)]
struct VoronoiSeed {
    q: i32,
    r: i32,
    tile_type: TileType,
}

/// Calculate hex distance between two hex coordinates (cube distance)
/// Uses axial coordinates converted to cube coordinates
/// Formula: (|dq| + |dr| + |ds|) / 2 where s = -q - r
/// This matches the Python example: (abs(q1-q2) + abs(r1-r2) + abs(s1-s2)) // 2
fn hex_distance(q1: i32, r1: i32, q2: i32, r2: i32) -> i32 {
    let s1 = -q1 - r1;
    let s2 = -q2 - r2;
    ((q1 - q2).abs() + (r1 - r2).abs() + (s1 - s2).abs()) / 2
}

/// A* node for pathfinding
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AStarNode {
    q: i32,
    r: i32,
    g: i32,
    h: i32,
    f: i32,
}

impl AStarNode {
    fn new(q: i32, r: i32, g: i32, h: i32) -> Self {
        AStarNode {
            q,
            r,
            g,
            h,
            f: g + h,
        }
    }
}

impl Ord for AStarNode {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse order for min-heap (lowest f score first)
        other.f.cmp(&self.f)
            .then_with(|| other.h.cmp(&self.h))
    }
}

impl PartialOrd for AStarNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Get all 6 hex neighbors of a coordinate (axial)
fn get_hex_neighbors(q: i32, r: i32) -> Vec<(i32, i32)> {
    vec![
        (q + 1, r),
        (q - 1, r),
        (q, r + 1),
        (q, r - 1),
        (q + 1, r - 1),
        (q - 1, r + 1),
    ]
}

/// Hex A* pathfinding between two road tiles
/// Returns path length, or -1 if unreachable
/// Only considers road tiles as valid path nodes
/// 
/// Algorithm matches Python example:
/// - Uses f_cost = g_cost + h_cost for priority
/// - g_cost is path cost from start (uniform cost of 1 per step)
/// - h_cost is hex distance heuristic
/// - Explores nodes with lowest f_cost first
fn hex_astar_path(
    start_q: i32,
    start_r: i32,
    goal_q: i32,
    goal_r: i32,
    roads: &HashSet<(i32, i32)>,
) -> i32 {
    // Check if start and goal are roads
    if !roads.contains(&(start_q, start_r)) || !roads.contains(&(goal_q, goal_r)) {
        return -1;
    }

    // If start equals goal, path length is 0
    if start_q == goal_q && start_r == goal_r {
        return 0;
    }

    // Calculate heuristic (hex distance) - now using correct formula
    let h_start = hex_distance(start_q, start_r, goal_q, goal_r);

    let mut open_set = BinaryHeap::new();
    let mut closed_set = HashSet::new();
    let mut g_scores: HashMap<(i32, i32), i32> = HashMap::new();

    open_set.push(AStarNode::new(start_q, start_r, 0, h_start));
    g_scores.insert((start_q, start_r), 0);

    while let Some(current) = open_set.pop() {
        let current_key = (current.q, current.r);

        // Skip if already processed (duplicate in open_set)
        if closed_set.contains(&current_key) {
            continue;
        }

        closed_set.insert(current_key);

        // Check if we reached the goal
        if current.q == goal_q && current.r == goal_r {
            return current.g;
        }

        // Explore neighbors - get all 6 hex neighbors
        let neighbors = get_hex_neighbors(current.q, current.r);
        for (nq, nr) in neighbors {
            let neighbor_key = (nq, nr);

            // Skip if not a road (obstacle check)
            if !roads.contains(&neighbor_key) {
                continue;
            }

            // Skip if already closed
            if closed_set.contains(&neighbor_key) {
                continue;
            }

            // Calculate tentative g score (uniform cost of 1 per step)
            let tentative_g = current.g + 1;

            // Check if this is a better path (matches Python: if neighbor not in g_cost or tentative_g < g_cost[neighbor])
            let current_g = g_scores.get(&neighbor_key).copied().unwrap_or(i32::MAX);
            if tentative_g < current_g {
                // This path to neighbor is better - record it
                g_scores.insert(neighbor_key, tentative_g);
                let h = hex_distance(nq, nr, goal_q, goal_r);
                open_set.push(AStarNode::new(nq, nr, tentative_g, h));
            }
        }
    }

    // No path found
    -1
}

/// Validate that all road tiles are reachable from each other using A* pathfinding
/// 
/// Uses transitive property: if all roads are reachable from one source road,
/// then all pairs have paths (by transitivity: A->B and B->C implies A->C).
/// 
/// @param roads_json - JSON string with array of road coordinates: [{"q":0,"r":0},{"q":1,"r":0},...]
/// @returns true if all roads are reachable from source, false otherwise
#[wasm_bindgen]
pub fn validate_road_connectivity(roads_json: String) -> bool {
    // Parse roads from JSON
    // Simple JSON parsing without serde to keep WASM size small
    let mut roads: Vec<(i32, i32)> = Vec::new();
    
    // Remove whitespace and brackets
    let trimmed = roads_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return true; // Empty roads is trivially connected
    }

    // Simple JSON parsing: find all {"q":X,"r":Y} patterns
    // This is a simplified parser that handles the expected format: [{"q":0,"r":0},...]
    let mut i = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    while i < chars.len() {
        // Look for opening brace
        if chars[i] == '{' {
            let mut q_value: Option<i32> = None;
            let mut r_value: Option<i32> = None;
            
            i += 1;
            while i < chars.len() && chars[i] != '}' {
                // Look for "q" or "r" followed by colon and number
                if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'q' && chars[i + 2] == '"' {
                    i += 3;
                    // Skip colon and whitespace
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    // Parse number
                    if i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '-') {
                        let start = i;
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                        let num_str: String = chars[start..i].iter().collect();
                        if let Ok(num) = num_str.parse::<i32>() {
                            q_value = Some(num);
                        }
                    }
                } else if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'r' && chars[i + 2] == '"' {
                    i += 3;
                    // Skip colon and whitespace
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    // Parse number
                    if i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '-') {
                        let start = i;
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                        let num_str: String = chars[start..i].iter().collect();
                        if let Ok(num) = num_str.parse::<i32>() {
                            r_value = Some(num);
                        }
                    }
                } else {
                    i += 1;
                }
            }
            
            if let (Some(q), Some(r)) = (q_value, r_value) {
                roads.push((q, r));
            }
        }
        i += 1;
    }

    if roads.is_empty() {
        return true;
    }

    if roads.len() == 1 {
        // Single road - check if it has at least one road neighbor
        // For single road, we consider it valid (can't check neighbors without more context)
        return true;
    }

    // Convert to HashSet for O(1) lookups
    let roads_set: HashSet<(i32, i32)> = roads.iter().cloned().collect();

    // Use first road as source
    let source = roads[0];

    // Check if all other roads are reachable from source using A*
    for road in roads.iter().skip(1) {
        let path_length = hex_astar_path(source.0, source.1, road.0, road.1, &roads_set);
        if path_length == -1 {
            return false; // Unreachable road found
        }
    }

    true // All roads reachable from source
}

/// Cube coordinate structure
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct CubeCoord {
    q: i32,
    r: i32,
    s: i32,
}

/// Cube directions for hex grid navigation
const CUBE_DIRECTIONS: [CubeCoord; 6] = [
    CubeCoord { q: 1, r: 0, s: -1 },   // Direction 0
    CubeCoord { q: 1, r: -1, s: 0 },   // Direction 1
    CubeCoord { q: 0, r: -1, s: 1 },   // Direction 2
    CubeCoord { q: -1, r: 0, s: 1 },  // Direction 3
    CubeCoord { q: -1, r: 1, s: 0 },  // Direction 4
    CubeCoord { q: 0, r: 1, s: -1 },  // Direction 5
];

/// Add two cube coordinates
fn cube_add(a: CubeCoord, b: CubeCoord) -> CubeCoord {
    CubeCoord {
        q: a.q + b.q,
        r: a.r + b.r,
        s: a.s + b.s,
    }
}

/// Scale a cube coordinate by a factor
fn cube_scale(hex: CubeCoord, factor: i32) -> CubeCoord {
    CubeCoord {
        q: hex.q * factor,
        r: hex.r * factor,
        s: hex.s * factor,
    }
}

/// Get cube neighbor in specified direction (0-5)
fn cube_neighbor(cube: CubeCoord, direction: usize) -> CubeCoord {
    cube_add(cube, CUBE_DIRECTIONS[direction % 6])
}

/// Generate ring of tiles at specific layer (radius) around center
fn cube_ring(center: CubeCoord, radius: i32) -> Vec<CubeCoord> {
    if radius == 0 {
        return vec![center];
    }
    
    let mut results = Vec::new();
    
    // Start at the first hex of the ring by moving from the center
    // Move 'radius' steps in direction 4 (CUBE_DIRECTIONS[4])
    let mut current_hex = cube_add(center, cube_scale(CUBE_DIRECTIONS[4], radius));
    
    // Traverse the six sides of the hexagonal ring
    for i in 0..6 {
        // For each side, take 'radius' steps in the current direction
        for _j in 0..radius {
            results.push(current_hex);
            current_hex = cube_neighbor(current_hex, i);
        }
    }
    
    results
}

/// Generate hexagon grid up to max_layer
/// Returns all hex coordinates within the hexagon pattern
/// Matches TypeScript implementation using cube coordinates
fn generate_hex_grid(max_layer: i32, center_q: i32, center_r: i32) -> Vec<HexCoord> {
    let mut grid_set = HashSet::new();
    let center_cube = CubeCoord {
        q: center_q,
        r: center_r,
        s: -center_q - center_r,
    };
    
    // Generate grid from center outwards, adding one ring at a time
    for layer in 0..=max_layer {
        let ring = cube_ring(center_cube, layer);
        for cube in ring {
            // Use tuple of coordinates as hashable key for the set
            grid_set.insert((cube.q, cube.r, cube.s));
        }
    }
    
    // Convert set to array of HexCoord, verifying cube coordinate constraint
    let mut grid = Vec::new();
    for (q, r, s) in grid_set {
        // Verify cube coordinate is valid (q + r + s = 0)
        if q + r + s == 0 {
            grid.push(HexCoord { q, r });
        }
    }
    
    grid
}

/// Generate Voronoi regions for specified tile types
/// 
/// **Learning Point**: Generates seed points for each region type and assigns
/// each hex tile to the nearest seed point, creating Voronoi regions.
/// Returns JSON string with array of {q, r, tileType} objects.
/// 
/// @param max_layer - Maximum layer of hexagon (determines grid size)
/// @param center_q - Center q coordinate
/// @param center_r - Center r coordinate
/// @param forest_seeds - Number of forest region seeds
/// @param water_seeds - Number of water region seeds
/// @param grass_seeds - Number of grass region seeds
/// @returns JSON string with array of pre-constraints: [{"q":0,"r":0,"tileType":3},...]
#[wasm_bindgen]
pub fn generate_voronoi_regions(
    max_layer: i32,
    center_q: i32,
    center_r: i32,
    forest_seeds: i32,
    water_seeds: i32,
    grass_seeds: i32,
) -> String {
    // Generate hex grid
    let hex_grid = generate_hex_grid(max_layer, center_q, center_r);
    
    if hex_grid.is_empty() {
        return "[]".to_string();
    }
    
    // Find bounds for seed generation
    let min_q = hex_grid.iter().map(|h| h.q).min().unwrap_or(0);
    let max_q = hex_grid.iter().map(|h| h.q).max().unwrap_or(0);
    let min_r = hex_grid.iter().map(|h| h.r).min().unwrap_or(0);
    let max_r = hex_grid.iter().map(|h| h.r).max().unwrap_or(0);
    
    // Generate seed points
    let mut seeds: Vec<VoronoiSeed> = Vec::new();
    
    // Generate forest seeds
    for _ in 0..forest_seeds {
        let q = (js_random() * (max_q - min_q + 1) as f64) as i32 + min_q;
        let r = (js_random() * (max_r - min_r + 1) as f64) as i32 + min_r;
        seeds.push(VoronoiSeed {
            q,
            r,
            tile_type: TileType::Forest,
        });
    }
    
    // Generate water seeds
    for _ in 0..water_seeds {
        let q = (js_random() * (max_q - min_q + 1) as f64) as i32 + min_q;
        let r = (js_random() * (max_r - min_r + 1) as f64) as i32 + min_r;
        seeds.push(VoronoiSeed {
            q,
            r,
            tile_type: TileType::Water,
        });
    }
    
    // Generate grass seeds
    for _ in 0..grass_seeds {
        let q = (js_random() * (max_q - min_q + 1) as f64) as i32 + min_q;
        let r = (js_random() * (max_r - min_r + 1) as f64) as i32 + min_r;
        seeds.push(VoronoiSeed {
            q,
            r,
            tile_type: TileType::Grass,
        });
    }
    
    // Assign each hex to nearest seed and build JSON
    let mut json_parts = Vec::new();
    for hex in hex_grid {
        let mut nearest_seed: Option<&VoronoiSeed> = None;
        let mut min_dist = i32::MAX;
        
        for seed in &seeds {
            let dist = hex_distance(hex.q, hex.r, seed.q, seed.r);
            if dist < min_dist {
                min_dist = dist;
                nearest_seed = Some(seed);
            }
        }
        
        if let Some(seed) = nearest_seed {
            json_parts.push(format!(
                r#"{{"q":{},"r":{},"tileType":{}}}"#,
                hex.q, hex.r, seed.tile_type as i32
            ));
        }
    }
    
    format!("[{}]", json_parts.join(","))
}

static WFC_STATE: LazyLock<Mutex<WfcState>> = LazyLock::new(|| Mutex::new(WfcState::new()));

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Generate a simplified layout using pre-constraints
/// 
/// **Learning Point**: This implements a simple algorithm:
/// 1. Apply pre-constraints to grid (all tile types set by TypeScript)
/// 2. Fill any remaining empty cells with grass (shouldn't happen if pre-constraints are complete)
#[wasm_bindgen]
pub fn generate_layout() {
    let mut state = WFC_STATE.lock().unwrap();
    state.clear();
    
    // Step 1: Apply pre-constraints to grid
    // Pre-constraints take absolute precedence - TypeScript sets all tiles
    // Collect pre-constraints into a vector first to avoid borrow checker issues
    let pre_constraints: Vec<((i32, i32), TileType)> = state.pre_constraints.iter().map(|((q, r), tile_type)| ((*q, *r), *tile_type)).collect();
    for ((q, r), tile_type) in pre_constraints {
        state.grid.insert((q, r), tile_type);
    }
    
    // Step 2: Fill any remaining empty cells with grass (shouldn't be needed if pre-constraints are complete)
    // This is a safety fallback
}

/// Get tile type at a specific hex grid position
/// 
/// **Learning Point**: This function is called from TypeScript to get the tile
/// at a specific hex position for rendering. Returns -1 if position is invalid or empty.
/// 
/// @param q - Hex column coordinate (axial, 0-49)
/// @param r - Hex row coordinate (axial, 0-49)
/// @returns Tile type as i32, or -1 if invalid/empty
#[wasm_bindgen]
pub fn get_tile_at(q: i32, r: i32) -> i32 {
    let state = WFC_STATE.lock().unwrap();
    if let Some(tile) = state.get_tile(q, r) {
        tile as i32
    } else {
        -1
    }
}

/// Clear the current layout
/// 
/// **Learning Point**: This resets the grid to all empty cells. Called when
/// the user clicks "Recompute Wave Collapse" to start fresh.
#[wasm_bindgen]
pub fn clear_layout() {
    let mut state = WFC_STATE.lock().unwrap();
    state.clear();
}

/// Set a pre-constraint at a specific hex position
/// 
/// **Learning Point**: Pre-constraints allow external systems to set specific tiles.
/// This enables guided generation based on high-level layout descriptions.
/// 
/// @param q - Hex column coordinate (axial q)
/// @param r - Hex row coordinate (axial r)
/// @param tile_type - Tile type as i32 (0-4, matching TileType enum)
/// @returns true if constraint was set successfully, false if tile type is invalid
#[wasm_bindgen]
pub fn set_pre_constraint(q: i32, r: i32, tile_type: i32) -> bool {
    let mut state = WFC_STATE.lock().unwrap();
    
    // Convert i32 to TileType
    let tile = match tile_type {
        0 => TileType::Grass,
        1 => TileType::Building,
        2 => TileType::Road,
        3 => TileType::Forest,
        4 => TileType::Water,
        _ => return false, // Invalid tile type
    };
    
    state.set_pre_constraint(q, r, tile)
}

/// Clear all pre-constraints
/// 
/// **Learning Point**: This clears all pre-constraints, allowing WFC to generate
/// completely random layouts again. Useful for resetting after text-guided generation.
#[wasm_bindgen]
pub fn clear_pre_constraints() {
    let mut state = WFC_STATE.lock().unwrap();
    state.clear_pre_constraints();
}

/// Get statistics about the current grid
/// 
/// **Learning Point**: This function iterates over the hash map to count all tile types.
/// Returns a JSON string with counts for each tile type.
/// Follows the pattern from wasm-agent-tools - builds JSON manually without serde
/// to keep WASM size small.
/// 
/// @returns JSON string with tile counts: {"grass":X,"building":Y,"road":Z,"forest":A,"water":B,"total":C}
#[wasm_bindgen]
pub fn get_stats() -> String {
    let state = WFC_STATE.lock().unwrap();
    
    let mut grass = 0;
    let mut building = 0;
    let mut road = 0;
    let mut forest = 0;
    let mut water = 0;
    
    for tile_type in state.grid.values() {
        match tile_type {
            TileType::Grass => grass += 1,
            TileType::Building => building += 1,
            TileType::Road => road += 1,
            TileType::Forest => forest += 1,
            TileType::Water => water += 1,
        }
    }
    
    let total = grass + building + road + forest + water;
    
    format!(
        r#"{{"grass":{},"building":{},"road":{},"forest":{},"water":{},"total":{}}}"#,
        grass, building, road, forest, water, total
    )
}

/// JavaScript random number generator
/// 
/// **Learning Point**: WASM can't generate random numbers directly, so we
/// call back to JavaScript's Math.random(). This is set up in the TypeScript code.
/// The function is attached to globalThis in the TypeScript route handler.
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "js_random")]
    fn js_random() -> f64;
}

