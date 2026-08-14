#!/bin/bash
# Simple supervisor: restart combined-server.js if it dies
while true; do
  cd /home/z/my-project
  node combined-server.js
  echo "[supervisor] Server exited with code $?, restarting in 3s..."
  sleep 3
done
