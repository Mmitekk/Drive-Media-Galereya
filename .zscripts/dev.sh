#!/bin/bash
# Custom dev script for DMGA project
# Starts API proxy (bypasses workers.dev blocking) + Next.js dev server

set -e

PROJECT_DIR="/home/z/my-project"

echo "[DEV] Starting DMGA API proxy on port 3001..."
cd "$PROJECT_DIR"
node proxy-server.js &
PROXY_PID=$!

sleep 2
if kill -0 $PROXY_PID 2>/dev/null; then
    echo "[DEV] ✓ Proxy ready on http://localhost:3001"
else
    echo "[DEV] ✗ Proxy failed, continuing without it"
fi

echo "[DEV] Starting Next.js dev server on port 3000..."
cd "$PROJECT_DIR"
exec node node_modules/.bin/next dev -p 3000
