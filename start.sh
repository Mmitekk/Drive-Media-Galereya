#!/bin/bash
# ============================================================
# DMGA Startup Script
# ============================================================
# Starts both the Next.js app and the API proxy server.
# The proxy bypasses workers.dev blocking in Russia by
# proxying /dmga-api/* requests to the Cloudflare Worker
# from the server side.
# ============================================================

set -e

PROJECT_DIR="/home/z/my-project"
LOG_DIR="/home/z/my-project/logs"
mkdir -p "$LOG_DIR"

echo "Starting DMGA services..."

# ── 1. Start API proxy on port 3001 ──
echo "  Starting API proxy on port 3001..."
cd "$PROJECT_DIR"
node proxy-server.js > "$LOG_DIR/proxy.log" 2>&1 &
PROXY_PID=$!
echo "  Proxy PID: $PROXY_PID"

# Wait for proxy to start
sleep 2
if kill -0 $PROXY_PID 2>/dev/null; then
    echo "  ✓ Proxy running on http://localhost:3001"
else
    echo "  ✗ Proxy failed to start. Check $LOG_DIR/proxy.log"
    exit 1
fi

# ── 2. Start Next.js dev server on port 3000 ──
echo "  Starting Next.js dev server on port 3000..."
cd "$PROJECT_DIR"
node node_modules/.bin/next dev -p 3000 > "$LOG_DIR/next.log" 2>&1 &
NEXT_PID=$!
echo "  Next.js PID: $NEXT_PID"

# Wait for Next.js to start
sleep 8
if kill -0 $NEXT_PID 2>/dev/null; then
    echo "  ✓ Next.js running on http://localhost:3000"
else
    echo "  ✗ Next.js failed to start. Check $LOG_DIR/next.log"
    exit 1
fi

echo ""
echo "========================================="
echo "  DMGA Services Running"
echo "========================================="
echo "  Next.js:     http://localhost:3000"
echo "  API Proxy:   http://localhost:3001"
echo "  Caddy:       http://localhost:81"
echo ""
echo "  API Flow: Browser → Caddy:81/dmga-api/* → Proxy:3001 → Worker"
echo "  App Flow:  Browser → Caddy:81 → Next.js:3000"
echo ""
echo "  Proxy PID:  $PROXY_PID"
echo "  Next PID:   $NEXT_PID"
echo "========================================="

# Write PIDs to file for easy cleanup
echo "$PROXY_PID" > "$LOG_DIR/proxy.pid"
echo "$NEXT_PID" > "$LOG_DIR/next.pid"
