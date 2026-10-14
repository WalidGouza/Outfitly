# Production: Render core API + Vercel frontend + Supabase

The core API in `backend/` has no PyTorch dependency and fits Render's free instance. The CLIP model lives in `ml-service/` and runs on Modal (section 3); until it is set up, uploads and outfit generation return 503 while accounts, wardrobes and saved outfits work.

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

## 3. ML service on Modal

Deploy `ml-service/` with `modal deploy modal_app.py`, following the step-by-step guide in [ml-service/README.md](ml-service/README.md#hosting-on-modal). Then set on Render:

```dotenv
ML_SERVICE_URL=https://YOUR_WORKSPACE--outfitly-ml-web.modal.run
ML_SERVICE_TOKEN=THE_SAME_TOKEN
```

`ML_SERVICE_TIMEOUT` (default 90 s) allows for a host that scales to zero and has to cold-start. Verify by uploading a photo and generating an outfit in the app.

## 4. CI/CD with GitHub Actions

`.github/workflows/ci-cd.yml` runs on every push and pull request:

| Job | What it checks |
|---|---|
| Backend tests | Unit tests plus PostgreSQL/pgvector integration tests against a throwaway database; the Docker image builds |
| ML service tests | API tests with a stub model (no PyTorch); `modal_app.py` loads |
| Frontend tests and build | `npm test` and a production build |

On pushes to `main`, after all three pass:

- **ML service** is deployed to Modal (`modal deploy`) when `ml-service/` changed.
- **Frontend** is built and deployed to Vercel production when `frontend/` changed. Pull requests still get Vercel preview deployments from Vercel's Git integration; `frontend/vercel.json` only turns off its automatic production deploys from `main`.
- **Backend**: Render deploys by itself once the workflow's checks pass (`autoDeployTrigger: checksPass` in `render.yaml`), so a failing test never reaches production.

Run the workflow manually (Actions > CI/CD > Run workflow) to redeploy everything.

### One-time setup

1. In GitHub, open **Settings > Environments**, create an environment named `production`, and add these secrets to it. Optionally add yourself as a required reviewer to approve each deploy.

   | Secret | Where to get it |
   |---|---|
   | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Modal dashboard > Settings > API Tokens > New token |
   | `VERCEL_TOKEN` | Vercel > Account Settings > Tokens |
   | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Run `npx vercel link` in the repository root and pick the existing project; the IDs are in `.vercel/project.json` (git-ignored) |

   Optional: add an environment **variable** `ML_SERVICE_URL` (your `.modal.run` URL) to smoke-test the ML service after each deploy.
2. In Render, if the service was not created from `render.yaml`, open the service's **Settings > Build & Deploy > Auto-Deploy** and choose **After CI Checks Pass**.
3. Protect `main` (Settings > Branches > Add rule): require the three test jobs to pass before merging pull requests.
