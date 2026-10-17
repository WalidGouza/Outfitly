# Supabase setup and account request troubleshooting

Outfitly uses Supabase as a PostgreSQL database. Registration and login still go through the separately running Python API. This app uses its own `public.users` table and JWT authentication, not Supabase Auth. Database-only setup needs no Supabase JavaScript client or API key. Production photo storage additionally uses a private Supabase Storage bucket and a backend-only service_role key; see [DEPLOYMENT.md](DEPLOYMENT.md).

This page covers local setup and connection troubleshooting. On Render, enter the same values as environment variables instead of using backend/.env.

## Configure the backend

1. Open Supabase **Connect** and select **Session pooler**. Copy the actual URI, including its exact username, host, port, and database. Session-pooler connections support IPv4; direct database connections can require IPv6.
2. Put that URI in **backend/.env**, replacing `DATABASE_URL`. Replace the password placeholder with the database password. Percent-encode reserved password characters (`@`, `#`, `/`, `?`, etc.). Quote the complete value in `.env`. Do not share it.
3. Keep your existing `JWT_SECRET` and `BUSINESS_RULES_JSON`. If `.env` does not yet exist, run `python setup_env.py` from `backend/` first.
4. Keep `FRONTEND_ORIGIN=http://localhost:5173`. For another frontend URL, set `FRONTEND_ORIGINS` to the exact origins, comma-separated. The app allows the matching localhost/127.0.0.1 aliases for a configured local origin.
5. For native diagnostics, run `python diagnose.py` from `backend/` with the virtual environment activated. This reports safe database/configuration checks without printing connection strings or secrets.
6. Start `python -m app.run`. Wait for **Application startup complete**. Open http://127.0.0.1:8000/health and check for `{"status":"ok"}`.

Backend connection setup accepts `postgres://`, `postgresql://`, and `postgresql+psycopg://`; it normalizes to the psycopg driver. Hosted Supabase connections default to `sslmode=require`, while explicitly configured certificate/SSL settings are preserved. Prepared statements are disabled. Transaction-local search paths include `public` and `extensions`, allowing the vector extension to be found in either common location.

Use the database `postgres` role from Supabase Connect for the current development setup. Startup creates the app tables/index, enables RLS on its five tables and revokes every privilege the Supabase Data API roles (`anon`, `authenticated`) get on new tables. No browser Data API policies are created; access goes through FastAPI.

Recommended one-time dashboard settings, since the app never uses the Data API or browser uploads:
- **Storage > wardrobe-images > Edit bucket**: keep it private, set the upload size limit to 10 MB and the allowed MIME types to `image/jpeg` (the backend re-encodes every photo as JPEG).
- **Project Settings > Data API**: remove `public` from the exposed schemas, or turn the Data API off. A separately provisioned least-privilege role requires corresponding schema/migration and RLS arrangements.

## Configure the frontend

Set **frontend/.env** to:

```dotenv
VITE_API_URL=/api
API_PROXY_TARGET=http://127.0.0.1:8000
```

Restart `npm run dev`. Open http://localhost:5173 and create the account from Outfitly. Vite forwards `/api/auth/register` to FastAPI `/auth/register`. Both processes must remain running.

Do not set `VITE_API_URL` to a Supabase project URL or a PostgreSQL connection string. It must be `/api` for the local development proxy or the HTTPS URL of a deployed FastAPI service.

The development proxy is not bundled into a static production build. A deployed frontend must use a real API URL or a reverse proxy configured by the hosting provider. An HTTPS frontend needs an HTTPS API. Rebuild the frontend after changing its production API URL.

## Narrow down “Failed to fetch”

| Observation | Next check |
| --- | --- |
| `/health` does not open | Backend startup output and `python diagnose.py`; registration cannot work until the API starts |
| `diagnose.py` reports credentials rejected | Exact pooler username and database password encoding |
| `diagnose.py` reports host unreachable | Session-pooler URI, Supabase project status, network restrictions |
| Health is OK, but registration fails | Frontend `.env`, restarted Vite, browser Network request URL and response |
| Frontend shows non-JSON/proxy error | API process/port, proxy target, stale Vite process |
| Direct API URL is used | Exact CORS origin, HTTP/HTTPS compatibility, API reachability from the browser's device |
| Database request returns HTTP 503 | Database connection and schema permissions; this now has a JSON error instead of a bare fetch message |

Without the backend startup error and request details, the specific cause in your environment cannot be confirmed. If you still need help, share the safe `diagnose.py` output and the browser's failed request URL/status. Omit passwords, JWTs, database URIs, and API keys.

Official references:
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://vite.dev/config/server-options#server-proxy
- https://vite.dev/guide/env-and-mode
