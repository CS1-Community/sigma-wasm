#!/bin/bash
set -e

# Build a single WASM crate
# Usage: ./build-wasm.sh <crate-name> <output-dir>
# Example: ./build-wasm.sh wasm-astar pkg/wasm_astar

if [ $# -lt 2 ]; then
    echo "Usage: $0 <crate-name> <output-dir>"
    echo "Example: $0 wasm-astar pkg/wasm_astar"
    exit 1
fi

CRATE_NAME=$1
OUTPUT_DIR=$2
THIS_SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$THIS_SCRIPTS_DIR/.."

echo "==========================================================="
echo "BUILDING $CRATE_NAME TO WASM"
echo "==========================================================="

# Check for required tools
if ! command -v cargo &> /dev/null; then
    echo "Error: cargo not found. Please install Rust: https://rustup.rs/"
    exit 1
fi

if ! command -v wasm-bindgen &> /dev/null; then
    echo "Error: wasm-bindgen not found. Install with: cargo install wasm-bindgen-cli"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Add wasm32 target if not already added
rustup target add wasm32-unknown-unknown 2>/dev/null || true

# Compile to wasm
echo "Compiling $CRATE_NAME to WASM..."
cargo build --target wasm32-unknown-unknown --release --package "$CRATE_NAME"

# Run wasm-bindgen
# Cargo converts hyphens to underscores in output filenames
# Use sed instead of tr for better Alpine Linux compatibility
WASM_FILENAME=$(echo "$CRATE_NAME" | sed 's/-/_/g')
echo "Running wasm-bindgen..."
if ! wasm-bindgen --target web \
    --out-dir "$OUTPUT_DIR" \
    "target/wasm32-unknown-unknown/release/${WASM_FILENAME}.wasm"; then
    echo "ERROR: wasm-bindgen failed for $CRATE_NAME" >&2
    exit 1
fi

# Validate wasm-bindgen output immediately after generation
JS_FILE="$OUTPUT_DIR/${WASM_FILENAME}.js"
WASM_FILE="$OUTPUT_DIR/${WASM_FILENAME}_bg.wasm"

# Check JS file exists
if [ ! -f "$JS_FILE" ]; then
    echo "ERROR: wasm-bindgen did not generate JS file: $JS_FILE" >&2
    exit 1
fi

# Check JS file size (should be ~10KB, at least 8KB)
JS_SIZE=$(stat -c%s "$JS_FILE" 2>/dev/null || stat -f%z "$JS_FILE" 2>/dev/null || echo "0")
if [ "$JS_SIZE" -lt 8000 ]; then
    echo "ERROR: Generated JS file is too small: $JS_FILE ($JS_SIZE bytes, expected ~10KB)" >&2
    echo "This indicates wasm-bindgen produced incomplete output." >&2
    echo "First 500 chars of file:" >&2
    head -c 500 "$JS_FILE" >&2
    echo "" >&2
    exit 1
fi

# Check for exports in JS file (should have export statements)
if ! grep -q "export" "$JS_FILE"; then
    echo "ERROR: Generated JS file has no exports: $JS_FILE" >&2
    echo "This indicates wasm-bindgen produced incomplete output." >&2
    echo "File size: $JS_SIZE bytes" >&2
    echo "First 500 chars:" >&2
    head -c 500 "$JS_FILE" >&2
    echo "" >&2
    exit 1
fi

# Count exports to verify completeness
EXPORT_COUNT=$(grep -c "export" "$JS_FILE" || echo "0")
if [ "$EXPORT_COUNT" -lt 3 ]; then
    echo "WARNING: Generated JS file has very few exports ($EXPORT_COUNT): $JS_FILE" >&2
    echo "Expected at least 3 exports (default, initSync, and module-specific exports)" >&2
fi

# Check WASM binary file exists and has reasonable size
if [ ! -f "$WASM_FILE" ]; then
    echo "ERROR: wasm-bindgen did not generate WASM file: $WASM_FILE" >&2
    exit 1
fi

WASM_SIZE=$(stat -c%s "$WASM_FILE" 2>/dev/null || stat -f%z "$WASM_FILE" 2>/dev/null || echo "0")
if [ "$WASM_SIZE" -lt 1000 ]; then
    echo "ERROR: Generated WASM file is too small: $WASM_FILE ($WASM_SIZE bytes)" >&2
    exit 1
fi

echo "✓ wasm-bindgen validation passed: JS file ($JS_SIZE bytes, $EXPORT_COUNT exports), WASM file ($WASM_SIZE bytes)"

# Optimize wasm output with wasm-opt
# Use the converted filename for the output file
if command -v wasm-opt &> /dev/null; then
    echo "Optimizing WASM with wasm-opt..."
    if ! wasm-opt -Os "$OUTPUT_DIR/${WASM_FILENAME}_bg.wasm" -o "$OUTPUT_DIR/${WASM_FILENAME}_bg.wasm"; then
        echo "WARNING: wasm-opt failed, but continuing with unoptimized WASM" >&2
    else
        echo "WASM optimized with wasm-opt"
    fi
else
    echo "Warning: wasm-opt not found. WASM will not be optimized."
    echo "  Install with: npm install -g wasm-opt"
    echo "  Or on Alpine/Debian: apk add binaryen / apt-get install binaryen"
fi

echo "Build complete! Output in $OUTPUT_DIR/"

