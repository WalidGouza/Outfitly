# Production: Vercel frontend + PC backend + Cloudflare Tunnel

Use Docker for the PC backend. It isolates Python/PyTorch dependencies, retains the downloaded CLIP model, and runs the backend and tunnel as restartable services. The frontend stays on Vercel; PostgreSQL/pgvector and private photos stay in Supabase. Docker does not reduce CLIP's memory requirement. The earlier 512 MB instance ran out of memory; peak memory for your PC has not been measured. Watch a real upload with `docker stats`.

## Cloudflare hostname prerequisite

A stable remotely-managed tunnel requires a domain added to Cloudflare. You must be able to configure its DNS/nameservers as Cloudflare requires. A DNSExit subdomain such as outfitly.linkpc.net is not automatically a domain you can transfer to Cloudflare. This project does not assume that you control linkpc.net or that DNSExit permits delegation of your subdomain. I cannot confirm that outfitly.linkpc.net can be used as the published Cloudflare hostname.

Use a domain you control on Cloudflare, with an API hostname such as api.yourdomain.com. Cloudflare terminates public HTTPS and connects to the backend over its outbound tunnel. No Caddy, manual server SSL certificate, public host port, or router port forwarding is required by this configuration.

If you do not have an eligible domain yet, see Temporary testing below. A Quick Tunnel is not a stable production hostname.

## 1. Prepare the PC

Install current Docker Engine + Compose v2 on Linux, or Docker Desktop using Linux containers on Windows/macOS. Docker and the computer must stay running, with sleep disabled while serving the app. Outbound access to Supabase, Hugging Face, and Cloudflare is required. A restrictive network must allow the tunnel's outbound connections (Cloudflare documents port 7844).

Extract the project into your existing deployment folder. Keep your existing backend secrets, database URL, JWT secret, and photo-storage credentials. Do not put backend or tunnel secrets in Vercel or commit them.

Create these private files from the supplied templates:

```bash
cp .env.example .env
cp tunnel.env.example tunnel.env
```

If backend/.env does not already exist:

```bash
cp backend/.env.example backend/.env
```

PowerShell also supports `cp`. Change the root .env to:

```dotenv
APP_ENV=prod
COMPOSE_PROFILES=${APP_ENV}
```

The second line derives the Docker profile from APP_ENV. Keep it exactly as shown. The same `docker compose up` command selects the matching services automatically. Set APP_ENV to dev or prod only. When switching modes, stop the current stack before changing APP_ENV; otherwise an old service may remain running.

In backend/.env, retain the actual secret values and configure:

```dotenv
DATABASE_URL=YOUR_EXISTING_SUPABASE_SESSION_POOLER_URI
JWT_SECRET=YOUR_EXISTING_STRONG_SECRET
FRONTEND_ORIGINS=https://YOUR_FRONTEND.vercel.app
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_EXISTING_LEGACY_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=wardrobe-images
BUSINESS_RULES_JSON=YOUR_EXISTING_RULES_JSON
```

These are placeholders, not usable credentials. Keep the private Supabase bucket you already created. The mode is passed from the root .env to the Docker backend and overrides any APP_ENV left in backend/.env. In production, IMAGE_STORAGE defaults to supabase; remove an old IMAGE_STORAGE=local line if you want this default. Explicit IMAGE_STORAGE=local remains supported through the persistent uploads volume, but existing supabase-- image references still require Supabase credentials.

For a brand-new installation, generate JWT_SECRET with `python -c "import secrets; print(secrets.token_urlsafe(48))"` on a computer with Python, and copy the BUSINESS_RULES_JSON from backend/.env.example. For upgrades, preserve the existing JWT secret. Compose .env files support quoting: single-quote secret values containing literal dollar signs so they are not interpolated. Never share expanded `docker compose config` output; it may contain secrets.

## 2. Create the Cloudflare Tunnel

In the Cloudflare dashboard, open Networking > Tunnels (older dashboard layouts may list Tunnels under Zero Trust). Create a remotely-managed cloudflared tunnel and choose Docker under connector setup.

Copy only the connector token into tunnel.env:

```dotenv
TUNNEL_TOKEN=YOUR_TUNNEL_CONNECTOR_TOKEN
```

This is the tunnel connector token, not a general Cloudflare account API token. The Compose cloudflared service uses it at runtime.

Start from the project root:

```bash
docker compose up -d --build
docker compose logs -f backend cloudflared
```

The backend must become healthy before the connector starts. Create a Published application route in Cloudflare:

| Setting | Value |
|---|---|
| Public hostname | api.yourdomain.com, on your Cloudflare-managed domain |
| Service type | HTTP |
| Service URL | backend:8000 |

If the dashboard accepts a complete URL, enter http://backend:8000. Do not enter localhost:8000: inside cloudflared, localhost is the connector container. Both containers share the Compose network, where backend is the API service name.

Cloudflare's tunnel provides the public HTTPS connection. The backend has no published host ports in prod. The legacy Compose project name is retained to preserve existing upload and model-cache volumes.

## 3. Deploy the frontend in Vercel

Set Vercel's Root Directory to frontend, framework preset Vite, Build Command npm run build, and Output Directory dist. Configure these Vercel environment variables for Production:

```dotenv
APP_ENV=prod
VITE_API_URL=https://api.yourdomain.com
```

Use the real route hostname configured in Cloudflare. Update backend FRONTEND_ORIGINS to the real Vercel frontend origin, including https:// but no path. If you use Vercel Preview deployments, configure their environment variables and authorize their exact frontend origins separately; wildcard CORS is not enabled.

Redeploy Vercel after changing either variable. Vite incorporates configuration during the build, so changing a variable does not update an already-built frontend.

## 4. Verify

Check backend settings inside the running container:

```bash
docker compose exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/live').read().decode())"
```

Expect environment prod and service outfitly-api. From another network, open https://YOUR_API_HOST/live and /health. Sign in through the Vercel app, upload a photo, generate an outfit, and save it. Health checks do not load or test CLIP. The first image upload downloads/initializes the model; watch logs and Docker memory usage.

Restart the stack and verify the photo still loads. Keep the model_cache, backend_uploads, and Supabase data. `docker compose down` preserves named volumes; `down -v` deletes local uploads and the model cache. Back up local photos if using local storage.

## Switching to dev

While still in prod, run docker compose down. Set APP_ENV=dev in the root .env and keep COMPOSE_PROFILES=${APP_ENV}. Follow DEVELOPMENT.md. Dev starts only backend-dev, publishes port 8000 on host loopback, mounts backend/app for reload, and enables API docs/debugging. The Cloudflare connector does not start in dev. Set backend FRONTEND_ORIGINS=http://localhost:5173 when switching to local development; the alias 127.0.0.1 is added only in dev. Database credentials and scoring rules remain explicit configuration.

## Temporary testing without a Cloudflare-managed domain

Keep APP_ENV=prod so that a publicly exposed test API has production error/CORS settings. Start only the backend:

```bash
docker compose up -d --build backend
docker run --rm --network atelier-server_default cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://backend:8000
```

A Quick Tunnel prints a temporary HTTPS trycloudflare.com URL. Use that URL as VITE_API_URL in Vercel and redeploy. Keep the tunnel process running. Its hostname changes when a new Quick Tunnel starts; it is for temporary testing, not permanent hosting. You still need a tunnel.env file from the template for Compose configuration, but its placeholder token is not used when starting only backend.

## Upgrade and limitations

Stop any previously started Caddy or manually-created cloudflared container before switching to the new stack. The old Caddy/port-forwarding files have been removed from this package. Source includes a Dockerfile and env-mode policies; it has not been deployed to your PC or Cloudflare account by this environment. Docker Engine is unavailable here, so image builds, live token/route configuration, runtime resource usage, and end-to-end upload durability remain unverified.

References:
- https://developers.cloudflare.com/tunnel/get-started/
- https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- https://v6.vite.dev/guide/env-and-mode
