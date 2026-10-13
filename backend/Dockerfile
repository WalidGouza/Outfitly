FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# No PyTorch here: CLIP runs in the separate ml-service image.
COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt \
    && useradd --uid 10001 --create-home outfitly \
    && mkdir -p /app/uploads \
    && chown -R outfitly:outfitly /app/uploads

# Credentials and local development files are excluded from the build context.
COPY --chown=outfitly:outfitly app ./app
USER outfitly

EXPOSE 8000
CMD ["python", "-m", "app.run"]
