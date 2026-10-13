import os
from pathlib import Path

os.environ["DATABASE_URL"] = (
    "postgresql+psycopg://atelier:atelier@localhost:5432/atelier"
)
os.environ["JWT_SECRET"] = "a-test-only-secret-not-for-production-123456"
os.environ["BUSINESS_RULES_JSON"] = (
    Path(".env.example").read_text().split("BUSINESS_RULES_JSON=", 1)[1].strip()
)
os.environ["FRONTEND_ORIGIN"] = "http://localhost:5173"
os.environ["FRONTEND_ORIGINS"] = ""
