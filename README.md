# Outfitly

Outfitly organizes uploaded clothes into multiple wardrobes, matches outfits using CLIP embeddings in pgvector plus color/texture rules, and lets users save looks.

## Architecture

| Part | Folder | Hosting |
|---|---|---|
| Frontend (React/Vite) | `frontend/` | Vercel |
| Mobile app (Expo / React Native) | `mobile/` | Expo Go for testing — see [mobile/README.md](mobile/README.md) |
| Core API: accounts, wardrobes, outfits, matching, photo storage | `backend/` | Render (free tier, no PyTorch) |
| ML service: CLIP image/text embeddings (PyTorch) | `ml-service/` | Modal (serverless, scales to zero, $30/month free credit) — see [ml-service/README.md](ml-service/README.md#hosting-on-modal) |
| PostgreSQL/pgvector + private photos | – | Supabase |

The core API calls the ML service over HTTP with a shared `ML_SERVICE_TOKEN`. Until `ML_SERVICE_URL` is configured, sign-up, login, wardrobes and saved outfits work normally; photo uploads and outfit generation return a clear 503.

- Production: [DEPLOYMENT.md](DEPLOYMENT.md)
- Local development: [DEVELOPMENT.md](DEVELOPMENT.md)
- Database connection troubleshooting: [SUPABASE_SETUP.md](SUPABASE_SETUP.md)

## APP_ENV

Every part reads `APP_ENV`, which must be `dev` or `prod` (case, surrounding quotes and whitespace are ignored; anything else is rejected at startup instead of silently falling back to dev). Each deployment gets its own value: Render and Vercel `prod`, your machine `dev`.

| Setting | dev | prod |
|---|---|---|
| API docs/debug | Enabled | Disabled |
| Uvicorn | One worker, reload | One worker, no reload |
| Default image storage | Local `uploads/` folder | Private Supabase Storage |
| CORS | Explicit HTTP/HTTPS origins, localhost aliases | Explicit HTTPS origins, localhost rejected |
| Frontend API URL | `/api` Vite proxy | Public HTTPS URL required |
| ML model loading | On first request | At startup |

`backend/.env` and `ml-service/.env` are found from any working directory; real environment variables (Render dashboard, Docker) override them. No secrets or real .env files are committed.

## Checks

- Frontend, from `frontend/`: `npm test` and `APP_ENV=prod VITE_API_URL=https://api.example.com npm run build`.
- Backend and ML service, from each folder: `python -m pytest tests -q`. Neither needs PyTorch for tests. Real database integration tests need a dedicated `_test` PostgreSQL database; see `backend/tests/test_integration.py`.
