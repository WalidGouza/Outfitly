"""Create a local private .env without overwriting existing configuration."""

from pathlib import Path
import secrets

path = Path(".env")
if path.exists():
    print("Existing .env preserved.")
else:
    template = Path(".env.example").read_text()
    template = template.replace(
        "replace-with-a-random-secret-of-at-least-32-characters",
        secrets.token_urlsafe(48),
    )
    path.write_text(template)
    path.chmod(0o600)
    print(
        "Created backend .env. Review database connection and matching rules before running."
    )
