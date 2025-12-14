# Multi-stage Dockerfile for Rust WASM + Vite build
# Stage 1: Rust WASM Builder
FROM rust:1-alpine AS rust-builder

# Install build dependencies
RUN apk add --no-cache \
    musl-dev \
    perl \
    make \
    git \
    bash

# Install wasm-bindgen-cli
RUN cargo install wasm-bindgen-cli --version 0.2.87

# Install wasm-opt from binaryen
RUN apk add --no-cache binaryen

# Set working directory
WORKDIR /app

# Copy Cargo files for dependency caching
COPY Cargo.toml ./

# Create dummy src to cache dependencies (if Cargo.lock exists)
RUN mkdir -p src && \
    echo "fn main() {}" > src/lib.rs || true

# Build dependencies only (for caching)
RUN cargo build --target wasm32-unknown-unknown --release || true

# Copy actual source code
COPY src ./src
COPY scripts ./scripts

# Make build script executable
RUN chmod +x scripts/build.sh

# Add wasm32 target
RUN rustup target add wasm32-unknown-unknown

# Build WASM module
RUN ./scripts/build.sh

# Stage 2: Node.js Frontend Builder
FROM node:20-alpine AS node-builder

WORKDIR /app

# Copy package files for dependency caching
COPY package.json ./

# Install dependencies
# Using npm install instead of npm ci since package-lock.json is gitignored
# This will generate a new package-lock.json during build
RUN npm install

# Copy Rust build output
COPY --from=rust-builder /app/pkg ./pkg

# Copy frontend source
COPY src ./src
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./

# Build frontend
RUN npm run build

# Stage 3: Runtime (nginx for static files)
FROM nginx:alpine AS runtime

# Install wget for health checks
RUN apk add --no-cache wget

# Copy built static files
COPY --from=node-builder /app/dist /usr/share/nginx/html

# Copy nginx configuration (ensures WASM MIME type and proper serving)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check (using wget if available, otherwise use basic check)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ 2>/dev/null || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

