"""Private image storage. Database ownership is checked before every read."""
import re
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
import httpx


class StorageUnavailable(Exception):
    pass


class ImageStorage:
    def __init__(self, settings, transport=None):
        self.local = Path(settings.upload_dir).resolve()
        self.remote = settings.image_storage == "supabase"
        self.url = settings.supabase_url.rstrip("/")
        self.key = settings.supabase_service_role_key.get_secret_value()
        self.bucket = settings.supabase_storage_bucket
        self.transport = transport
        if self.remote:
            parsed = urlsplit(self.url)
            if (parsed.scheme != "https" or not parsed.netloc or parsed.path
                or parsed.query or parsed.fragment or parsed.username or parsed.password
                or not self.key or not re.fullmatch(r"[A-Za-z0-9_-]+", self.bucket)):
                raise ValueError("Supabase image storage requires an HTTPS project URL, service-role key, and valid bucket name")

    def _request(self, method, filename, content=None):
        if not self.url or not self.key:
            raise StorageUnavailable("Configure Supabase Storage credentials on the backend")
        route = "object/authenticated" if method == "GET" else "object"
        try:
            with httpx.Client(transport=self.transport, timeout=30, follow_redirects=False) as client:
                response = client.request(
                    method, f"{self.url}/storage/v1/{route}/{self.bucket}/{filename}",
                    headers={"Authorization": f"Bearer {self.key}", "apikey": self.key,
                             "Content-Type": "image/jpeg", "x-upsert": "false"},
                    content=content,
                )
        except httpx.HTTPError:
            raise StorageUnavailable("Cannot reach Supabase Storage") from None
        missing = response.status_code == 404
        if response.status_code == 400:
            try:
                missing = str(response.json().get("statusCode")) == "404"
            except ValueError:
                pass
        if missing and method in {"GET", "DELETE"}:
            raise FileNotFoundError(filename)
        if not response.is_success:
            # Never expose upstream response bodies, credentials, or signed URLs.
            raise StorageUnavailable(f"Supabase Storage returned HTTP {response.status_code}; check bucket and backend credentials")
        return response.content

    def save(self, jpeg):
        filename = f"{'supabase--' if self.remote else ''}{uuid4()}.jpg"
        if self.remote:
            self._request("POST", filename, jpeg)
        else:
            try:
                self.local.mkdir(parents=True, exist_ok=True)
                (self.local / filename).write_bytes(jpeg)
            except OSError:
                raise StorageUnavailable("Cannot write to the image upload directory") from None
        return filename

    def read(self, filename):
        self._validate(filename)
        # Preserve legacy local references even after switching the default storage.
        if filename.startswith("supabase--"):
            return self._request("GET", filename)
        try:
            return (self.local / filename).read_bytes()
        except FileNotFoundError:
            raise
        except OSError:
            raise StorageUnavailable("Cannot read the image upload directory") from None

    def delete(self, filename):
        self._validate(filename)
        try:
            if filename.startswith("supabase--"):
                self._request("DELETE", filename)
            else:
                (self.local / filename).unlink(missing_ok=True)
        except FileNotFoundError:
            pass

    @staticmethod
    def _validate(filename):
        if not re.fullmatch(r"(?:supabase--)?[0-9a-f-]{36}\.jpg", filename):
            raise FileNotFoundError(filename)
