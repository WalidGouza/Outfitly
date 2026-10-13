# Outfitly

Outfitly organizes uploaded clothes into multiple wardrobes, matches outfits using CLIP embeddings in pgvector plus color/texture rules, and lets users save looks. The React/Vite frontend and Python/FastAPI backend run separately.

## Architecture

| Part | Folder | Hosting |
|---|---|---|
| Frontend (React/Vite) | `frontend/` | Vercel |
| Core API: accounts, wardrobes, outfits, matching, photo storage | `backend/` | Render (free tier, no PyTorch) |
| ML service: CLIP image/text embeddings (PyTorch) | `ml-service/` | Not decided yet — see [ml-service/README.md](ml-service/README.md) |
| PostgreSQL/pgvector + private photos | – | Supabase |

The core API calls the ML service over HTTP with a shared `ML_SERVICE_TOKEN`. Until `ML_SERVICE_URL` is configured, sign-up, login, wardrobes and saved outfits work normally; photo uploads and outfit generation return a clear 503.

## Production deployment

Follow [DEPLOYMENT.md](DEPLOYMENT.md): Render for the core API (`render.yaml` blueprint), Vercel for the frontend. Docker on a PC with a Cloudflare Tunnel remains documented as an alternative.

## Development

Follow [DEVELOPMENT.md](DEVELOPMENT.md). `APP_ENV` is required by the backend and ML service and must be `dev` or `prod` (case and surrounding quotes/whitespace are ignored; anything else is rejected at startup rather than silently falling back to dev). `backend/.env` is found from any working directory, and real environment variables (Render dashboard, Docker) override it. Set `APP_ENV=dev` in the root Docker .env; set it to `prod` for the backend/tunnel production stack. In Vercel, set `APP_ENV=prod` separately. The same selector is used by the backend and frontend, but each deployment must receive its own value.

`COMPOSE_PROFILES=${APP_ENV}` in the root .env derives the Docker services automatically. Keep the supplied line. Dev mode enables local proxying, reload, and API docs. Prod mode validates HTTPS configuration, disables API docs/debugging, and uses private Supabase photo storage by default. See the mode table in DEVELOPMENT.md.

No secrets or actual .env files are packaged. Keep your existing DATABASE_URL, JWT_SECRET, BUSINESS_RULES_JSON, and Supabase keys. Runtime secrets belong on the PC; Vercel needs only APP_ENV and the public VITE_API_URL. Mode changes do not register a domain, configure Cloudflare routes, or provision Supabase.

## Checks

Frontend: `npm test` and `APP_ENV=prod VITE_API_URL=https://api.example.com npm run build` from frontend/. Replace the example API hostname with the real tunnel URL before deployment. Backend: `python -m pytest tests -q` from backend/ (and the same from ml-service/; neither needs PyTorch for tests) with a virtual environment and requirements installed. Real database integration tests require a dedicated _test PostgreSQL database; see tests/test_integration.py.

The Light/Dark/System appearance preference, multiple wardrobes, upload categories, generated outfits, and saved looks remain supported. Matching rules stay in private BUSINESS_RULES_JSON. Demo wardrobes use local illustrated pieces and do not run CLIP/pgvector.

The optional compose.devdb.yaml is only for local database development/testing. The main compose.yaml runs the chosen Docker backend/tunnel architecture. Existing browser keys and the legacy Docker project/volume identifiers are preserved for upgrade compatibility.
