# RentGuard NYC

AI-powered NYC rental copilot. Helps renters avoid bad apartments by analyzing listings, buildings, landlords, and leases against NYC public records and tenant law.

This repository follows the phased plan in `RENTGUARD_ROADMAP_v6.md` (kept outside the repo). The current commit implements **Phase 1.1 — Backend scaffold (Hono on Render)**.

## Layout

```
RentGuardAI/
├── backend/        # Hono.js API on Render free tier
│   ├── src/        # app, server, logger, middleware
│   └── test/       # vitest smoke tests
├── render.yaml     # Render service definition
└── README.md
```

A `frontend/` (Next.js on Vercel) will land in a later phase.

## Backend — local development

Requires Node 20+.

```sh
cd backend
cp .env.example .env
npm install
npm run dev          # tsx watch on http://localhost:8080
```

Verify the health endpoint:

```sh
curl -s http://localhost:8080/health
# → {"status":"ok","commit":"<git sha>"}
```

Run the test suite:

```sh
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

## Deployment (Render free tier)

The `render.yaml` blueprint at the repo root provisions a single web service named `rentguard-backend` from `backend/`. Render injects `RENDER_GIT_COMMIT`, which the backend reports via `/health`.

To wire it up:

1. In the Render dashboard, choose **New → Blueprint** and point at this repo.
2. Render reads `render.yaml` and creates the service.
3. After the first deploy, hit `https://<your-service>.onrender.com/health` — expect a 200 with the deployed commit SHA. The free tier spins down when idle, so the first request after a quiet period takes ~30 seconds; subsequent requests are fast.

Frontends should retry the first call once on cold start.

## Phase 1.1 acceptance checklist

- [x] `npm test` passes (smoke test for `/health`)
- [x] Logs are JSON-structured with a `requestId` per request (method, path, status, durationMs)
- [x] Render blueprint provisions the service and wires the health check
- [ ] `curl <render-url>/health` returns 200 — pending first deploy by the operator (Render account access required)

The last item requires the repo owner to connect Render to this GitHub repo; everything else is verified locally and committed.
