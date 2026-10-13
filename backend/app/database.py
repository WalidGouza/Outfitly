"""PostgreSQL connection setup, including Supabase session-pooler URLs."""

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url


def database_url(raw: str):
    value = raw.strip()
    if value.startswith("postgres://"):
        value = "postgresql+psycopg://" + value[len("postgres://") :]
    elif value.startswith("postgresql://"):
        value = "postgresql+psycopg://" + value[len("postgresql://") :]
    try:
        url = make_url(value)
    except Exception as exc:
        raise ValueError(
            "DATABASE_URL must be a PostgreSQL connection URI from Supabase Connect, not its HTTPS project URL."
        ) from exc
    if url.drivername != "postgresql+psycopg" or not url.host or not url.database:
        raise ValueError(
            "Use a postgresql+psycopg:// connection URI in backend/.env. Supabase project URLs and API keys cannot be used as database connections."
        )
    if is_supabase(url.host) and "sslmode" not in url.query:
        url = url.update_query_dict({"sslmode": "require"})
    return url


def is_supabase(host: str):
    return host.endswith(".supabase.co") or host.endswith(".supabase.com")


def make_engine(raw: str):
    url = database_url(raw)
    engine = create_engine(
        url,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"connect_timeout": 10, "prepare_threshold": None},
    )

    @event.listens_for(engine, "begin")
    def vector_search_path(connection):
        # SET LOCAL is scoped to each transaction, rather than relying on
        # session state that a pooler could discard.
        connection.exec_driver_sql("SET LOCAL search_path TO public, extensions")

    return engine
