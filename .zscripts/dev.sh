#!/bin/bash
# Custom dev script for DMGA project
# Starts combined server: static files + API proxy on port 3000
# No need to modify Caddy — it already proxies :81 → :3000
#
# This is called by /start.sh at container boot.

set -e

PROJECT_DIR="/home/z/my-project"
cd "$PROJECT_DIR"

echo "[DEV] Starting DMGA combined server (static + API proxy) on port 3000..."
echo "[DEV]   /dmga-api/* → proxy → Cloudflare Worker"
echo "[DEV]   everything  → static files from /out/"

exec node combined-server.js
