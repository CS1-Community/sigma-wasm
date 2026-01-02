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

/// A* node for pathfinding with parent pointer for path reconstruction
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AStarNode {
    q: i32,
    r: i32,
    g: i32,
    h: i32,
    f: i32,
    parent_q: i32,
    parent_r: i32,
}

impl AStarNode {
    fn new(q: i32, r: i32, g: i32, h: i32, parent_q: i32, parent_r: i32) -> Self {
        AStarNode {
            q,
            r,
            g,
            h,
            f: g + h,
            parent_q,
            parent_r,
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

/// Convert axial coordinates to cube coordinates
/// Cube coordinates: (q, r, s) where q + r + s = 0
fn axial_to_cube(q: i32, r: i32) -> CubeCoord {
    CubeCoord {
        q,
        r,
        s: -q - r,
    }
}

/// Calculate cube distance between two cube coordinates
/// Formula: max(|dq|, |dr|, |ds|)
/// This matches TypeScript HEX_UTILS.cubeDistance
fn cube_distance(a: CubeCoord, b: CubeCoord) -> i32 {
    (a.q - b.q).abs().max((a.r - b.r).abs()).max((a.s - b.s).abs())
}

/// Parse valid terrain JSON string into HashSet
/// Format: [{"q":0,"r":0},{"q":1,"r":0},...]
/// Returns empty HashSet if parsing fails
fn parse_valid_terrain_json(valid_terrain_json: &str) -> HashSet<(i32, i32)> {
    let mut valid_terrain = HashSet::new();
    
    let trimmed = valid_terrain_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return valid_terrain;
    }
    
    // Simple JSON parsing: find all {"q":X,"r":Y} patterns
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
                valid_terrain.insert((q, r));
            }
        }
        i += 1;
    }
    
    valid_terrain
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

    open_set.push(AStarNode::new(start_q, start_r, 0, h_start, start_q, start_r));
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
                open_set.push(AStarNode::new(nq, nr, tentative_g, h, current.q, current.r));
            }
        }
    }

    // No path found
    -1
}

/// Hex A* pathfinding that returns full path
/// Matches TypeScript hexAStar algorithm exactly:
/// - Uses cube coordinates for distance calculation (cube_distance)
/// - Maintains open set as BinaryHeap (min-heap by f score, then h score)
/// - Maintains closed set as HashSet
/// - Maintains g_scores as HashMap
/// - Stores parent pointers for path reconstruction
/// 
/// @param start_q - Start q coordinate (axial)
/// @param start_r - Start r coordinate (axial)
/// @param goal_q - Goal q coordinate (axial)
/// @param goal_r - Goal r coordinate (axial)
/// @param valid_terrain_json - JSON string with array of valid terrain coordinates: [{"q":0,"r":0},...]
/// @returns JSON string with path array [{"q":0,"r":0},...] or "null" if no path found
#[wasm_bindgen]
pub fn hex_astar(
    start_q: i32,
    start_r: i32,
    goal_q: i32,
    goal_r: i32,
    valid_terrain_json: String,
) -> String {
    // Parse valid terrain from JSON
    let valid_terrain = parse_valid_terrain_json(&valid_terrain_json);
    
    // Check if start and goal are in valid terrain
    if !valid_terrain.contains(&(start_q, start_r)) || !valid_terrain.contains(&(goal_q, goal_r)) {
        return "null".to_string();
    }
    
    // If start equals goal, return path with single node
    if start_q == goal_q && start_r == goal_r {
        return format!(r#"[{{"q":{},"r":{}}}]"#, start_q, start_r);
    }
    
    // Convert goal to cube for distance calculation (matches TypeScript)
    let goal_cube = axial_to_cube(goal_q, goal_r);
    
    // Calculate heuristic function (cube distance)
    let heuristic = |q: i32, r: i32| -> i32 {
        let cube = axial_to_cube(q, r);
        cube_distance(cube, goal_cube)
    };
    
    // Initialize A* data structures
    let h_start = heuristic(start_q, start_r);
    let mut open_set = BinaryHeap::new();
    let mut closed_set = HashSet::new();
    let mut g_scores: HashMap<(i32, i32), i32> = HashMap::new();
    let mut parents: HashMap<(i32, i32), (i32, i32)> = HashMap::new();
    
    // Start node (parent is itself to mark as root)
    open_set.push(AStarNode::new(start_q, start_r, 0, h_start, start_q, start_r));
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
            // Reconstruct path by following parent pointers
            let mut path: Vec<(i32, i32)> = Vec::new();
            let mut node_key = (goal_q, goal_r);
            
            // Follow parent pointers from goal to start
            loop {
                path.push(node_key);
                
                // Get parent for this node
                if let Some(parent_key) = parents.get(&node_key) {
                    // If parent is the start, add it and break
                    if parent_key.0 == start_q && parent_key.1 == start_r {
                        path.push((start_q, start_r));
                        break;
                    }
                    node_key = *parent_key;
                } else {
                    // No parent in map means we're at start (shouldn't happen in normal flow)
                    // But handle it just in case
                    if node_key.0 != start_q || node_key.1 != start_r {
                        path.push((start_q, start_r));
                    }
                    break;
                }
            }
            
            // Reverse path to get start-to-goal order
            path.reverse();
            
            // Build JSON string
            let mut json_parts = Vec::new();
            for (q, r) in path {
                json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
            }
            
            return format!("[{}]", json_parts.join(","));
        }
        
        // Explore neighbors
        let neighbors = get_hex_neighbors(current.q, current.r);
        for (nq, nr) in neighbors {
            let neighbor_key = (nq, nr);
            
            // Skip if not in valid terrain
            if !valid_terrain.contains(&neighbor_key) {
                continue;
            }
            
            // Skip if already closed
            if closed_set.contains(&neighbor_key) {
                continue;
            }
            
            // Calculate tentative g score (uniform cost of 1 per step)
            let tentative_g = current.g + 1;
            
            // Check if this is a better path
            let current_g = g_scores.get(&neighbor_key).copied().unwrap_or(i32::MAX);
            if tentative_g < current_g {
                // This path to neighbor is better - record it
                g_scores.insert(neighbor_key, tentative_g);
                parents.insert(neighbor_key, (current.q, current.r));
                let h = heuristic(nq, nr);
                open_set.push(AStarNode::new(nq, nr, tentative_g, h, current.q, current.r));
            }
        }
    }
    
    // No path found
    "null".to_string()
}

/// Build a path between two road points using A* pathfinding
/// Returns array of intermediate hexes (excluding start, including end)
/// Matches TypeScript buildPathBetweenRoads function
/// 
/// @param start_q - Start q coordinate (axial)
/// @param start_r - Start r coordinate (axial)
/// @param end_q - End q coordinate (axial)
/// @param end_r - End r coordinate (axial)
/// @param valid_terrain_json - JSON string with array of valid terrain coordinates: [{"q":0,"r":0},...]
/// @returns JSON string with path array excluding start, including end, or "null" if no path found
#[wasm_bindgen]
pub fn build_path_between_roads(
    start_q: i32,
    start_r: i32,
    end_q: i32,
    end_r: i32,
    valid_terrain_json: String,
) -> String {
    // Call hex_astar to get full path
    let full_path_json = hex_astar(start_q, start_r, end_q, end_r, valid_terrain_json);
    
    // If no path, return null
    if full_path_json == "null" || full_path_json.is_empty() {
        return "null".to_string();
    }
    
    // Parse the path JSON
    // Simple parsing: extract all {"q":X,"r":Y} patterns and skip first one
    let trimmed = full_path_json.trim();
    if trimmed == "[]" || trimmed.len() < 3 {
        return "null".to_string();
    }
    
    // Find all coordinate pairs
    let mut coords: Vec<(i32, i32)> = Vec::new();
    let mut i = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    while i < chars.len() {
        if chars[i] == '{' {
            let mut q_value: Option<i32> = None;
            let mut r_value: Option<i32> = None;
            
            i += 1;
            while i < chars.len() && chars[i] != '}' {
                if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'q' && chars[i + 2] == '"' {
                    i += 3;
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
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
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
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
                coords.push((q, r));
            }
        }
        i += 1;
    }
    
    // If path has less than 2 nodes, return null
    if coords.len() < 2 {
        return "null".to_string();
    }
    
    // Return path excluding start (first element), including end (last element)
    let path_without_start = &coords[1..];
    
    // Build JSON string
    let mut json_parts = Vec::new();
    for (q, r) in path_without_start {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
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
    
    // Create a vector of valid hex coordinates for seed generation
    // This ensures seeds are only placed on actual hex grid positions
    let hex_vec: Vec<(i32, i32)> = hex_grid.iter().map(|h| (h.q, h.r)).collect();
    let hex_count = hex_vec.len();
    
    if hex_count == 0 {
        return "[]".to_string();
    }
    
    // Generate seed points by sampling from actual hex grid coordinates
    // Use deterministic selection with prime multiplier for good distribution
    // This ensures seeds are ALWAYS generated reliably
    let mut seeds: Vec<VoronoiSeed> = Vec::new();
    let mut seed_counter: usize = 0;
    
    // Ensure we have valid hex_count before generating seeds
    // This should never be 0 at this point due to earlier checks, but be defensive
    if hex_count == 0 {
        return "[]".to_string();
    }
    
    // Generate forest seeds
    // Ensure we have at least 0 seeds (handle negative values)
    let forest_count = if forest_seeds > 0 { forest_seeds as usize } else { 0 };
    for i in 0..forest_count {
        seed_counter += 1;
        // Use deterministic selection: (counter * prime) % count for good distribution
        // Prime 7919 provides good pseudo-random distribution
        let index = ((seed_counter * 7919) + (i * 997)) % hex_count;
        // Bounds check (should always pass due to modulo, but be safe)
        if index < hex_vec.len() {
            let (q, r) = hex_vec[index];
            seeds.push(VoronoiSeed {
                q,
                r,
                tile_type: TileType::Forest,
            });
        }
    }
    
    // Generate water seeds
    let water_count = if water_seeds > 0 { water_seeds as usize } else { 0 };
    for i in 0..water_count {
        seed_counter += 1;
        let index = ((seed_counter * 7919) + (i * 997)) % hex_count;
        if index < hex_vec.len() {
            let (q, r) = hex_vec[index];
            seeds.push(VoronoiSeed {
                q,
                r,
                tile_type: TileType::Water,
            });
        }
    }
    
    // Generate grass seeds
    let grass_count = if grass_seeds > 0 { grass_seeds as usize } else { 0 };
    for i in 0..grass_count {
        seed_counter += 1;
        let index = ((seed_counter * 7919) + (i * 997)) % hex_count;
        if index < hex_vec.len() {
            let (q, r) = hex_vec[index];
            seeds.push(VoronoiSeed {
                q,
                r,
                tile_type: TileType::Grass,
            });
        }
    }
    
    // CRITICAL: If no seeds were generated, force generation of at least one grass seed
    // This should never happen with positive seed counts, but ensures function always works
    if seeds.is_empty() {
        // Force generate one seed at index 0 to ensure function doesn't return empty
        if hex_count > 0 && !hex_vec.is_empty() {
            let (q, r) = hex_vec[0];
            seeds.push(VoronoiSeed {
                q,
                r,
                tile_type: TileType::Grass,
            });
        } else {
            return "[]".to_string();
        }
    }
    
    // Assign each hex to nearest seed and build JSON
    // Ensure seeds is not empty (should be guaranteed by fallback above)
    if seeds.is_empty() {
        // This should never happen due to fallback, but be extra defensive
        return "[]".to_string();
    }
    
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
        
        // nearest_seed should always be Some since seeds is not empty
        if let Some(seed) = nearest_seed {
            json_parts.push(format!(
                r#"{{"q":{},"r":{},"tileType":{}}}"#,
                hex.q, hex.r, seed.tile_type as i32
            ));
        }
    }
    
    // If json_parts is empty (shouldn't happen), return at least one entry from first seed
    if json_parts.is_empty() && !seeds.is_empty() {
        let first_seed = &seeds[0];
        json_parts.push(format!(
            r#"{{"q":{},"r":{},"tileType":{}}}"#,
            first_seed.q, first_seed.r, first_seed.tile_type as i32
        ));
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

/// Find nearest point in connected set to a given point
/// Returns the nearest point and its distance
fn find_nearest_in_set(
    point: (i32, i32),
    connected_set: &HashSet<(i32, i32)>,
) -> Option<((i32, i32), i32)> {
    if connected_set.is_empty() {
        return None;
    }
    
    let mut nearest: Option<(i32, i32)> = None;
    let mut min_distance = i32::MAX;
    
    for &connected_point in connected_set {
        let dist = hex_distance(point.0, point.1, connected_point.0, connected_point.1);
        if dist < min_distance {
            min_distance = dist;
            nearest = Some(connected_point);
        }
    }
    
    nearest.map(|n| (n, min_distance))
}

/// Parse path JSON and return vector of coordinates
/// Format: [{"q":0,"r":0},{"q":1,"r":0},...]
fn parse_path_json(path_json: &str) -> Vec<(i32, i32)> {
    let mut path = Vec::new();
    
    if path_json == "null" || path_json.is_empty() {
        return path;
    }
    
    let trimmed = path_json.trim();
    if trimmed == "[]" || trimmed.len() < 3 {
        return path;
    }
    
    // Simple JSON parsing: find all {"q":X,"r":Y} patterns
    let mut i = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    while i < chars.len() {
        if chars[i] == '{' {
            let mut q_value: Option<i32> = None;
            let mut r_value: Option<i32> = None;
            
            i += 1;
            while i < chars.len() && chars[i] != '}' {
                if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'q' && chars[i + 2] == '"' {
                    i += 3;
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
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
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
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
                path.push((q, r));
            }
        }
        i += 1;
    }
    
    path
}

/// Generate road network using true growing tree algorithm
/// 
/// Algorithm:
/// 1. Start with first seed point
/// 2. For each remaining seed: find nearest connected road, build A* path, add path
/// 3. For expansion: repeatedly find nearest unconnected valid terrain to any connected road,
///    build A* path, add path. Continue until target count reached.
/// 
/// This creates a true tree structure where every road is connected via a path,
/// not just adjacent (which would be flood fill).
/// 
/// @param seeds_json - JSON array of seed points: [{"q":0,"r":0},...]
/// @param valid_terrain_json - JSON array of valid terrain: [{"q":0,"r":0},...]
/// @param occupied_json - JSON array of occupied hexes: [{"q":0,"r":0},...]
/// @param target_count - Target number of roads to generate
/// @returns JSON array of road coordinates: [{"q":0,"r":0},...]
#[wasm_bindgen]
pub fn generate_road_network_growing_tree(
    seeds_json: String,
    valid_terrain_json: String,
    occupied_json: String,
    target_count: i32,
) -> String {
    // Parse inputs
    let seeds = parse_valid_terrain_json(&seeds_json);
    let valid_terrain = parse_valid_terrain_json(&valid_terrain_json);
    let occupied = parse_valid_terrain_json(&occupied_json);
    
    // Build valid terrain set (valid terrain minus occupied)
    let mut valid_terrain_set = HashSet::new();
    for &hex in &valid_terrain {
        if !occupied.contains(&hex) {
            valid_terrain_set.insert(hex);
        }
    }
    
    // Convert valid terrain to JSON for hex_astar calls
    let mut valid_terrain_vec: Vec<(i32, i32)> = valid_terrain_set.iter().cloned().collect();
    valid_terrain_vec.sort();
    let mut valid_terrain_json_parts = Vec::new();
    for (q, r) in &valid_terrain_vec {
        valid_terrain_json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    let valid_terrain_json_for_astar = format!("[{}]", valid_terrain_json_parts.join(","));
    
    // Connected set: roads in the network
    let mut connected: HashSet<(i32, i32)> = HashSet::new();
    
    // Unconnected set: valid terrain not yet roads
    let mut unconnected: HashSet<(i32, i32)> = valid_terrain_set.clone();
    
    // Phase 1: Connect seed points
    if !seeds.is_empty() {
        let first_seed = seeds.iter().next().copied();
        if let Some(seed) = first_seed {
            if valid_terrain_set.contains(&seed) {
                connected.insert(seed);
                unconnected.remove(&seed);
            }
        }
        
        // Connect remaining seeds
        for seed in seeds.iter().skip(1) {
            if !valid_terrain_set.contains(seed) {
                continue;
            }
            
            if connected.is_empty() {
                // No connected roads yet, add seed directly
                connected.insert(*seed);
                unconnected.remove(seed);
                continue;
            }
            
            // Find nearest connected road
            if let Some((nearest_road, _)) = find_nearest_in_set(*seed, &connected) {
                // Build path from nearest road to seed
                let path_json = hex_astar(
                    nearest_road.0,
                    nearest_road.1,
                    seed.0,
                    seed.1,
                    valid_terrain_json_for_astar.clone(),
                );
                
                if path_json != "null" && !path_json.is_empty() {
                    let path = parse_path_json(&path_json);
                    // Add all path hexes to connected
                    for path_hex in path {
                        connected.insert(path_hex);
                        unconnected.remove(&path_hex);
                    }
                }
            }
        }
    }
    
    // Phase 2: Expand to target density using growing tree
    while (connected.len() as i32) < target_count && !unconnected.is_empty() {
        let mut best_unconnected: Option<(i32, i32)> = None;
        let mut best_connected: Option<(i32, i32)> = None;
        let mut min_distance = i32::MAX;
        
        // Find nearest unconnected point to any connected road
        for &unconnected_point in &unconnected {
            if let Some((nearest_road, distance)) = find_nearest_in_set(unconnected_point, &connected) {
                if distance < min_distance {
                    min_distance = distance;
                    best_unconnected = Some(unconnected_point);
                    best_connected = Some(nearest_road);
                }
            }
        }
        
        // Build path and add to network
        if let (Some(unconnected_point), Some(connected_road)) = (best_unconnected, best_connected) {
            let path_json = hex_astar(
                connected_road.0,
                connected_road.1,
                unconnected_point.0,
                unconnected_point.1,
                valid_terrain_json_for_astar.clone(),
            );
            
            if path_json != "null" && !path_json.is_empty() {
                let path = parse_path_json(&path_json);
                // Add all path hexes to connected
                for path_hex in path {
                    connected.insert(path_hex);
                    unconnected.remove(&path_hex);
                }
            } else {
                // Can't reach this point, remove it from unconnected
                unconnected.remove(&unconnected_point);
            }
        } else {
            // No more reachable points
            break;
        }
    }
    
    // Convert connected set to JSON array
    let mut road_vec: Vec<(i32, i32)> = connected.iter().cloned().collect();
    road_vec.sort();
    let mut json_parts = Vec::new();
    for (q, r) in road_vec {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}


