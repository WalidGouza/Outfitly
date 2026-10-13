# Current verification — 2026-10-13

The supported deployment is Vercel frontend + Docker backend on the PC + remotely-managed Cloudflare Tunnel, with Supabase PostgreSQL/pgvector and private Storage.

- Backend: 45 tests passed, 2 PostgreSQL integration tests skipped. Mode tests cover dev/prod defaults, localhost aliases, HTTPS-only production CORS, invalid modes/origins, disabled production API docs/debugging, and Uvicorn worker/reload settings.
- Frontend: 15 tests passed. Production build with a test HTTPS API hostname passed; dev build with /api passed. Missing production API URLs and unknown APP_ENV values correctly block builds. URL-policy tests cover HTTPS, loopback, query, and fragment rejection.
- Compose: the official standalone Docker Compose CLI validated the actual dev/prod profile selection, APP_ENV propagation, and production port isolation using dummy env files. Static YAML checks additionally cover mode profiles, source/cache/upload mounts, no prod host port exposure, dev loopback binding, tunnel command, and health-dependent startup. The root mode selector derives COMPOSE_PROFILES from APP_ENV.
- Old SELF_HOSTING, Caddy, API_DOMAIN, compose.backend, and Render deployment files were removed. Private .env and tunnel.env files are excluded from the archive.

Docker image build/container execution has not been verified: Docker Engine is unavailable in this environment. No connection was made to the user's Cloudflare or Supabase account. Live tunnel token/hostname setup, model inference and peak RAM, public upload/generation/save behavior, and restart durability must be checked on the user's PC. Browser visual QA was not run for this deployment/configuration update. The real PostgreSQL integration tests require a dedicated _test database.

The test runner emits a Starlette httpx TestClient deprecation warning, and frontend hook tests emit react-test-renderer deprecation notices; neither caused failures.
