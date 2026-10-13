# Outfitly

Outfitly organizes uploaded clothes into multiple wardrobes, matches outfits using CLIP embeddings in pgvector plus color/texture rules, and lets users save looks. The React/Vite frontend and Python/FastAPI backend run separately.

## Production deployment

Use **Vercel for the frontend** and **Docker on your PC for the backend**, connected through a remotely-managed **Cloudflare Tunnel**. Supabase stores the database and private photos. Follow [DEPLOYMENT.md](DEPLOYMENT.md).

Docker is the chosen hosting method because it isolates the Python/CLIP environment and preserves model downloads in a volume. The old Caddy, port-forwarding, Render deployment guide, and API_DOMAIN configuration have been removed.

## Development

Follow [DEVELOPMENT.md](DEVELOPMENT.md). Set `APP_ENV=dev` in the root Docker .env; set it to `prod` for the backend/tunnel production stack. In Vercel, set `APP_ENV=prod` separately. The same selector is used by the backend and frontend, but each deployment must receive its own value.

`COMPOSE_PROFILES=${APP_ENV}` in the root .env derives the Docker services automatically. Keep the supplied line. Dev mode enables local proxying, reload, and API docs. Prod mode validates HTTPS configuration, disables API docs/debugging, and uses private Supabase photo storage by default. See the mode table in DEVELOPMENT.md.

No secrets or actual .env files are packaged. Keep your existing DATABASE_URL, JWT_SECRET, BUSINESS_RULES_JSON, and Supabase keys. Runtime secrets belong on the PC; Vercel needs only APP_ENV and the public VITE_API_URL. Mode changes do not register a domain, configure Cloudflare routes, or provision Supabase.

## Checks

Frontend: `npm test` and `APP_ENV=prod VITE_API_URL=https://api.example.com npm run build` from frontend/. Replace the example API hostname with the real tunnel URL before deployment. Backend: `python -m pytest tests -q` from backend/ with a virtual environment and requirements installed. Real database integration tests require a dedicated _test PostgreSQL database; see tests/test_integration.py.

The Light/Dark/System appearance preference, multiple wardrobes, upload categories, generated outfits, and saved looks remain supported. Matching rules stay in private BUSINESS_RULES_JSON. Demo wardrobes use local illustrated pieces and do not run CLIP/pgvector.

The optional compose.devdb.yaml is only for local database development/testing. The main compose.yaml runs the chosen Docker backend/tunnel architecture. Existing browser keys and the legacy Docker project/volume identifiers are preserved for upgrade compatibility.
