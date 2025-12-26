use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Convert HSL to RGB
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;
    
    let (r, g, b) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    
    (
        ((r + m) * 255.0).clamp(0.0, 255.0) as u8,
        ((g + m) * 255.0).clamp(0.0, 255.0) as u8,
        ((b + m) * 255.0).clamp(0.0, 255.0) as u8,
    )
}

/// Get color from iteration count with smooth coloring and color scheme
fn get_color_smooth(iterations: f64, max_iterations: f64, color_scheme: u32) -> (u8, u8, u8) {
    if iterations >= max_iterations {
        return (0, 0, 0);
    }
    
    // Smooth coloring: n + 1 - log(log(|z|)) / log(2)
    // Simplified: use normalized iteration count
    let normalized = iterations / max_iterations;
    
    match color_scheme % 6 {
        0 => {
            // Rainbow
            let hue = normalized * 360.0;
            hsl_to_rgb(hue, 1.0, 0.5)
        }
        1 => {
            // Fire (red to yellow)
            let hue = 30.0 - normalized * 30.0;
            hsl_to_rgb(hue, 1.0, 0.5)
        }
        2 => {
            // Ocean (blue to cyan)
            let hue = 180.0 + normalized * 60.0;
            hsl_to_rgb(hue, 1.0, 0.5)
        }
        3 => {
            // Sunset (red to purple)
            let hue = 300.0 + normalized * 60.0;
            hsl_to_rgb(hue, 1.0, 0.5)
        }
        4 => {
            // Forest (green variations)
            let hue = 120.0 + normalized * 30.0;
            hsl_to_rgb(hue, 0.8, 0.4)
        }
        _ => {
            // Electric (blue to purple, high saturation)
            let hue = 240.0 + normalized * 60.0;
            hsl_to_rgb(hue, 1.0, 0.6)
        }
    }
}

/// Generate Mandelbrot Set fractal
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_mandelbrot(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    
    // Randomize parameters for unique images - improved ranges for better results
    let max_iterations = 100 + (js_sys::Math::random() * 200.0) as u32;
    let zoom = 0.5 + js_sys::Math::random() * 2.5;
    let center_x = -0.5 + js_sys::Math::random() * 1.0;
    let center_y = -0.5 + js_sys::Math::random() * 1.0;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    for y in 0..height {
        for x in 0..width {
            let cx = (x as f64 / width as f64 - 0.5) * 4.0 / zoom + center_x;
            let cy = (y as f64 / height as f64 - 0.5) * 4.0 / zoom + center_y;
            
            let mut zx = 0.0;
            let mut zy = 0.0;
            let mut iterations = 0;
            
            while zx * zx + zy * zy < 4.0 && iterations < max_iterations {
                let tmp = zx * zx - zy * zy + cx;
                zy = 2.0 * zx * zy + cy;
                zx = tmp;
                iterations += 1;
            }
            
            let idx = ((y * width + x) * 4) as usize;
            if iterations >= max_iterations {
                image_data[idx] = 0;
                image_data[idx + 1] = 0;
                image_data[idx + 2] = 0;
                image_data[idx + 3] = 255;
            } else {
                // Smooth coloring with escape time
                let z_mag = (zx * zx + zy * zy).sqrt();
                let smooth_iter = iterations as f64 + 1.0 - (z_mag.ln().ln() / 2.0_f64.ln());
                let normalized = smooth_iter / max_iterations as f64;
                
                let (r, g, b) = get_color_smooth(normalized * max_iterations as f64, max_iterations as f64, color_scheme);
                image_data[idx] = r;
                image_data[idx + 1] = g;
                image_data[idx + 2] = b;
                image_data[idx + 3] = 255;
            }
        }
    }
    
    image_data
}

/// Generate Julia Set fractal
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_julia(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    
    // Randomize parameters for unique images - improved ranges for interesting Julia sets
    let max_iterations = 100 + (js_sys::Math::random() * 200.0) as u32;
    let c_real = -0.8 + js_sys::Math::random() * 1.0;
    let c_imag = -0.8 + js_sys::Math::random() * 1.6;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    for y in 0..height {
        for x in 0..width {
            let zx = (x as f64 / width as f64 - 0.5) * 4.0;
            let zy = (y as f64 / height as f64 - 0.5) * 4.0;
            
            let mut zx_current = zx;
            let mut zy_current = zy;
            let mut iterations = 0;
            
            while zx_current * zx_current + zy_current * zy_current < 4.0 && iterations < max_iterations {
                let tmp = zx_current * zx_current - zy_current * zy_current + c_real;
                zy_current = 2.0 * zx_current * zy_current + c_imag;
                zx_current = tmp;
                iterations += 1;
            }
            
            let idx = ((y * width + x) * 4) as usize;
            if iterations >= max_iterations {
                image_data[idx] = 0;
                image_data[idx + 1] = 0;
                image_data[idx + 2] = 0;
                image_data[idx + 3] = 255;
            } else {
                // Calculate smooth coloring using escaped magnitude
                let z_mag_sq = zx_current * zx_current + zy_current * zy_current;
                let smooth_iter = if z_mag_sq > 4.0 {
                    let z_mag = z_mag_sq.sqrt();
                    if z_mag > 1.0 {
                        iterations as f64 + 1.0 - (z_mag.ln().ln() / 2.0_f64.ln())
                    } else {
                        iterations as f64
                    }
                } else {
                    iterations as f64
                };
                
                let normalized = (smooth_iter / max_iterations as f64).clamp(0.0, 1.0);
                let (r, g, b) = get_color_smooth(normalized * max_iterations as f64, max_iterations as f64, color_scheme);
                image_data[idx] = r;
                image_data[idx + 1] = g;
                image_data[idx + 2] = b;
                image_data[idx + 3] = 255;
            }
        }
    }
    
    image_data
}

/// Generate Buddhabrot/Nebulabrot fractal
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_buddhabrot(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    let mut orbit_count = vec![0u32; (width * height) as usize];
    
    let max_iterations = 200 + (js_sys::Math::random() * 300.0) as u32;
    let samples = 200000 + (js_sys::Math::random() * 300000.0) as u32;
    
    // Sample random points and track orbits
    for _ in 0..samples {
        let cx = (js_sys::Math::random() - 0.5) * 4.0;
        let cy = (js_sys::Math::random() - 0.5) * 4.0;
        
        let mut zx = 0.0;
        let mut zy = 0.0;
        let mut iterations = 0;
        let mut orbit_points = Vec::new();
        
        while zx * zx + zy * zy < 4.0 && iterations < max_iterations {
            orbit_points.push((zx, zy));
            let tmp = zx * zx - zy * zy + cx;
            zy = 2.0 * zx * zy + cy;
            zx = tmp;
            iterations += 1;
        }
        
        // If point escaped, record orbit
        if iterations < max_iterations {
            for (ox, oy) in orbit_points {
                let px = ((ox + 2.0) / 4.0 * width as f64) as u32;
                let py = ((oy + 2.0) / 4.0 * height as f64) as u32;
                if px < width && py < height {
                    let idx = (py * width + px) as usize;
                    orbit_count[idx] = orbit_count[idx].saturating_add(1);
                }
            }
        }
    }
    
    // Find max count for normalization
    let max_count = orbit_count.iter().max().copied().unwrap_or(1) as f64;
    
    // Randomize color scheme
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    // Convert to image
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let count_idx = (y * width + x) as usize;
            let normalized = orbit_count[count_idx] as f64 / max_count;
            
            let (r, g, b) = get_color_smooth(normalized * 200.0, 200.0, color_scheme);
            image_data[idx] = r;
            image_data[idx + 1] = g;
            image_data[idx + 2] = b;
            image_data[idx + 3] = 255;
        }
    }
    
    image_data
}

/// Generate Orbit-Trap fractal
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_orbit_trap(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    
    // Randomize parameters - improved ranges for better visual results
    let max_iterations = 50 + (js_sys::Math::random() * 100.0) as u32;
    let trap_x = -0.5 + js_sys::Math::random() * 1.0;
    let trap_y = -0.5 + js_sys::Math::random() * 1.0;
    let trap_radius = 0.2 + js_sys::Math::random() * 0.8;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    for y in 0..height {
        for x in 0..width {
            let cx = (x as f64 / width as f64 - 0.5) * 4.0;
            let cy = (y as f64 / height as f64 - 0.5) * 4.0;
            
            let mut zx = 0.0;
            let mut zy = 0.0;
            let mut min_dist = f64::INFINITY;
            
            for _ in 0..max_iterations {
                if zx * zx + zy * zy > 4.0 {
                    break;
                }
                
                // Distance to trap (circle at random position)
                let dx = zx - trap_x;
                let dy = zy - trap_y;
                let sum_sq: f64 = dx * dx + dy * dy;
                let dist = sum_sq.sqrt() - trap_radius;
                if dist < min_dist {
                    min_dist = dist;
                }
                
                let tmp = zx * zx - zy * zy + cx;
                zy = 2.0 * zx * zy + cy;
                zx = tmp;
            }
            
            let idx = ((y * width + x) * 4) as usize;
            let normalized = 1.0 / (1.0 + min_dist * 5.0);
            let (r, g, b) = get_color_smooth(normalized * 200.0, 200.0, color_scheme);
            image_data[idx] = r;
            image_data[idx + 1] = g;
            image_data[idx + 2] = b;
            image_data[idx + 3] = 255;
        }
    }
    
    image_data
}

/// Generate Gray-Scott Reaction-Diffusion pattern
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_gray_scott(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    
    // Randomize reaction-diffusion parameters - improved ranges for interesting patterns
    let du = 0.1 + js_sys::Math::random() * 0.2;
    let dv = 0.05 + js_sys::Math::random() * 0.1;
    let f = 0.01 + js_sys::Math::random() * 0.09;
    let k = 0.04 + js_sys::Math::random() * 0.03;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    let mut u = vec![1.0; (width * height) as usize];
    let mut v = vec![0.0; (width * height) as usize];
    
    // Initialize with small perturbations
    for i in 0..(width * height) as usize {
        if js_sys::Math::random() < 0.1 {
            u[i] = 0.5;
            v[i] = 0.25;
        }
    }
    
    // Simulate reaction-diffusion
    let steps = 100;
    for _ in 0..steps {
        let mut u_new = u.clone();
        let mut v_new = v.clone();
        
        for y in 1..(height - 1) {
            for x in 1..(width - 1) {
                let idx = (y * width + x) as usize;
                let idx_up = ((y - 1) * width + x) as usize;
                let idx_down = ((y + 1) * width + x) as usize;
                let idx_left = (y * width + (x - 1)) as usize;
                let idx_right = (y * width + (x + 1)) as usize;
                
                let laplacian_u = u[idx_up] + u[idx_down] + u[idx_left] + u[idx_right] - 4.0 * u[idx];
                let laplacian_v = v[idx_up] + v[idx_down] + v[idx_left] + v[idx_right] - 4.0 * v[idx];
                
                let reaction = u[idx] * v[idx] * v[idx];
                u_new[idx] = u[idx] + du * laplacian_u - reaction + f * (1.0 - u[idx]);
                v_new[idx] = v[idx] + dv * laplacian_v + reaction - (f + k) * v[idx];
            }
        }
        
        u = u_new;
        v = v_new;
    }
    
    // Convert to image
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let data_idx = (y * width + x) as usize;
            let normalized = v[data_idx];
            
            let (r, g, b) = get_color_smooth(normalized * 200.0, 200.0, color_scheme);
            image_data[idx] = r;
            image_data[idx + 1] = g;
            image_data[idx + 2] = b;
            image_data[idx + 3] = 255;
        }
    }
    
    image_data
}

/// Generate L-System fractal (tree)
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_lsystem(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    
    // Randomize L-System parameters - improved ranges for better trees
    let angle = std::f64::consts::PI / 12.0 + js_sys::Math::random() * std::f64::consts::PI / 6.0;
    let length = 30.0 + js_sys::Math::random() * 40.0;
    let iterations = 3 + (js_sys::Math::random() * 5.0) as u32;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    let mut stack: Vec<(f64, f64, f64)> = Vec::new();
    let mut x = (width / 2) as f64;
    let mut y = (height - 10) as f64;
    let mut current_angle = -std::f64::consts::PI / 2.0;
    
    // Simple L-System: F -> F[+F]F[-F]F
    fn generate_lsystem_string(iterations: u32) -> String {
        let mut result = String::from("F");
        for _ in 0..iterations {
            result = result.replace("F", "F[+F]F[-F]F");
        }
        result
    }
    
    let lsystem_string = generate_lsystem_string(iterations);
    let scale = length / (2.0_f64.powi(iterations as i32));
    
    for ch in lsystem_string.chars() {
        match ch {
            'F' => {
                let new_x = x + current_angle.cos() * scale;
                let new_y = y + current_angle.sin() * scale;
                
                // Draw line
                draw_line(&mut image_data, width, height, x, y, new_x, new_y, color_scheme);
                
                x = new_x;
                y = new_y;
            }
            '+' => {
                current_angle += angle;
            }
            '-' => {
                current_angle -= angle;
            }
            '[' => {
                stack.push((x, y, current_angle));
            }
            ']' => {
                if let Some((sx, sy, sa)) = stack.pop() {
                    x = sx;
                    y = sy;
                    current_angle = sa;
                }
            }
            _ => {}
        }
    }
    
    image_data
}

fn draw_line(image_data: &mut [u8], width: u32, height: u32, x1: f64, y1: f64, x2: f64, y2: f64, color_scheme: u32) {
    let steps = ((x2 - x1).abs().max((y2 - y1).abs()) as u32).max(1);
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let x = x1 + (x2 - x1) * t;
        let y = y1 + (y2 - y1) * t;
        
        let px = x as u32;
        let py = y as u32;
        
        if px < width && py < height {
            let idx = ((py * width + px) * 4) as usize;
            // Use green-tinted colors from scheme
            let normalized = t * 200.0;
            let (r, g, b) = get_color_smooth(normalized, 200.0, color_scheme);
            image_data[idx] = (r as f32 * 0.3) as u8;
            image_data[idx + 1] = g;
            image_data[idx + 2] = (b as f32 * 0.5) as u8;
            image_data[idx + 3] = 255;
        }
    }
}

/// Generate Fractal Flames
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_fractal_flame(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    let mut intensity = vec![0.0f64; (width * height) as usize];
    
    let iterations = 200000;
    
    // Randomize IFS parameters - improved ranges for better flames
    let p1 = 0.3 + js_sys::Math::random() * 0.2;
    let p2 = 0.6 + js_sys::Math::random() * 0.2;
    let a1 = 0.4 + js_sys::Math::random() * 0.3;
    let a2 = 0.4 + js_sys::Math::random() * 0.3;
    let tx1 = 0.1 + js_sys::Math::random() * 0.4;
    let ty1 = 0.1 + js_sys::Math::random() * 0.4;
    let tx2 = 0.3 + js_sys::Math::random() * 0.3;
    let ty2 = 0.3 + js_sys::Math::random() * 0.3;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    let mut x = 0.3 + js_sys::Math::random() * 0.4;
    let mut y = 0.3 + js_sys::Math::random() * 0.4;
    
    for _ in 0..iterations {
        // IFS transformation with random parameters
        let r = js_sys::Math::random();
        let (new_x, new_y) = if r < p1 {
            (a1 * x, a1 * y)
        } else if r < p2 {
            (a2 * x + tx1, a2 * y + ty1)
        } else {
            (a2 * x + tx2, a2 * y + ty2)
        };
        
        x = new_x;
        y = new_y;
        
        // Map to image coordinates
        let px = (x * width as f64) as u32;
        let py = (y * height as f64) as u32;
        
        if px < width && py < height {
            let idx = (py * width + px) as usize;
            intensity[idx] += 1.0;
        }
    }
    
    // Normalize and convert to image
    let max_intensity = intensity.iter().copied().fold(0.0, f64::max);
    if max_intensity > 0.0 {
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                let int_idx = (y * width + x) as usize;
                let normalized = intensity[int_idx] / max_intensity;
                
                let (r, g, b) = get_color_smooth(normalized * 200.0, 200.0, color_scheme);
                image_data[idx] = r;
                image_data[idx + 1] = g;
                image_data[idx + 2] = b;
                image_data[idx + 3] = 255;
            }
        }
    }
    
    image_data
}

/// Generate Strange Attractor (Lorenz, Clifford, or De Jong)
/// Returns RGBA image data (width * height * 4 bytes)
#[wasm_bindgen]
pub fn generate_strange_attractor(width: u32, height: u32) -> Vec<u8> {
    let mut image_data = vec![0u8; (width * height * 4) as usize];
    let mut intensity = vec![0.0f64; (width * height) as usize];
    
    // Use known good parameter sets for each attractor type
    let attractor_type = (js_sys::Math::random() * 3.0) as u32;
    let color_scheme = (js_sys::Math::random() * 6.0) as u32;
    
    // Known good parameter sets with small variations
    let (mut x, mut y, mut z, dt, sigma, rho, beta, clifford_a, clifford_b, clifford_c, clifford_d, dejong_a, dejong_b, dejong_c, dejong_d) = match attractor_type {
        0 => {
            // Lorenz - classic parameters with small variations
            let sigma = 10.0;
            let rho = 28.0;
            let beta = 8.0 / 3.0;
            let dt = 0.01;
            // Start near origin (Lorenz attractor basin)
            let x = 0.1 + (js_sys::Math::random() - 0.5) * 0.2;
            let y = 0.1 + (js_sys::Math::random() - 0.5) * 0.2;
            let z = 0.1 + (js_sys::Math::random() - 0.5) * 0.2;
            (x, y, z, dt, sigma, rho, beta, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        }
        1 => {
            // Clifford - known interesting parameter sets
            let a = -1.4 + (js_sys::Math::random() - 0.5) * 0.2;
            let b = 1.6 + (js_sys::Math::random() - 0.5) * 0.2;
            let c = 1.0 + (js_sys::Math::random() - 0.5) * 0.4;
            let d = 0.7 + (js_sys::Math::random() - 0.5) * 0.2;
            let dt = 1.0;
            // Start near origin
            let x = (js_sys::Math::random() - 0.5) * 0.5;
            let y = (js_sys::Math::random() - 0.5) * 0.5;
            (x, y, 0.0, dt, 0.0, 0.0, 0.0, a, b, c, d, 0.0, 0.0, 0.0, 0.0)
        }
        _ => {
            // De Jong - known interesting parameter sets
            let a = -2.0 + (js_sys::Math::random() - 0.5) * 0.5;
            let b = -2.0 + (js_sys::Math::random() - 0.5) * 0.5;
            let c = -1.2 + (js_sys::Math::random() - 0.5) * 0.2;
            let d = -2.0 + (js_sys::Math::random() - 0.5) * 0.5;
            let dt = 1.0;
            // Start near origin
            let x = (js_sys::Math::random() - 0.5) * 0.5;
            let y = (js_sys::Math::random() - 0.5) * 0.5;
            (x, y, 0.0, dt, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, a, b, c, d)
        }
    };
    
    let iterations = 200000;
    let burn_in = 1000;
    
    // Burn-in period to reach attractor
    for _ in 0..burn_in {
        let (dx, dy, dz) = match attractor_type {
            0 => {
                (sigma * (y - x), x * (rho - z) - y, x * y - beta * z)
            }
            1 => {
                (
                    (clifford_a * x + clifford_b * y).sin(),
                    (clifford_c * x + clifford_d * y).sin(),
                    0.0
                )
            }
            _ => {
                (
                    (dejong_a * y).sin() - (dejong_b * x).cos(),
                    (dejong_c * x).sin() - (dejong_d * y).cos(),
                    0.0
                )
            }
        };
        
        x += dx * dt;
        y += dy * dt;
        z += dz * dt;
    }
    
    // First pass: find range for dynamic scaling
    let mut min_x = x;
    let mut max_x = x;
    let mut min_y = y;
    let mut max_y = y;
    let mut temp_x = x;
    let mut temp_y = y;
    let mut temp_z = z;
    
    let range_iterations = 10000;
    for _ in 0..range_iterations {
        let (dx, dy, dz) = match attractor_type {
            0 => {
                (sigma * (temp_y - temp_x), temp_x * (rho - temp_z) - temp_y, temp_x * temp_y - beta * temp_z)
            }
            1 => {
                (
                    (clifford_a * temp_x + clifford_b * temp_y).sin(),
                    (clifford_c * temp_x + clifford_d * temp_y).sin(),
                    0.0
                )
            }
            _ => {
                (
                    (dejong_a * temp_y).sin() - (dejong_b * temp_x).cos(),
                    (dejong_c * temp_x).sin() - (dejong_d * temp_y).cos(),
                    0.0
                )
            }
        };
        
        temp_x += dx * dt;
        temp_y += dy * dt;
        temp_z += dz * dt;
        
        if temp_x < min_x { min_x = temp_x; }
        if temp_x > max_x { max_x = temp_x; }
        if temp_y < min_y { min_y = temp_y; }
        if temp_y > max_y { max_y = temp_y; }
    }
    
    // Calculate scaling from range
    let range_x = (max_x - min_x).max(0.1);
    let range_y = (max_y - min_y).max(0.1);
    let center_x = (min_x + max_x) / 2.0;
    let center_y = (min_y + max_y) / 2.0;
    let scale = range_x.max(range_y) * 1.2;
    
    // Second pass: render with proper scaling
    for _ in 0..iterations {
        let (dx, dy, dz) = match attractor_type {
            0 => {
                (sigma * (y - x), x * (rho - z) - y, x * y - beta * z)
            }
            1 => {
                (
                    (clifford_a * x + clifford_b * y).sin(),
                    (clifford_c * x + clifford_d * y).sin(),
                    0.0
                )
            }
            _ => {
                (
                    (dejong_a * y).sin() - (dejong_b * x).cos(),
                    (dejong_c * x).sin() - (dejong_d * y).cos(),
                    0.0
                )
            }
        };
        
        x += dx * dt;
        y += dy * dt;
        z += dz * dt;
        
        // Project to 2D with dynamic scaling
        let px = (((x - center_x) / scale + 0.5) * width as f64) as u32;
        let py = (((y - center_y) / scale + 0.5) * height as f64) as u32;
        
        if px < width && py < height {
            let idx = (py * width + px) as usize;
            intensity[idx] += 1.0;
        }
    }
    
    // Normalize and convert to image
    let max_intensity = intensity.iter().copied().fold(0.0, f64::max);
    if max_intensity > 0.0 {
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                let int_idx = (y * width + x) as usize;
                let normalized = intensity[int_idx] / max_intensity;
                
                let (r, g, b) = get_color_smooth(normalized * 200.0, 200.0, color_scheme);
                image_data[idx] = r;
                image_data[idx + 1] = g;
                image_data[idx + 2] = b;
                image_data[idx + 3] = 255;
            }
        }
    }
    
    image_data
}

