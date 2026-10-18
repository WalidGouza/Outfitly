"""Abuse protection: attempt limits on passwords, and a size cap on every request.

Attempt limits (sliding windows, in this process's memory):

* wrong password, per email and connection   5 per 15 min   (guessing one account)
* wrong password, per email, any connection  20 per 15 min  (guessing it from many addresses)
* sign-in and sign-up requests, per address  60 per 15 min  (trying many accounts / flooding)
* new accounts, per address                   5 per hour
* wrong current password while signed in     10 per 15 min per account (password change, deletion)
* weather (outfit of the day)                 30 per 15 min per address signed out, 60 per account
* photos analysed or added                    150 a day per account (each one costs ML credits)
* profile photos                              20 a day per account

Limits are checked before the password hash runs, so a flood of attempts can't tie up the CPU
either. The counters live in memory: right for the single Render instance; with several
instances they would move to a shared store (Postgres or Redis).

Request size: bodies over MAX_UPLOAD (photo uploads) or MAX_BODY (everything else) are refused
with 413 before they're read, from Content-Length, or as soon as a body without one goes over.
"""
import math
import threading
import time
from collections import deque
from fastapi import HTTPException
from starlette.responses import JSONResponse

WINDOW = 15 * 60
DAY = 24 * 60 * 60
LIMITS = {
    "login-fail": (5, WINDOW),
    "email-fail": (20, WINDOW),
    "auth": (60, WINDOW),
    "register": (5, 60 * 60),
    "password-fail": (10, WINDOW),
    "weather-public": (30, WINDOW),
    "weather": (60, WINDOW),
    "photos": (150, DAY),
    "avatar": (20, DAY),
}
# What the user is told when a limit is reached; {wait} reads "15 minutes" or "3 hours".
MESSAGES = {
    "photos": "You’ve reached today’s limit of {limit} photos. You can add more in {wait}.",
    "avatar": "You’ve changed your profile photo a lot today. Try again in {wait}.",
    "weather-public": "Too many weather requests. Try again in {wait}.",
    "weather": "Too many weather requests. Try again in {wait}.",
}
DEFAULT_MESSAGE = "Too many attempts. Try again in {wait}."


def human_wait(seconds):
    if seconds >= 2 * 60 * 60:
        hours = math.ceil(seconds / 3600)
        return f"{hours} hours"
    minutes = max(1, math.ceil(seconds / 60))
    return f"{minutes} minute{'s' if minutes > 1 else ''}"
MAX_TRACKED = 50_000  # keys kept; the oldest go first, so memory stays bounded under a flood


class Limiter:
    def __init__(self, limits=LIMITS, clock=time.monotonic):
        self.limits, self.clock = limits, clock
        self.hits = {}
        self.lock = threading.Lock()

    def _recent(self, key):
        limit, window = self.limits[key[0]]
        now = self.clock()
        hits = self.hits.get(key)
        while hits and hits[0] <= now - window:
            hits.popleft()
        return hits, limit, window, now

    def check(self, kind, who):
        """Raises 429 when `who` has used up `kind`; doesn't count anything."""
        with self.lock:
            hits, limit, window, now = self._recent((kind, who))
            if hits and len(hits) >= limit:
                wait = max(1, math.ceil(hits[0] + window - now))
                message = MESSAGES.get(kind, DEFAULT_MESSAGE).format(limit=limit, wait=human_wait(wait))
                raise HTTPException(429, message, headers={"Retry-After": str(wait)})

    def hit(self, kind, who):
        with self.lock:
            key = (kind, who)
            hits, *_ = self._recent(key)
            if hits is None:
                if len(self.hits) >= MAX_TRACKED:
                    self.hits.pop(next(iter(self.hits)))
                hits = self.hits[key] = deque()
            hits.append(self.clock())

    def take(self, kind, who):
        """Checks, then counts this attempt."""
        self.check(kind, who)
        self.hit(kind, who)

    def clear(self, kind, who):
        with self.lock:
            self.hits.pop((kind, who), None)

    def reset(self):
        with self.lock:
            self.hits.clear()


limiter = Limiter()


def client_ip(request, trusted_hops):
    """The visitor's address. Behind a proxy (Render), the proxy appends the address it saw to
    X-Forwarded-For; entries further left can be written by the visitor, so only the one added
    by the `trusted_hops`-th proxy from the right is used. 0 = no proxy (local, Docker)."""
    if trusted_hops > 0:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(forwarded) >= trusted_hops:
            return forwarded[-trusted_hops]
    return request.client.host if request.client else "unknown"


# ── Request size ─────────────────────────────────────────────────────────────
MAX_UPLOAD = 11 * 1024 * 1024  # a 10 MB photo plus the form around it
MAX_BODY = 256 * 1024
UPLOAD_PATHS = ("/clothes", "/clothes/analyze", "/me/avatar")


class TooLarge(Exception):
    pass


class BodySizeLimit:
    """ASGI middleware: refuses request bodies over the limit for their route, before parsing."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = MAX_UPLOAD if scope["path"].endswith(UPLOAD_PATHS) else MAX_BODY
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None:
            try:
                too_big = int(length) > limit
            except ValueError:
                too_big = True
            if too_big:
                return await self._refuse(scope, receive, send, limit)
        received = 0
        started = refused = False

        async def counted():
            nonlocal received, refused
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Answered right here: FastAPI turns any error while reading a body into a
                    # generic 400, so whatever the app sends after this is dropped.
                    if not started and not refused:
                        refused = True
                        await self._refuse(scope, receive, send, limit)
                    raise TooLarge
            return message

        async def tracked(message):
            nonlocal started
            if refused:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted, tracked)
        except TooLarge:
            pass

    @staticmethod
    async def _refuse(scope, receive, send, limit):
        mb = limit / (1024 * 1024)
        detail = f"That’s too large to send. Photos must be under {mb - 1:.0f} MB." if limit == MAX_UPLOAD else "That request is too large."
        await JSONResponse({"detail": detail}, status_code=413, headers={"Connection": "close"})(scope, receive, send)
