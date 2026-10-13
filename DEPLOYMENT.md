# Production: Render core API + Vercel frontend + Supabase

The core API in `backend/` has no PyTorch dependency and fits Render's free instance. The CLIP model lives in `ml-service/` and is hosted separately (see [ml-service/README.md](ml-service/README.md)); until it is, uploads and outfit generation return 503 while accounts, wardrobes and saved outfits work.

## 1. Core API on Render

1. In Render, choose **New > Blueprint** and select this repository. Render reads `render.yaml`: web service `outfitly-api`, root directory `backend`, build `pip install -r requirements.txt`, start `python -m app.run`, health check `/health`, `APP_ENV=prod`. Alternatively create a Python web service by hand with the same values.
2. Enter the secret values when prompted:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **Connect > Session pooler** URI |
   | `JWT_SECRET` | Your existing secret, or `python -c "import secrets; print(secrets.token_urlsafe(48))"` for a new install |
   | `FRONTEND_ORIGINS` | `https://YOUR_FRONTEND.vercel.app` (comma-separate several; no paths, no wildcards) |
   | `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (backend only, never in Vercel) |
   | `BUSINESS_RULES_JSON` | Your rules, or the value from `backend/.env.example` |
   | `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | Leave empty until the ML service is hosted |

3. Render injects `PORT`; the backend binds to it automatically. `IMAGE_STORAGE` defaults to Supabase in prod — keep it, because Render's free disk is wiped on every restart.
4. Open `https://YOUR_SERVICE.onrender.com/live` and expect `"environment": "prod"` and `"ml_service": "not configured"`. The startup log line `Outfitly API starting in prod mode` confirms the mode too. `/health` also checks the database connection.

Free Render services sleep when idle, so the first request after a pause takes a while.

## 2. Frontend on Vercel

Root Directory `frontend`, framework preset Vite, build `npm run build`, output `dist`. Environment variables for Production:

```dotenv
APP_ENV=prod
VITE_API_URL=https://YOUR_SERVICE.onrender.com
```

Redeploy after changing either variable; Vite bakes them in at build time. For Preview deployments, add their exact origins to `FRONTEND_ORIGINS` on Render.

## 3. ML service (later)

Host `ml-service/` anywhere that can run its Dockerfile with roughly 1–2 GB RAM. Give it `APP_ENV=prod` and an `ML_SERVICE_TOKEN` of at least 32 characters, then set on Render:

```dotenv
ML_SERVICE_URL=https://YOUR_ML_HOST
ML_SERVICE_TOKEN=THE_SAME_TOKEN
```

`ML_SERVICE_TIMEOUT` (default 90 s) allows for a cold ML host. Verify by uploading a photo and generating an outfit in the app.
