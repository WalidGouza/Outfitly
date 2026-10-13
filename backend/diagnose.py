"""Run from backend/: reports safe startup diagnostics, without printing secrets."""

from sqlalchemy import text
from app.config import settings
from app.database import make_engine


def main():
    try:
        config = settings()
        engine = make_engine(config.database_url)
    except Exception:
        print(
            "FAIL: configuration invalid. Check DATABASE_URL, JWT_SECRET, BUSINESS_RULES_JSON, and FRONTEND_ORIGINS in backend/.env. No secrets were printed."
        )
        return 1
    print("OK: backend .env parsed and matching rules validated.")
    print("OK: explicit frontend CORS origins configured.")
    print("INFO: these checks do not test image storage or download/run the CLIP model. Verify an authenticated upload separately.")
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            version = conn.scalar(
                text("SELECT extversion FROM pg_extension WHERE extname='vector'")
            )
            count = conn.scalar(
                text(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','wardrobes','clothes','outfits')"
                )
            )
            print("OK: PostgreSQL connection established.")
            print(
                "OK: vector extension installed."
                if version
                else "ACTION: enable the vector extension in Supabase Database > Extensions, or let FastAPI startup install it."
            )
            print(
                "OK: application tables exist."
                if count == 4
                else "ACTION: start FastAPI to create the application tables."
            )
            print(
                "Next: start uvicorn and open http://127.0.0.1:8000/health before trying registration."
            )
        return 0
    except Exception as exc:
        message = str(exc).lower()
        if "password authentication failed" in message:
            print(
                "FAIL: PostgreSQL rejected the credentials. Copy the exact session-pooler username and percent-encode reserved characters in the database password."
            )
        elif any(
            x in message
            for x in (
                "network is unreachable",
                "could not translate host",
                "timeout expired",
                "connection refused",
            )
        ):
            print(
                "FAIL: database host is unreachable. Check the Supabase session-pooler URI (port 5432), network restrictions, project status, and connectivity."
            )
        elif "ssl" in message:
            print(
                "FAIL: SSL negotiation failed. Review Supabase SSL and certificate settings."
            )
        else:
            print(
                "FAIL: database connection/query failed. Review PostgreSQL connection settings and database privileges. No connection URI or secret was printed."
            )
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
