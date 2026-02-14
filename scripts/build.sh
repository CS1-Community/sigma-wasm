#!/bin/bash
set -e # If any command fails, script exits immediately

echo "==========================================================="
echo "BUILDING ALL WASM MODULES"
echo "==========================================================="

THIS_SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$THIS_SCRIPTS_DIR/.."

# Clean previous build
if [ -d "pkg" ]; then
    rm -rf "pkg"
fi

# Build all WASM modules using the helper script
echo "Building wasm-astar..."
./scripts/build-wasm.sh wasm-astar pkg/wasm_astar

echo "Building wasm-preprocess..."
./scripts/build-wasm.sh wasm-preprocess pkg/wasm_preprocess

echo "Building wasm-preprocess-256m..."
./scripts/build-wasm.sh wasm-preprocess-256m pkg/wasm_preprocess_256m

echo "Building wasm-preprocess-image-captioning..."
./scripts/build-wasm.sh wasm-preprocess-image-captioning pkg/wasm_preprocess_image_captioning

echo "Building wasm-agent-tools..."
./scripts/build-wasm.sh wasm-agent-tools pkg/wasm_agent_tools

echo "Building wasm-fractal-chat..."
./scripts/build-wasm.sh wasm-fractal-chat pkg/wasm_fractal_chat

echo "Building wasm-hello..."
./scripts/build-wasm.sh wasm-hello pkg/wasm_hello

echo "Building wasm-babylon-wfc..."
./scripts/build-wasm.sh wasm-babylon-wfc pkg/wasm_babylon_wfc

echo "Building wasm-babylon-chunks..."
./scripts/build-wasm.sh wasm-babylon-chunks pkg/wasm_babylon_chunks

echo "Building wasm-multilingual-chat..."
./scripts/build-wasm.sh wasm-multilingual-chat pkg/wasm_multilingual_chat

echo "Building wasm-fractal-zoom..."
./scripts/build-wasm.sh wasm-fractal-zoom pkg/wasm_fractal_zoom

echo "==========================================================="
echo "VERIFYING ALL WASM MODULES"
echo "==========================================================="

# Verify all modules were built successfully
# **Learning Point**: Add new modules to this list when creating new WASM crates
MODULES=("wasm_astar" "wasm_preprocess" "wasm_preprocess_256m" "wasm_preprocess_image_captioning" "wasm_agent_tools" "wasm_fractal_chat" "wasm_hello" "wasm_babylon_wfc" "wasm_babylon_chunks" "wasm_multilingual_chat" "wasm_fractal_zoom")
FAILED_MODULES=()

for module in "${MODULES[@]}"; do
    JS_FILE="pkg/$module/$module.js"
    WASM_FILE="pkg/$module/${module}_bg.wasm"
    
    # Check JS file exists and has reasonable size
    if [ ! -f "$JS_FILE" ]; then
        echo "ERROR: JS file not found: $JS_FILE" >&2
        FAILED_MODULES+=("$module (missing JS file)")
        continue
    fi
    
    JS_SIZE=$(stat -c%s "$JS_FILE" 2>/dev/null || stat -f%z "$JS_FILE" 2>/dev/null || echo "0")
    if [ "$JS_SIZE" -lt 5000 ]; then
        echo "ERROR: JS file too small: $JS_FILE ($JS_SIZE bytes, expected ~10KB)" >&2
        FAILED_MODULES+=("$module (JS file too small: $JS_SIZE bytes)")
        continue
    fi
    
    # Check for exports
    if ! grep -q "export" "$JS_FILE"; then
        echo "ERROR: JS file has no exports: $JS_FILE" >&2
        FAILED_MODULES+=("$module (no exports)")
        continue
    fi
    
    # Check WASM file exists and has reasonable size
    if [ ! -f "$WASM_FILE" ]; then
        echo "ERROR: WASM file not found: $WASM_FILE" >&2
        FAILED_MODULES+=("$module (missing WASM file)")
        continue
    fi
    
    WASM_SIZE=$(stat -c%s "$WASM_FILE" 2>/dev/null || stat -f%z "$WASM_FILE" 2>/dev/null || echo "0")
    if [ "$WASM_SIZE" -lt 1000 ]; then
        echo "ERROR: WASM file too small: $WASM_FILE ($WASM_SIZE bytes)" >&2
        FAILED_MODULES+=("$module (WASM file too small: $WASM_SIZE bytes)")
        continue
    fi
    
    EXPORT_COUNT=$(grep -c "export" "$JS_FILE" || echo "0")
    echo "✓ $module: JS ($JS_SIZE bytes, $EXPORT_COUNT exports), WASM ($WASM_SIZE bytes)"
done

if [ ${#FAILED_MODULES[@]} -gt 0 ]; then
    echo "" >&2
    echo "===========================================================" >&2
    echo "BUILD FAILED: The following modules are incomplete:" >&2
    echo "===========================================================" >&2
    for failed in "${FAILED_MODULES[@]}"; do
        echo "  - $failed" >&2
    done
    echo "" >&2
    echo "This indicates the rust-builder stage produced incomplete files." >&2
    echo "Check wasm-bindgen output and Docker build logs for errors." >&2
    exit 1
fi

echo "==========================================================="
echo "ALL WASM MODULES BUILT AND VERIFIED SUCCESSFULLY"
echo "==========================================================="
