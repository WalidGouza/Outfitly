# Development mode

Install Docker with Compose v2 and Node 22.18 or newer. Dev uses the same database and business-rule settings you supply; APP_ENV does not provision a database or create secrets.

Create root .env, backend/.env, and tunnel.env from their .example templates. Keep tunnel.env's placeholder in dev; no connector starts. In the root .env:

```dotenv
APP_ENV=dev
COMPOSE_PROFILES=${APP_ENV}
```

Set backend DATABASE_URL to your Supabase session-pooler URI and JWT_SECRET to a strong value. Keep BUSINESS_RULES_JSON from the example or your existing rules. Set FRONTEND_ORIGINS=http://localhost:5173. Localhost and 127.0.0.1 are aliases in dev. New photos default to persistent local Docker storage in dev; keep Supabase credentials if reading existing remote photos.

The backend runs without the ML service; uploads and outfit generation then return 503. To run CLIP locally, create ml-service/.env from its template with the same `ML_SERVICE_TOKEN` as backend/.env, set `ML_SERVICE_URL=http://ml-service:8001` in backend/.env (or `http://127.0.0.1:8001` for a native run), and use `COMPOSE_PROFILES=${APP_ENV},ml` in the root .env.

Start the backend:

```bash
docker compose up -d --build
docker compose logs -f backend-dev
```

Open http://localhost:8000/live and expect environment dev. The backend source folder is mounted read-only into the container; changing source files triggers Uvicorn reload. API documentation is available at http://localhost:8000/docs.

In another terminal:

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

The frontend .env uses APP_ENV=dev, VITE_API_URL=/api, and API_PROXY_TARGET=http://127.0.0.1:8000. Open http://localhost:5173. Vite proxies /api to the backend, removing /api before forwarding. Production builds require APP_ENV=prod and an explicit public HTTPS VITE_API_URL.

For backend source checks outside Docker, install backend/requirements.txt in a Python 3.12+ virtual environment. `python -m app.run` reads backend/.env from any working directory; APP_ENV is required and real environment variables override the file. Python tests for backend/ and ml-service/ do not need PyTorch. Docker remains the recommended hosting method.

The optional compose.devdb.yaml is retained for local PostgreSQL integration tests and native development. It runs the legacy local database on loopback; it is not part of the production stack. A Docker backend cannot use localhost to address a separate host database, so use the documented Supabase connection for the recommended stack.

| Setting | dev | prod |
|---|---|---|
| API docs/debug | Enabled | Disabled |
| Uvicorn | One worker, reload | One worker, no reload |
| Default image storage | Persistent local volume | Private Supabase Storage |
| CORS | Explicit HTTP/HTTPS origins, localhost aliases | Explicit HTTPS origins, localhost rejected |
| Frontend API default | /api Vite proxy | Public HTTPS URL required |
| Compose services | backend-dev | backend + cloudflared |
| Host API port | 127.0.0.1:8000 | None published |

To change modes, run docker compose down before editing the root APP_ENV, update origins as required, and run docker compose up -d --build. Restart Vite after local .env changes. Redeploy Vercel after production frontend env changes.
