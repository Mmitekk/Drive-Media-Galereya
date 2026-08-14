---
Task ID: 1
Agent: main
Task: Fix auth error - workers.dev blocked in Russia

Work Log:
- Diagnosed the issue: Cloudflare Workers domain `workers.dev` is blocked in Russia
- Verified Worker API is healthy (responds 200 from non-RU server)
- Confirmed CORS headers are correct (`Access-Control-Allow-Origin: *`)
- Changed WORKER_URL from `https://dmga-api.galinakostrik2023.workers.dev` to `/dmga-api` (relative path)
- Created standalone proxy server (proxy-server.js) on port 3001
- Updated Caddyfile with `/dmga-api/*` route → proxy on port 3001
- Created startup script (start.sh) for both services
- Rebuilt Next.js static export — verified no `workers.dev` in output
- Updated both config.ts and worker-api.ts with new WORKER_URL
- Updated setup-guide.tsx example

Stage Summary:
- Root cause: `workers.dev` domain is blocked in Russia (RKN blocking)
- Solution: Server-side proxy bypasses the block
- Browser → Caddy:81/dmga-api/* → proxy:3001 → Worker (workers.dev)
- All code changes committed, build successful
- Deployment requires: updated Caddyfile + proxy-server.js running
