# Local development

Needs Node 22.18+ and either Docker with Compose v2 or Python 3.12+. Dev uses the database and business-rule settings you supply; APP_ENV does not provision a database or create secrets.

## Backend

Create `backend/.env` from `backend/.env.example` (or run `python setup_env.py` from `backend/`, which also generates a JWT secret). Set `APP_ENV=dev`, `DATABASE_URL` to your Supabase session-pooler URI, and `FRONTEND_ORIGINS=http://localhost:5173`. Keep `BUSINESS_RULES_JSON` from the example or your existing rules. In dev, new photos are stored in the local `uploads/` folder; keep the Supabase credentials if you need to read existing remote photos.

With Docker, create the root `.env` from `.env.example` and run:

```bash
docker compose up -d --build
```

Without Docker, from `backend/` in a virtual environment:

```bash
pip install -r requirements.txt
python -m app.run
```

Open http://localhost:8000/live and expect `"environment": "dev"`. API docs are at http://localhost:8000/docs, and Uvicorn reloads on source changes. `python diagnose.py` from `backend/` checks configuration and the database connection without printing secrets.

## ML service (optional)

The backend runs without it; uploads and outfit generation then return 503. To run CLIP locally:

1. Create `ml-service/.env` from its template and set the same `ML_SERVICE_TOKEN` in `backend/.env`.
2. In `backend/.env` set `ML_SERVICE_URL=http://ml-service:8001` (Docker) or `http://127.0.0.1:8001` (native).
3. Docker: uncomment `COMPOSE_PROFILES=ml` in the root `.env` and rerun `docker compose up -d --build`. Native: see [ml-service/README.md](ml-service/README.md).

The first upload downloads the CLIP model (~600 MB).

## Frontend

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `API_PROXY_TARGET` (http://127.0.0.1:8000), removing the `/api` prefix. Restart Vite after `.env` changes.

## Integration tests

`compose.devdb.yaml` starts a local pgvector PostgreSQL on 127.0.0.1:5432 (`docker compose -f compose.devdb.yaml up -d`). Create a database whose name ends in `_test` and set `TEST_DATABASE_URL` to it before running `python -m pytest tests -q` from `backend/`; the integration tests drop and recreate their tables.
