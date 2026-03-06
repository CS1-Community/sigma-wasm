use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

#[derive(Serialize, Deserialize)]
pub struct Palette {
    pub colors: Vec<Color>,
}

#[derive(Serialize, Deserialize)]
pub struct MandelbulbConfig {
    pub power: f32,
    pub max_iters: u32,
    pub bail_out: f32,
    pub palette_id: u32,
    pub ambient_color: Color,
    pub light_pos: [f32; 3],
}

const PALETTE0: [Color; 5] = [
    Color { r: 0.0, g: 1.0, b: 1.0 },   // Cyan
    Color { r: 1.0, g: 0.0, b: 1.0 },   // Magenta
    Color { r: 0.5, g: 0.0, b: 1.0 },   // Purple
    Color { r: 0.0, g: 0.5, b: 1.0 },   // Blue
    Color { r: 1.0, g: 1.0, b: 0.0 },   // Yellow
];

const PALETTE1: [Color; 5] = [
    Color { r: 1.0, g: 0.0, b: 0.5 },   // Hot Pink
    Color { r: 0.0, g: 1.0, b: 0.5 },   // Electric Green
    Color { r: 0.5, g: 0.0, b: 1.0 },   // Deep Purple
    Color { r: 0.0, g: 0.5, b: 1.0 },   // Tech Blue
    Color { r: 1.0, g: 0.5, b: 0.0 },   // Neon Orange
];

#[wasm_bindgen]
pub fn get_palette(id: u32) -> JsValue {
    let colors = if id == 0 {
        PALETTE0.to_vec()
    } else {
        PALETTE1.to_vec()
    };
    
    let palette = Palette { colors };
    serde_wasm_bindgen::to_value(&palette).unwrap()
}

#[wasm_bindgen]
pub fn get_default_config() -> JsValue {
    let config = MandelbulbConfig {
        power: 8.0,
        max_iters: 64,
        bail_out: 2.0,
        palette_id: 0,
        ambient_color: Color { r: 0.05, g: 0.05, b: 0.1 },
        light_pos: [5.0, 5.0, 5.0],
    };
    serde_wasm_bindgen::to_value(&config).unwrap()
}

/// Helper to get a flat f32 array of the palette for uniform buffers
#[wasm_bindgen]
pub fn get_flat_palette(id: u32) -> Vec<f32> {
    let palette = if id == 0 { PALETTE0 } else { PALETTE1 };
    let mut flat = Vec::with_capacity(palette.len() * 4); // Use float4 alignment for WGSL
    for color in palette.iter() {
        flat.push(color.r);
        flat.push(color.g);
        flat.push(color.b);
        flat.push(1.0); // Alpha/Padding
    }
    flat
}
