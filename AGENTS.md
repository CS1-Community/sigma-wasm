# AGENTS.md — Sigma WASM Project Guide

This document provides an index of all endpoints, their associated files, WASM modules, and relevant documentation for AI coding agents working on this project.

## Project Overview

A client-side AI/WebGPU web application built with Vite, TypeScript, Babylon.js, Rust WASM, and Transformers.js. All LLM inference and computation happens in the browser. Deployed to Render.com via Docker + Nginx.

## Key Documentation

| Document | Purpose |
|---|---|
| [README.md](README.md) | Project overview, setup, and usage |
| [LEARN_FROM_MISTAKES.md](LEARN_FROM_MISTAKES.md) | Critical lessons learned from production issues |
| [CODING_STANDARDS.md](CODING_STANDARDS.md) | Code style, patterns, and conventions |
| [FULLSTACK_RUST_FOR_SIGMAS.md](FULLSTACK_RUST_FOR_SIGMAS.md) | Rust/WASM development guide |
| [RESEARCH_REFERENCES.md](RESEARCH_REFERENCES.md) | External references and research |

## Architecture

- **Build**: Vite + custom plugins for WASM module copying and import rewriting
- **Routing**: Dev: Vite middleware (`vite.config.ts`). Prod: Nginx (`nginx.conf.template`)
- **WASM**: Rust → `wasm-pack` → `pkg/` directory. Each module has a `wasm-*` crate.
- **Deployment**: `Dockerfile` multi-stage → Render.com via `render.yaml`

### Adding New Endpoints Checklist

When adding a new endpoint, update ALL of:
1. `pages/<name>.html` — HTML page
2. `src/routes/<name>.ts` — TypeScript route logic
3. `vite.config.ts` — Dev server routing AND rollup input
4. `index.html` — Hub page links
5. `Dockerfile` — If new WASM module
6. `Cargo.toml` — Workspace member (if new WASM crate)
7. `render.yaml` — Build filter paths (if new directories)
8. `scripts/build.sh` — Build script (if new WASM module)
9. `nginx.conf.template` — Production routing (if new page)

---

## Endpoints

### 1. Hello WASM (`/hello-wasm`)

**Purpose**: Basic WASM integration demo. Text processing and utility functions.

| Component | Path |
|---|---|
| HTML | [`pages/hello-wasm.html`](pages/hello-wasm.html) |
| Route | [`src/routes/hello-wasm.ts`](src/routes/hello-wasm.ts) |
| WASM Crate | [`wasm-hello/`](wasm-hello/) |

**Relevant LEARN_FROM_MISTAKES sections**: WASM Function Retrieval Pattern, Error Handling Anti-Patterns

---

### 2. A* Pathfinding (`/astar`)

**Purpose**: Interactive A* pathfinding visualization using WASM.

| Component | Path |
|---|---|
| HTML | [`pages/astar.html`](pages/astar.html) |
| Route | [`src/routes/astar.ts`](src/routes/astar.ts) |
| WASM Crate | [`wasm-astar/`](wasm-astar/) |

---

### 3. SmolVLM 500M (`/preprocess-smolvlm-500m`)

**Purpose**: Vision-Language Model (500M params) for image understanding. Uses ONNX Runtime Web.

| Component | Path |
|---|---|
| HTML | [`pages/preprocess-smolvlm-500m.html`](pages/preprocess-smolvlm-500m.html) |
| Route | [`src/routes/preprocess-smolvlm-500m.ts`](src/routes/preprocess-smolvlm-500m.ts) |
| WASM Crate | [`wasm-preprocess/`](wasm-preprocess/) |

**Relevant LEARN_FROM_MISTAKES sections**: SmolVLM: Vision-Language Models (5D tensors, conditional merge, embed_tokens.onnx)

---

### 4. SmolVLM 256M (`/preprocess-smolvlm-256m`)

**Purpose**: Vision-Language Model (256M params, uses 512×512 images). Uses ONNX Runtime Web.

| Component | Path |
|---|---|
| HTML | [`pages/preprocess-smolvlm-256m.html`](pages/preprocess-smolvlm-256m.html) |
| Route | [`src/routes/preprocess-smolvlm-256m.ts`](src/routes/preprocess-smolvlm-256m.ts) |
| WASM Crate | [`wasm-preprocess-256m/`](wasm-preprocess-256m/) |

**Relevant LEARN_FROM_MISTAKES sections**: SmolVLM: Vision-Language Models

---

### 5. Image Captioning (`/image-captioning`)

**Purpose**: ViT-GPT2 image captioning using Transformers.js.

| Component | Path |
|---|---|
| HTML | [`pages/image-captioning.html`](pages/image-captioning.html) |
| Route | [`src/routes/image-captioning.ts`](src/routes/image-captioning.ts) |
| WASM Crate | [`wasm-preprocess-image-captioning/`](wasm-preprocess-image-captioning/) |

**Relevant LEARN_FROM_MISTAKES sections**: ViT-GPT2: Image Captioning with Transformers.js

---

### 6. Function Calling Agent (`/function-calling`)

**Purpose**: Autonomous agent with DistilGPT-2 + WASM tools (calculate, process_text, get_stats).

| Component | Path |
|---|---|
| HTML | [`pages/function-calling.html`](pages/function-calling.html) |
| Route | [`src/routes/function-calling.ts`](src/routes/function-calling.ts) |
| WASM Crate | [`wasm-agent-tools/`](wasm-agent-tools/) |

**Relevant LEARN_FROM_MISTAKES sections**: Function Calling Agent: DistilGPT-2 with WASM Tools

---

### 7. Fractal Chat (`/fractal-chat`)

**Purpose**: Interactive chat with Qwen model + WASM fractal generation.

| Component | Path |
|---|---|
| HTML | [`pages/fractal-chat.html`](pages/fractal-chat.html) |
| Route | [`src/routes/fractal-chat.ts`](src/routes/fractal-chat.ts) |
| Worker | [`src/routes/fractal-chat.worker.ts`](src/routes/fractal-chat.worker.ts) |
| WASM Crate | [`wasm-fractal-chat/`](wasm-fractal-chat/) |

**Relevant LEARN_FROM_MISTAKES sections**: Transformers.js Learnings: Qwen Chat Model

---

### 8. Fractal Zoom (`/fractal-zoom`)

**Purpose**: WASM-powered fractal zoom visualization.

| Component | Path |
|---|---|
| HTML | [`pages/fractal-zoom.html`](pages/fractal-zoom.html) |
| Route | [`src/routes/fractal-zoom.ts`](src/routes/fractal-zoom.ts) |
| WASM Crate | [`wasm-fractal-zoom/`](wasm-fractal-zoom/) |

**Relevant LEARN_FROM_MISTAKES sections**: Nginx Routing: Prefix Matching vs Exact Match, WASM Loading: Robust Validation Pattern

---

### 9. Multilingual Chat (`/multilingual-chat`)

**Purpose**: Multilingual chat interface using Transformers.js.

| Component | Path |
|---|---|
| HTML | [`pages/multilingual-chat.html`](pages/multilingual-chat.html) |
| Route | [`src/routes/multilingual-chat.ts`](src/routes/multilingual-chat.ts) |
| Worker | [`src/routes/multilingual-chat.worker.ts`](src/routes/multilingual-chat.worker.ts) |
| WASM Crate | [`wasm-multilingual-chat/`](wasm-multilingual-chat/) |

---

### 10. Babylon WFC (`/babylon-wfc`)

**Purpose**: Text-to-layout generation with Wave Function Collapse + Babylon.js 3D rendering. Supports hexagonal grids, Voronoi regions, and mesh instancing.

| Component | Path |
|---|---|
| HTML | [`pages/babylon-wfc.html`](pages/babylon-wfc.html) |
| Route | [`src/routes/babylon-wfc.ts`](src/routes/babylon-wfc.ts) |
| Worker | [`src/routes/babylon-wfc.worker.ts`](src/routes/babylon-wfc.worker.ts) |
| WASM Crate | [`wasm-babylon-wfc/`](wasm-babylon-wfc/) |

**Relevant LEARN_FROM_MISTAKES sections**: WFC/Babylon-WFC Learnings, Hexagonal Chunk Neighbor Calculation, Voronoi Region Generation, BabylonJS Learnings (mesh instancing, camera, coordinate systems)

---

### 11. Babylon Chunks (`/babylon-chunks`)

**Purpose**: Infinite hexagonal chunk-based world generation with Babylon.js, WFC, and A* pathfinding.

| Component | Path |
|---|---|
| HTML | [`pages/babylon-chunks.html`](pages/babylon-chunks.html) |
| Route | [`src/routes/babylon-chunks.ts`](src/routes/babylon-chunks.ts) |
| Worker | [`src/routes/babylon-chunks.worker.ts`](src/routes/babylon-chunks.worker.ts) |
| Submodules | [`src/routes/babylon-chunks/`](src/routes/babylon-chunks/) (16 submodules) |
| WASM Crate | [`wasm-babylon-chunks/`](wasm-babylon-chunks/) |

**Relevant LEARN_FROM_MISTAKES sections**: Hexagonal Chunk Neighbor Calculation, Coordinate System Handedness, Thin Instance Colors

---

### 12. Babylon Mandelbulb (`/babylon-mandelbulb`)

**Purpose**: Real-time 3D Mandelbulb fractal rendering using WebGPU WGSL ray marching + Babylon.js. Features adjustable power, palette selection, detail control, and billboarding.

| Component | Path |
|---|---|
| HTML | [`pages/babylon-mandelbulb.html`](pages/babylon-mandelbulb.html) |
| Route | [`src/routes/babylon-mandelbulb.ts`](src/routes/babylon-mandelbulb.ts) |
| WASM Crate | [`wasm-babylon-mandelbulb/`](wasm-babylon-mandelbulb/) |

**Relevant LEARN_FROM_MISTAKES sections**: WGSL ShaderMaterial: Babylon-Flavored WGSL Syntax, Nginx Routing: Prefix Matching vs Exact Match, WASM Loading: Robust Validation Pattern

> [!IMPORTANT]
> This endpoint uses **WGSL shaders** (NOT GLSL). Babylon.js requires a specific "Babylon-flavored" WGSL syntax with `#include<sceneUboDeclaration>`, `attribute`, `varying`, `uniform` keywords, and `VertexInputs`/`FragmentInputs` struct names. See LEARN_FROM_MISTAKES.md for critical details.

---

## Build & Configuration Files

| File | Purpose |
|---|---|
| [`vite.config.ts`](vite.config.ts) | Dev routing, WASM module copying/validation, import rewriting |
| [`Cargo.toml`](Cargo.toml) | Rust workspace (all `wasm-*` crates) |
| [`Dockerfile`](Dockerfile) | Multi-stage Docker build (Rust → Node → Nginx) |
| [`render.yaml`](render.yaml) | Render.com deployment config + build filter paths |
| [`scripts/build.sh`](scripts/build.sh) | WASM build script |
| [`scripts/build-wasm.sh`](scripts/build-wasm.sh) | Individual WASM module build script (handles caching) |
| [`nginx.conf.template`](nginx.conf.template) | Production routing |
| [`tsconfig.json`](tsconfig.json) | TypeScript config |
| [`package.json`](package.json) | Node dependencies |
