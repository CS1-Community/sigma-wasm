# Learning From Mistakes: A Comprehensive Guide to Client-Side AI Development

This document captures critical lessons learned from building a production web application with client-side LLMs, WASM modules, and complex deployment pipelines. Every mistake documented here was a real production issue that caused failures, and every solution was hard-won through debugging and research.

## Table of Contents

1. [Overview](#overview)
2. [Critical Production Deployment Mistakes](#critical-production-deployment-mistakes)
   - [The render.yaml Build Filter Disaster](#the-renderyaml-build-filter-disaster)
   - [Error Handling Anti-Patterns](#error-handling-anti-patterns)
   - [Error Logging Best Practices](#error-logging-best-practices)
3. [LLM Integration Learnings](#llm-integration-learnings)
   - [SmolVLM: Vision-Language Models](#smolvlm-vision-language-models)
   - [ViT-GPT2: Image Captioning with Transformers.js](#vit-gpt2-image-captioning-with-transformersjs)
   - [Function Calling Agent: DistilGPT-2 with WASM Tools](#function-calling-agent-distilgpt-2-with-wasm-tools)
4. [The Download Journey](#the-download-journey)
5. [The Inference Pipeline](#the-inference-pipeline)
6. [Tensor Shapes and Type Safety](#tensor-shapes-and-type-safety)
7. [Known Challenges and Solutions](#known-challenges-and-solutions)
8. [Production Deployment Checklist](#production-deployment-checklist)
9. [Future Improvements](#future-improvements)

---

## Overview

This application integrates multiple LLM approaches for different use cases, but more importantly, it documents the mistakes we made and how we fixed them. Each section below includes:

- **What We Learned**: The key takeaway
- **The Mistake**: What went wrong
- **The Impact**: How it affected production
- **The Solution**: How we fixed it

### LLM Approaches

1. **SmolVLM (ONNX Runtime Web)**: Vision-Language Models for image understanding
   - SmolVLM-500M: 500 million parameters, uses 224×224 images
   - SmolVLM-256M: 256 million parameters, uses 512×512 images
   - Endpoints: `/preprocess-smolvlm-500m`, `/preprocess-smolvlm-256m`

2. **ViT-GPT2 (Transformers.js)**: Image Captioning Model
   - Model: `Xenova/vit-gpt2-image-captioning`
   - Endpoint: `/image-captioning`

3. **Function Calling Agent (Transformers.js + WASM)**: Autonomous Agent
   - Model: `Xenova/distilgpt2` (DistilGPT-2)
   - Tools: WASM-based tools (`calculate`, `process_text`, `get_stats`)
   - Endpoint: `/function-calling`

4. **Fractal Chat (Transformers.js + WASM)**: Interactive Chat with Generative Art
   - Model: `Xenova/qwen1.5-0.5b-chat` (Qwen Chat Model)
   - WASM: Fractal generation algorithms
   - Endpoint: `/fractal-chat`

5. **Babylon WFC (Transformers.js + WASM + BabylonJS)**: Text-to-Layout Generation
   - Model: `Xenova/qwen1.5-0.5b-chat` (Qwen Chat Model)
   - WASM: Wave Function Collapse algorithm
   - 3D Rendering: BabylonJS with mesh instancing
   - Endpoint: `/babylon-wfc`

---

## Critical Production Deployment Mistakes

### The render.yaml Build Filter Disaster

**What We Learned**: Always verify build configuration files include ALL required source directories. Missing directories in build filters cause silent failures in production.

**The Mistake**: The `render.yaml` file's `buildFilter.paths` section was missing three WASM module directories:
- `wasm-preprocess-256m/**`
- `wasm-preprocess-image-captioning/**`
- `wasm-agent-tools/**`

**The Impact**: 
- All WASM modules failed to load in production with generic "Failed to load WASM module" errors
- The Docker build succeeded, but the WASM source code wasn't included in the build context
- No error during build - the missing directories were silently excluded
- Users saw broken functionality on all endpoints using these modules

**The Root Cause**: 
- When adding new WASM modules, we updated the `Dockerfile` and `Cargo.toml` but forgot to update `render.yaml`
- Render.com's build filter excludes everything not explicitly listed in `paths`
- The build appeared successful because Docker didn't fail - it just didn't have the source files

**The Solution**:
```yaml
buildFilter:
  paths:
    - src/**
    - wasm-astar/**
    - wasm-preprocess/**
    - wasm-preprocess-256m/**              # ADDED
    - wasm-preprocess-image-captioning/**  # ADDED
    - wasm-agent-tools/**                  # ADDED
    - Cargo.toml
    # ... rest of paths
```

**Key Lesson**: When adding new modules or directories:
1. Update `Dockerfile` (source copying)
2. Update `Cargo.toml` (workspace members)
3. Update `render.yaml` (build filter paths) ← **EASY TO FORGET**
4. Update `scripts/build.sh` (build script)
5. Update `vite.config.ts` (if needed for routing)

**Prevention**: Create a checklist for adding new WASM modules (see [Production Deployment Checklist](#production-deployment-checklist))

---

### Error Handling Anti-Patterns

**What We Learned**: Generic error messages that don't preserve original error details make production debugging impossible. Always include the original error message when wrapping errors.

**The Mistake**: The `loadWasmModule` function wrapped errors in a generic message:

```typescript
// BAD: Loses original error message
catch (error) {
  throw new WasmLoadError('Failed to load WASM module', error);
}
```

**The Impact**:
- Production errors showed only "Failed to load WASM module: Failed to load WASM module"
- No way to know if it was a network error, file not found, or initialization failure
- Debugging required guessing what the actual error might be
- Users saw unhelpful error messages

**The Root Cause**:
- Error wrapping pattern didn't extract the original error message
- The `cause` property existed but wasn't displayed to users
- Error messages were too generic to be actionable

**The Solution**:
```typescript
// GOOD: Preserves original error message
catch (error) {
  if (error instanceof WasmInitError) {
    throw error;
  }
  const errorMessage = error instanceof Error 
    ? error.message 
    : String(error);
  throw new WasmLoadError(`Failed to load WASM module: ${errorMessage}`, error);
}
```

**Key Lesson**: 
- Always extract and include the original error message in wrapped errors
- Use template strings to combine context with original message
- Preserve the original error as the `cause` for stack traces

**Prevention**: 
- Use a lint rule to catch error wrapping without message extraction
- Always test error messages in production-like environments
- Include error message extraction in code review checklist

---

### Error Logging Best Practices

**What We Learned**: Comprehensive error logging with stack traces, import paths, and error causes is essential for production debugging. Generic logs are useless.

---

### WASM Function Retrieval Pattern

**What We Learned**: All WASM functions must be retrieved from `wasmModuleRecord` (the module object) first, not from `exports` (the init result). This ensures the `wasm-bindgen` generated JavaScript wrappers are used, which handle proper type conversion (e.g., `(ptr, len)` tuples to strings).

**The Mistake**: Mixed retrieval pattern - some functions from `exports`, some from `wasmModuleRecord`:
```typescript
// WRONG: Inconsistent retrieval pattern
const generateLayoutValue = getProperty(exports, 'generate_layout') || 
  (wasmModuleRecord ? getProperty(wasmModuleRecord, 'generate_layout') : undefined);
const getWasmVersionValue = wasmModuleRecord ? 
  getProperty(wasmModuleRecord, 'get_wasm_version') : 
  getProperty(exports, 'get_wasm_version');
```

**The Impact**:
- Functions returned raw WASM values (e.g., `(ptr, len)` tuples) instead of JavaScript strings
- Type mismatches: `get_wasm_version()` returned `unknown (got: 1114120,19)` instead of version string
- Inconsistent behavior across different functions
- Difficult to debug - functions appeared to work but returned wrong types

**The Root Cause**:
- `wasm-bindgen` generates JavaScript wrapper functions that handle type conversion
- Raw WASM exports return low-level types (pointers, lengths, etc.)
- Retrieving from `exports` gets raw exports, not wrapped functions
- Retrieving from `wasmModuleRecord` gets the fully wrapped module object

**The Solution**:
```typescript
// CORRECT: Always prioritize wasmModuleRecord for all functions
const generateLayoutValue = wasmModuleRecord ? 
  getProperty(wasmModuleRecord, 'generate_layout') : 
  getProperty(exports, 'generate_layout');
const getWasmVersionValue = wasmModuleRecord ? 
  getProperty(wasmModuleRecord, 'get_wasm_version') : 
  getProperty(exports, 'get_wasm_version');
// ... apply same pattern to ALL functions
```

**Key Lesson**: 
- Always retrieve WASM functions from `wasmModuleRecord` first (the wrapped module object)
- Fall back to `exports` only if `wasmModuleRecord` is not available
- This ensures `wasm-bindgen` generated wrappers are used for proper type conversion
- Apply this pattern consistently to ALL functions, not just some

**Prevention**:
- Use consistent retrieval pattern for all WASM functions
- Always prioritize `wasmModuleRecord` over `exports`
- Verify function return types match expected JavaScript types
- Add `get_wasm_version()` function to all WASM modules for cache debugging

**WASM Version Verification**:
- Add `get_wasm_version()` function to WASM modules to help debug caching issues
- Call and log version during initialization
- Verify version matches expected value to detect stale cached modules
- Use hardcoded version strings (e.g., `"1.0.0-20250102-0912"`) for easy identification

---

**The Mistake**: Error logging was minimal:
- Only logged generic error messages
- No stack traces
- No import paths
- No error causes

**The Impact**:
- Production debugging required reproducing issues locally
- No way to diagnose issues from logs alone
- Had to guess what import path was failing
- Couldn't see the full error chain

**The Solution**: Enhanced error logging in all route files:

```typescript
catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  if (addLogEntry) {
    addLogEntry(`Failed to load WASM module: ${errorMsg}`, 'error');
    addLogEntry(`Import path: ../../pkg/wasm_agent_tools/wasm_agent_tools.js`, 'info');
    if (error instanceof Error && error.stack) {
      addLogEntry(`Error stack: ${error.stack}`, 'error');
    }
    if (error instanceof Error && 'cause' in error && error.cause) {
      const causeMsg = error.cause instanceof Error 
        ? error.cause.message 
        : typeof error.cause === 'string' 
          ? error.cause 
          : JSON.stringify(error.cause);
      addLogEntry(`Error cause: ${causeMsg}`, 'error');
    }
  }
  throw error;
}
```

**Key Lesson**:
- Log import paths being used (helps identify path resolution issues)
- Log full stack traces (shows where errors originate)
- Log error causes (shows the full error chain)
- Use proper type narrowing for error causes (avoid `[object Object]`)

**Prevention**:
- Create a standard error logging pattern for all routes
- Include error logging in code review checklist
- Test error logging in production-like environments

---

## LLM Integration Learnings

### SmolVLM: Vision-Language Models

**What We Learned**: Vision-language models require careful tensor shape management, proper embedding merging, and understanding of autoregressive generation patterns.

#### The Three Essential Files (Plus One Critical)

To run SmolVLM in the browser, we need three essential files downloaded from Hugging Face, plus one critical file for proper text embedding:

1. **`vision_encoder.onnx`** (~393MB for 256M, ~200MB for 500M)
   - Converts raw image pixels into semantic embeddings
   - Location: `{MODEL_BASE_URL}/onnx/vision_encoder.onnx`

2. **`decoder_model_merged_int8.onnx`** (~350-400MB for 256M, ~400MB for 500M)
   - Generates text tokens autoregressively from image embeddings
   - INT8 quantized version (4× smaller than FP32)
   - Location: `{MODEL_BASE_URL}/onnx/decoder_model_merged_int8.onnx`

3. **`tokenizer.json`** (~3.5MB)
   - Converts between text and token IDs
   - Location: `{MODEL_BASE_URL}/tokenizer.json` (root directory, not in `onnx/`)

4. **`embed_tokens.onnx`** (CRITICAL, ~50-100MB)
   - **CRITICAL for proper text generation**: Converts token IDs to embeddings
   - Allows proper conditional merge of image embeddings with question embeddings (replacing `<image>` token)
   - Location: `{MODEL_BASE_URL}/onnx/embed_tokens.onnx`
   - **Without this file**: The model cannot properly combine image and text inputs, leading to nonsensical outputs

**Base URLs:**
- 500M: `https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct/resolve/main`
- 256M: `https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct/resolve/main`

#### Key Challenges We Overcame

**Challenge 1: 5D Tensor Requirement**
- **Mistake**: Initially tried to use 4D tensors `[batch, channels, height, width]`
- **Reality**: ONNX expects `[batch, num_images, channels, height, width]` (5D)
- **Solution**: Add the `num_images` dimension (always `1` for single images)

**Challenge 2: Conditional Merge (NOT Concatenation)**
- **Mistake**: Initially concatenated image embeddings with question embeddings
- **Reality**: Must **replace** the `<image>` token's embedding with image embeddings
- **Solution**: Find `<image>` token index, replace its embedding with image embeddings sequence
- **Critical**: This is a 1-to-N replacement (1 token → ~64 image patch embeddings)

**Challenge 3: Token Embeddings Without Embedding Layer**
- **Mistake**: Tried to use decoder's internal embedding layer (not accessible in ONNX)
- **Reality**: Need `embed_tokens.onnx` to convert token IDs to embeddings
- **Solution**: Load `embed_tokens.onnx` separately and use it for token→embedding conversion

See the original detailed sections below for complete implementation details.

---

### ViT-GPT2: Image Captioning with Transformers.js

**What We Learned**: Transformers.js dramatically simplifies model management compared to manual ONNX handling, but requires understanding of pipeline types and proper input formats.

**Model**: `Xenova/vit-gpt2-image-captioning`
**Endpoint**: `/image-captioning`
**Library**: `@xenova/transformers`

#### Key Advantages

1. **Automatic Model Management**: Transformers.js handles downloading, caching, and loading ONNX models
2. **Simplified API**: Single pipeline call replaces manual tensor management
3. **Built-in Tokenization**: No need to manually handle tokenizers
4. **CORS Proxy Support**: Custom fetch function handles Hugging Face CDN restrictions

#### Input Format Mistake

**Mistake**: Initially tried to pass `ImageData` or `HTMLCanvasElement` directly
**Reality**: Transformers.js expects data URL strings for image inputs
**Solution**: Convert canvas to data URL: `canvas.toDataURL('image/png')`

```typescript
// CORRECT: Use data URL
const dataUrl = canvas.toDataURL('image/png');
const result = await imageToTextPipeline(dataUrl);
```

---

### Function Calling Agent: DistilGPT-2 with WASM Tools

**What We Learned**: Base language models (not instruction-tuned) require aggressive prompt engineering and output cleaning. Function calling with small models is possible but requires careful design.

**The Mistake**: Initially expected DistilGPT-2 to generate clean function calls without extensive prompt engineering.

**The Impact**: Model generated inconsistent output formats, requiring multiple parsing strategies and fallbacks.

**The Solution**: 
- Implemented structured prompt templates with examples
- Added multiple parsing strategies (JSON, regex, pattern matching)
- Created fallback mechanisms for when parsing fails
- Added human-in-the-loop clarification for ambiguous goals

**Key Lesson**: Base models require more hand-holding than chat models. For instruction-following tasks, prefer chat models (like Qwen) over base models (like DistilGPT-2).

---

### Transformers.js Learnings: Qwen Chat Model for Text-to-Layout

**What We Learned**: Chat models (like Qwen) are significantly better at instruction following and structured output than base models (like DistilGPT-2).

**The Mistake**: Initially considered using DistilGPT-2 for text-to-layout generation, but it struggled with generating structured JSON output.

**The Impact**: Would have required extensive prompt engineering and unreliable parsing.

**The Solution**: 
- Switched to `Xenova/qwen1.5-0.5b-chat` (chat model)
- Used chat template format for better instruction following
- Requested JSON output directly in the prompt
- Implemented two-stage parsing: JSON first, regex fallback

**Key Learnings**:

1. **Chat Template Format**: 
   ```typescript
   const messages = [{ role: 'user', content: prompt }];
   const formattedPrompt = tokenizer.apply_chat_template(messages, {
     tokenize: false,
     add_generation_prompt: true,
   });
   ```
   - Chat templates format messages properly for the model
   - `add_generation_prompt: true` adds the assistant's turn marker
   - This is critical for chat models to generate proper responses

2. **Response Extraction**: 
   - Chat models include the prompt in their output
   - Must extract only the assistant's response
   - Remove chat template tokens (`<|im_start|>`, `<|im_end|>`, etc.)

3. **Structured Output**: 
   - Chat models are better at following "respond with only JSON" instructions
   - Still need fallback parsing (regex) for robustness
   - Default values ensure the system works even if parsing fails

4. **Model Loading Patterns**:
   - Load models on-demand (not at page load)
   - Show loading progress to users
   - Cache loaded models to avoid reloading
   - Handle loading errors gracefully

**Best Practices**:
- Use chat models for instruction-following tasks
- Always implement fallback parsing strategies
- Provide clear, structured prompts
- Extract and clean model responses properly
- Handle model loading failures gracefully

---

### WFC/Babylon-WFC Learnings

**What We Learned**: Wave Function Collapse requires careful edge compatibility rules and gap-filling logic to prevent visual artifacts. Hexagonal grids use a layer-based system where each layer adds a ring around the center, forming centered hexagonal numbers.

**The Mistakes**:

1. **Double-Thick Walls**: Initially, walls could be adjacent in opposite directions, creating double-thick walls that looked wrong.

2. **Empty Gaps**: WFC algorithm could leave cells uncollapsed if they had 0 valid possibilities, creating gaps in the grid.

3. **Camera Positioning**: Initially positioned camera at grid coordinates (25, 0, 25) instead of world coordinates (0, 0, 0).

**The Impact**: 
- Visual artifacts (double-thick walls, gaps)
- Poor user experience (camera looking at wrong location)
- Inconsistent generation results

**The Solutions**:

1. **Edge Compatibility Rules**:
   ```rust
   // Walls can be adjacent in same direction (for wide buildings)
   // But NOT in opposite directions (prevents double-thick)
   TileType::WallNorth => TileEdges::new(
       EdgeType::Empty,  // North: exterior
       EdgeType::Floor,  // South: interior (connects to floor)
       EdgeType::Wall,   // East: connects to same-direction walls
       EdgeType::Wall,   // West: connects to same-direction walls
   ),
   ```
   - Same-direction walls have `Wall` edges on sides
   - Opposite-direction walls have incompatible edges
   - This allows wide buildings while preventing double-thick walls

2. **Gap Filling**:
   ```rust
   // After WFC loop completes
   for y in 0..height {
       for x in 0..width {
           if grid[y][x].is_none() {
               // Fill with floor as fallback
               grid[y][x] = Some(TileType::Floor);
           }
       }
   }
   ```
   - Ensures all cells are filled
   - Prevents visual gaps
   - Uses `Floor` as safe fallback

3. **Camera Positioning**:
   ```typescript
   // Tiles are positioned with offset: offset = -(gridSize * tileSpacing) / 2
   // So center of grid is at (0, 0, 0) in world space
   const gridCenter = new Vector3(0, 0, 0); // Not (25, 0, 25)!
   ```
   - Calculate world coordinates from tile positioning logic
   - Account for offsets and spacing
   - Test camera positioning visually

**Key Learnings**:

1. **Pre-Constraints System**: 
   - Allows external systems to guide WFC generation
   - Used for direct tile type assignment and text-to-layout
   - Must be applied before WFC begins
   - Constraints propagate automatically
   - Stored in hash map for O(1) lookups and no size limitations

3. **Entropy-Based Collapse**:
   - Always collapse lowest-entropy cells first
   - Minimizes contradictions
   - More reliable than random collapse order

4. **Constraint Propagation**:
   - Must propagate recursively to all affected neighbors
   - Use a queue/stack to track cells needing updates
   - Stop when no more changes occur

**Best Practices**:
- Design adjacency rules carefully (prepared for future constraint implementation)
- Test with various hexagon sizes and constraints
- Always fill remaining cells after WFC completes
- Use hash map storage for sparse grids to avoid size limitations

**Hexagon Layer System**:
- Hexagonal grids form centered hexagonal numbers
- Layer 0: 1 tile (center)
- Layer 1: adds 6 tiles (total 7)
- Layer 2: adds 12 tiles (total 19)
- Layer n: adds 6n tiles
- Total tiles up to layer n: 3n(n+1) + 1
- For layer 30: 3×30×31 + 1 = 2791 tiles
- Use hex distance from center to determine layer membership
- Only generate tiles within the hexagon pattern (distance <= maxLayer)
- Verify camera positioning matches actual tile positions
- Use pre-constraints for guided generation

#### Voronoi Region Generation Issues

**What We Learned**: Rust ownership rules and pattern matching are critical for WASM functions. Consuming data structures prevents their later use, and pattern matching provides cleaner error handling.

**The Mistakes**:

1. **Ownership Issue**: Consumed `hex_grid` in a loop, preventing its later use
2. **No Pattern Matching**: Used `if` statements instead of `match` for error scenarios
3. **Empty Seed Generation**: Seeds could be empty if random generation failed

**The Impact**:
- Voronoi regions returned empty array `[]` despite valid input
- Function appeared to work but returned no results
- Difficult to debug due to lack of clear error handling

**The Solutions**:

1. **Fix Ownership**:
   ```rust
   // WRONG: Consumes hex_grid, can't use it later
   for hex in hex_grid {
       // ...
   }
   
   // CORRECT: Borrow hex_grid, can use it later
   for hex in &hex_grid {
       // ...
   }
   ```

2. **Use Pattern Matching**:
   ```rust
   // WRONG: Verbose if statements
   if hex_grid.is_empty() {
       return r#"[{"q":0,"r":0,"tileType":0}]"#.to_string();
   }
   if seeds.is_empty() {
       return r#"[{"q":777,"r":777,"tileType":0}]"#.to_string();
   }
   
   // CORRECT: Clean pattern matching
   let hex_vec: Vec<(i32, i32)> = match hex_grid.as_slice() {
       [] => {
           return r#"[{"q":0,"r":0,"tileType":0}]"#.to_string();
       },
       _ => hex_grid.iter().map(|h| (h.q, h.r)).collect(),
   };
   
   let seeds_ref = match seeds.as_slice() {
       [] => {
           return r#"[{"q":777,"r":777,"tileType":0}]"#.to_string();
       },
       s => s,
   };
   ```

3. **Defensive Seed Generation**:
   ```rust
   // Always ensure at least one seed is generated
   if seeds.is_empty() && hex_count > 0 {
       // Force at least one grass seed
       seeds.push(Seed { q: 0, r: 0, tile_type: 0 });
   }
   ```

**Key Learnings**:
- Always borrow (`&`) data structures when iterating if you need them later
- Use pattern matching (`match`) for cleaner error handling in Rust
- Add defensive checks to ensure functions never return empty results when input is valid
- Pattern matching makes error scenarios explicit and easier to understand

**Best Practices**:
- Use `&collection` when iterating if collection is needed later
- Prefer `match` over `if` for error scenarios in Rust
- Add defensive fallbacks for edge cases
- Use pattern matching to make error handling explicit

---

### BabylonJS Learnings

**What We Learned**: 3D rendering requires careful attention to camera setup, mesh instancing, coordinate systems, and thin instance configuration.

**The Mistakes**:

1. **Camera Target**: Initially set camera target to grid coordinates (25, 0, 25) instead of world coordinates (0, 0, 0).

2. **Camera Angle**: Initially used side view instead of top-down view for better grid visualization.

3. **Mesh Instancing**: Initially considered creating 2500 separate meshes instead of using instancing.

**The Impact**: 
- Camera looking at wrong location
- Poor viewing angle
- Performance issues (if not using instancing)

**The Solutions**:

1. **Camera Setup**:
   ```typescript
   // Calculate actual world center from tile positioning
   const offset = -(gridSize * tileSpacing) / 2;
   // Center is at (0, 0, 0) in world space
   const gridCenter = new Vector3(0, 0, 0);
   
   const camera = new ArcRotateCamera(
     'camera',
     0,    // Alpha: horizontal rotation (doesn't matter for top-down)
     0,    // Beta: 0 = straight down (top view)
     50,   // Radius: 50 meters above
     gridCenter,
     scene
   );
   ```

2. **Mesh Instancing**:
   ```typescript
   // Create one base mesh per tile type (5 types)
   const baseMeshes = new Map<TileType['type'], Mesh>();
   
   // Create instances for each tile (2791 instances from 5 base meshes)
   for (const tile of tiles) {
     const baseMesh = baseMeshes.get(tile.type);
     const instance = baseMesh.createInstance(`tile_${q}_${r}`);
     instance.position.set(worldX, 0, worldZ);
   }
   ```
   - Reduces draw calls from 2791 to 5
   - Massive performance improvement
   - Essential for rendering large hexagonal grids

3. **Material Setup**:
   ```typescript
   const material = new StandardMaterial(`material_${tileType}`, scene);
   material.diffuseColor = getTileColor(tileType);
   material.specularColor = new Color3(0.1, 0.1, 0.1); // Low specular for matte look
   ```
   - One material per tile type
   - Shared across all instances
   - Efficient memory usage

**Key Learnings**:

1. **Coordinate Systems**: 
   - Grid coordinates (0-49) vs world coordinates (offset-based)
   - Always calculate world positions from grid positions
   - Account for spacing and offsets

2. **Mesh Instancing**:
   - Essential for rendering many similar objects
   - Reduces draw calls dramatically
   - Shared materials and geometry

3. **Camera Controls**:
   - ArcRotateCamera provides orbit controls
   - Beta = 0 is straight down (top view)
   - Radius controls distance from target
   - Target should be actual world center

4. **Babylon 2D UI**:
   - Use `AdvancedDynamicTexture` for UI
   - Buttons rendered within 3D canvas
   - Better than HTML overlays for fullscreen

**Best Practices**:
- Always use mesh instancing for repeated objects
- Calculate world coordinates from grid logic
- Test camera positioning visually
- Use appropriate camera angles for the content
- Leverage Babylon 2D UI for in-canvas controls

#### Thin Instance Colors: Per-Instance Attributes

**What We Learned**: Thin instances with per-instance colors require specific attribute names, material types, and visibility settings. StandardMaterial doesn't automatically support per-instance colors from thin instance buffers.

**The Mistakes**:

1. **Wrong Attribute Name**: Used `"color"` instead of `"instanceColor"` for thin instance color buffer
2. **Wrong Material Type**: Used `StandardMaterial` which doesn't automatically support per-instance colors from thin instance buffers
3. **Base Mesh Visibility**: Base mesh was set to `isVisible = false`, preventing thin instances from rendering

**The Impact**:
- Only one hex tile visible instead of all 2791 tiles
- No per-instance colors applied (all tiles same color)
- Thin instances not rendering at all

**The Solutions**:

1. **Correct Attribute Name**:
   ```typescript
   // WRONG: "color" doesn't work for thin instances
   baseMesh.thinInstanceSetBuffer("color", bufferColors, 4);
   
   // CORRECT: "instanceColor" is the standard attribute name
   baseMesh.thinInstanceSetBuffer("instanceColor", bufferColors, 4);
   ```

2. **Use PBRMaterial**:
   ```typescript
   // WRONG: StandardMaterial doesn't support per-instance colors automatically
   const material = new StandardMaterial(`material_${tileType.type}`, scene);
   material.diffuseColor = getTileColor(tileType);
   
   // CORRECT: PBRMaterial has better support for per-instance attributes
   const material = new PBRMaterial(`material_${tileType.type}`, scene);
   material.albedoColor = getTileColor(tileType);
   material.metallicF0Factor = 0.0;
   material.roughness = 0.8;
   ```

3. **Base Mesh Visibility**:
   ```typescript
   // WRONG: Base mesh hidden prevents thin instances from rendering
   baseMesh.isVisible = false;
   
   // CORRECT: Base mesh must be visible for thin instances to render
   baseMesh.isVisible = true;
   ```

4. **Complete Setup Pattern**:
   ```typescript
   // Set transformation matrices
   baseMesh.thinInstanceSetBuffer("matrix", matrices, 16);
   
   // Set per-instance colors (use "instanceColor" attribute name)
   baseMesh.thinInstanceSetBuffer("instanceColor", bufferColors, 4);
   
   // Set instance count (required for rendering)
   baseMesh.thinInstanceCount = numInstances;
   
   // Apply PBRMaterial (supports per-instance colors)
   baseMesh.material = baseMaterial;
   
   // Make base mesh visible
   baseMesh.isVisible = true;
   ```

**Key Learnings**:
- Thin instance colors use `"instanceColor"` attribute name (not `"color"`)
- PBRMaterial has better support for per-instance attributes than StandardMaterial
- Base mesh must be visible for thin instances to render
- Always set `thinInstanceCount` after setting buffers
- Color buffer format: `Float32Array` with 4 components per instance (RGBA)

**Best Practices**:
- Use `"instanceColor"` for thin instance color buffers
- Prefer PBRMaterial over StandardMaterial for per-instance colors
- Always make base mesh visible when using thin instances
- Set instance count after setting all buffers
- Use proper color format (RGBA, 4 components per instance)

---

**Model**: `Xenova/distilgpt2` (DistilGPT-2)
**Endpoint**: `/function-calling`
**Library**: `@xenova/transformers` + Rust WASM (`wasm-agent-tools`)

#### Model Choice Lessons

**Why DistilGPT-2?**
- Small size (~350MB), fits in browser memory
- Fast inference for interactive use
- Proven compatibility with Transformers.js
- Context window: 1024 tokens (sufficient for simple function calling)

**Limitations We Encountered:**
- Base model (not instruction-tuned), requires aggressive prompt engineering
- Limited reasoning capabilities
- Generates repetitive or nonsensical output without careful prompting
- Requires extensive output cleaning to extract valid function calls

#### Prompt Engineering Mistakes

**Mistake 1**: Including hardcoded examples in prompts
- **Problem**: Model copied examples verbatim instead of using actual goal data
- **Solution**: Use dynamic prompts with actual goal data, no hardcoded examples

**Mistake 2**: Generic prompts for all goal types
- **Problem**: Model couldn't infer correct tool for different goal types
- **Solution**: Generate type-specific prompts (math, array, text) with explicit instructions

**Mistake 3**: Not guiding the model to produce final answers
- **Problem**: Model would call tools but never output final answer
- **Solution**: Explicitly instruct "Step 2: Output the result as the final answer"

#### Output Cleaning Lessons

**Mistake**: Trusting raw LLM output
- **Problem**: Base GPT-2 generates garbage (C++ code, repetitive patterns, etc.)
- **Solution**: Aggressive cleaning:
  - Extract only valid function calls
  - Filter out garbage text
  - Validate function names against known tools
  - Extract numbers or meaningful text from cleaned output

---

## The Download Journey

### CORS Proxy System

**What We Learned**: Hugging Face CDN doesn't allow direct cross-origin requests. Multiple proxy fallbacks are essential for reliability.

**Mistake**: Using a single CORS proxy
**Reality**: Proxies are unreliable and rate-limited
**Solution**: Fallback chain:
1. `api.allorigins.win/raw?url=` - Primary proxy
2. `corsproxy.io/?` - Secondary proxy
3. `api.codetabs.com/v1/proxy?quest=` - Tertiary proxy
4. `cors-anywhere.herokuapp.com/` - Fallback (may be rate-limited)
5. `whateverorigin.org/get?url=` - Last resort (returns JSON-wrapped content)

**Proxy Selection Logic:**
- Try each proxy in order
- Skip proxies returning error status codes (403, 408, 500, 502, 503, 504, redirects)
- Validate responses (check for HTML error pages, suspiciously small files)
- Fall back to direct fetch if all proxies fail

### Caching System

**What We Learned**: Browser Cache API is essential for large model files. Without caching, users re-download hundreds of MBs on every page load.

**Implementation:**
- Cache Name: `smolvlm-models-v1`
- Strategy: Check cache before download, save to cache after successful download
- Benefits: Faster subsequent loads, reduced bandwidth usage
- User Control: "Clear Cache" button to reset downloads

---

## The Inference Pipeline

### Complete Flow

1. **Image Upload/Webcam Capture**
   - User provides image via file input or webcam

2. **WASM Preprocessing**
   - Decode image (PNG/JPEG)
   - Center crop to square
   - Resize to target size (512×512 for 256M, 224×224 for 500M)
   - Convert RGBA → RGB
   - Normalize pixels to `[0, 1]` range
   - Return `Float32Array`

3. **Vision Encoder**
   - Reshape image data to 5D tensor
   - Create `pixel_attention_mask`
   - Run vision encoder
   - Extract image embeddings

4. **Question Formatting**
   - Format question with chat template: `<|im_start|>User: <image> {question}<end_of_utterance>\nAssistant:`
   - Tokenize question text (includes `<image>` token ID)
   - Find `<image>` token index in tokenized sequence

5. **Conditional Merge**
   - Get embeddings for full tokenized sequence (including `<image>` token)
   - Replace `<image>` token's embedding with image embeddings sequence
   - Final sequence length: `(questionSeqLen - 1) + imageSeqLen`

6. **Decoder Initialization**
   - Prepare initial decoder inputs with merged embeddings
   - Initialize empty `past_key_values`

7. **Autoregressive Generation**
   - Loop for up to `MAX_GENERATION_LENGTH` steps:
     - Run decoder
     - Extract logits
     - Get next token (argmax)
     - Check for EOS token
     - Update `past_key_values`
     - Prepare inputs for next iteration

8. **Text Decoding**
   - Decode generated token IDs to text
   - Return final answer

---

## Tensor Shapes and Type Safety

**What We Learned**: TypeScript type aliases for tensor shapes prevent rank mismatches and dimension errors at compile time.

```typescript
type PastKeyValueShape = [number, number, number, number]; // [batch, num_heads, seq_len, head_dim]
type ImageTensorShape = [number, number, number, number, number]; // [batch, num_images, channels, height, width]
type PixelAttentionMaskShape = [number, number, number, number]; // [batch, num_images, height, width]
type DecoderAttentionMaskShape = [number, number]; // [batch, sequence_length]
type PositionIdsShape = [number, number]; // [batch, sequence_length]
type InputIdsShape = [number, number]; // [batch, sequence_length]
```

These types prevent rank mismatches and dimension errors at compile time.

---

## Known Challenges and Solutions

### Challenge 1: Token Embeddings Without Embedding Layer ✅ SOLVED

**Problem**: For autoregressive generation, we need embeddings for new tokens. Without access to the embedding layer, we can't convert token IDs to embeddings.

**Solution**: Use `embed_tokens.onnx` model (if available) to convert token IDs to embeddings. This is the official approach recommended by Hugging Face and documented in the SmolVLM-256M-Instruct README.

**Implementation**:
1. Load `embed_tokens.onnx` during model initialization (optional, fails gracefully if not available)
2. Format prompt with `<image>` token placeholder: `<|im_start|>User: <image> {question}<end_of_utterance>\nAssistant:`
3. Tokenize prompt (includes `<image>` token ID)
4. Find `<image>` token index in tokenized sequence
5. For first forward pass: Convert question token IDs (including `<image>`) to embeddings using `embed_tokens.onnx`
6. **Conditional merge**: Replace `<image>` token's embedding with image embeddings (1 token → ~64 image patch embeddings)
7. Pass merged embeddings as `inputs_embeds` to decoder
8. For subsequent tokens: Use `embed_tokens.onnx` to convert token ID to embedding, then pass to decoder

**Research Source**: [SmolVLM-256M-Instruct README](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct/blob/main/README.md)

### Challenge 2: Mixing Image and Text Inputs ✅ SOLVED

**Problem**: We need to provide both image embeddings and question tokens in the first forward pass, but ONNX models typically don't allow mixing `input_ids` and `inputs_embeds`.

**Solution**: 
- **Correct Approach**: Use `embed_tokens.onnx` to convert question token IDs (including `<image>` token) to embeddings, then **conditionally replace** the `<image>` token's embedding with image embeddings
- This is a **conditional merge**, not a simple concatenation
- The `<image>` token in the prompt gets replaced by the vision encoder's output (1 token → ~64 image patch embeddings)
- Final sequence: `[tokens_before_image, image_embeds, tokens_after_image]`

### Challenge 3: Past Key Values Extraction

**Problem**: `past_key_values` must be correctly extracted from decoder outputs and passed to the next iteration. Missing or incorrect shapes cause errors.

**Solution**: 
- Iterate through all decoder output keys
- Extract all `past_key_values.*` tensors
- Ensure all required `past_key_values` inputs are present (reuse previous values or create empty tensors if missing)

### Challenge 4: CORS and Proxy Reliability

**Problem**: Hugging Face CDN blocks direct browser requests. CORS proxies are unreliable.

**Solution**: 
- Multiple proxy fallback chain
- Robust error detection and retry logic
- Direct fetch as last resort
- Caching to reduce dependency on proxies

---

## Production Deployment Checklist

Before deploying to production, verify:

### Build Configuration
- [ ] All WASM module directories in `render.yaml` `buildFilter.paths`
- [ ] All WASM modules in `Cargo.toml` workspace members
- [ ] All WASM modules in `Dockerfile` COPY commands
- [ ] All WASM modules in `scripts/build.sh`
- [ ] All routes in `vite.config.ts` `rollupOptions.input`
- [ ] All routes in `vite.config.ts` `devServerRouting` middleware
- [ ] All routes in `nginx.conf.template` location blocks

### Error Handling
- [ ] Error messages preserve original error details
- [ ] Error wrapping includes original message in new message
- [ ] Error causes are properly extracted and displayed
- [ ] Stack traces are logged for debugging

### Error Logging
- [ ] Import paths are logged
- [ ] Full error messages are logged
- [ ] Stack traces are logged
- [ ] Error causes are logged (when available)
- [ ] Type narrowing for error causes (avoid `[object Object]`)

### WASM Module Loading
- [ ] All WASM modules use `loadWasmModule` helper
- [ ] All WASM modules have proper validation functions
- [ ] WASM module paths are correct for both dev and production
- [ ] Vite configuration handles WASM correctly (`assetsInlineLimit: 0`)
- [ ] All WASM functions retrieved from `wasmModuleRecord` first (not `exports`)
- [ ] WASM version function implemented and verified for cache debugging

### Testing
- [ ] Test all endpoints in production-like environment
- [ ] Verify WASM modules load correctly
- [ ] Verify error messages are helpful
- [ ] Verify error logging is comprehensive
- [ ] Test error scenarios (network failures, missing files, etc.)

---

## Future Improvements

### 1. Embedding Layer Extraction

Extract embedding weights from the ONNX decoder model to enable proper token embedding conversion. This would allow us to:
- Conditionally merge image embeddings with question embeddings in `inputs_embeds` (replacing `<image>` token)
- Use proper embeddings for new tokens in autoregressive generation

### 2. Model Input Structure Analysis

Create a tool to automatically analyze ONNX model inputs/outputs and generate TypeScript interfaces. This would:
- Reduce manual errors
- Improve type safety
- Make it easier to support new models

### 3. Improved Error Messages

Provide more specific error messages based on common failure modes:
- "Model expects 5D tensor but got 4D" → Show expected vs actual shape
- "Missing input: past_key_values.0.key" → List all required inputs
- "Invalid token embedding" → Suggest using `input_ids` if supported

### 4. Generation Quality Improvements

- **Temperature Sampling**: Instead of argmax, use temperature-based sampling for more diverse outputs
- **Top-k/Top-p Sampling**: Limit sampling to top-k tokens or nucleus (top-p)
- **Beam Search**: Generate multiple candidates and select the best
- **Repetition Penalty**: Reduce repetitive token generation

### 5. Performance Optimizations

- **WebGPU Backend**: Use WebGPU execution provider for faster inference (if available)
- **Model Quantization**: Further optimize with INT4 quantization (if available)
- **Streaming Generation**: Stream tokens as they're generated (better UX)

### 6. Model Variant Support

- **SmolVLM-1B**: Support for larger 1B parameter model
- **Fine-tuned Variants**: Support for domain-specific fine-tuned models

---

## Troubleshooting Garbage Output

If the model generates repetitive garbage output (e.g., "sersymour refund laptigALTH livejoice..."), check:

1. **Prompt Format**: Ensure the prompt format is `<|im_start|>User: <image> {question}<end_of_utterance>\nAssistant:` with the `<image>` token included
2. **Conditional Merge**: Verify that image embeddings **replace** the `<image>` token's embedding, not concatenate with it
3. **Image Token Index**: Confirm the `<image>` token is found in the tokenized sequence and its index is correct
4. **Sequence Length**: Verify the final sequence length is `(questionSeqLen - 1) + imageSeqLen` (replacing 1 token with imageSeqLen tokens)
5. **Position IDs**: Verify position_ids are calculated as `initialSequenceLength + generatedTokenIds.length` for subsequent iterations
6. **Repetition Detection**: Check that long pattern detection (5-gram, 10-gram, sliding window) is working

Common issues:
- **Missing `<image>` token**: The prompt must include `<image>` token placeholder - without it, the model can't properly merge image and text
- **Incorrect merge**: Concatenating `[image_embeds, question_embeds]` instead of replacing the `<image>` token causes garbage output from the first token
- **Wrong sequence length**: Using `imageSeqLen + questionSeqLen` instead of `(questionSeqLen - 1) + imageSeqLen` causes dimension mismatches
- **Wrong position IDs**: Using `currentSequencePosition - 1` instead of absolute position causes misalignment
- **Insufficient repetition detection**: Only checking 2-gram/3-gram misses longer patterns (10-12 tokens)

---

## References

### SmolVLM
- **Hugging Face Models**:
  - [SmolVLM-500M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct)
  - [SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct)
- **ONNX Runtime Web**: [Documentation](https://onnxruntime.ai/docs/tutorials/web/)
- **Hugging Face Tokenizers**: [Documentation](https://github.com/huggingface/tokenizers)

### ViT-GPT2
- **Model**: [Xenova/vit-gpt2-image-captioning](https://huggingface.co/Xenova/vit-gpt2-image-captioning)
- **Transformers.js**: [Documentation](https://huggingface.co/docs/transformers.js/)

### Function Calling Agent
- **Model**: [Xenova/distilgpt2](https://huggingface.co/Xenova/distilgpt2)
- **Transformers.js**: [Documentation](https://huggingface.co/docs/transformers.js/)
- **DistilGPT-2 Paper**: [DistilBERT: a distilled version of BERT](https://arxiv.org/abs/1910.01108)

### Qwen Chat Model
- **Model**: [Xenova/qwen1.5-0.5b-chat](https://huggingface.co/Xenova/qwen1.5-0.5b-chat)
- **Transformers.js**: [Documentation](https://huggingface.co/docs/transformers.js/)
- **Qwen Paper**: [Qwen Technical Report](https://arxiv.org/abs/2309.16609)

### Wave Function Collapse
- **Original Implementation**: [WaveFunctionCollapse by Maxim Gumin](https://github.com/mxgmn/WaveFunctionCollapse)
- **Algorithm Explanation**: [WFC Algorithm Overview](https://robertheaton.com/2018/12/17/wavefunction-collapse-algorithm/)
- **TileGPT Paper**: [Generative Design through Quality-Diversity Data Synthesis and Language Models](https://tilegpt.github.io/)

### BabylonJS
- **Official Documentation**: [Babylon.js Documentation](https://doc.babylonjs.com/)
- **Mesh Instancing**: [Instanced Meshes Tutorial](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances)
- **2D UI**: [Babylon.js GUI Documentation](https://doc.babylonjs.com/features/featuresDeepDive/gui/gui)

---

*Last Updated: December 2024*

