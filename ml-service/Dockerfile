FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/cache/huggingface \
    TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2

WORKDIR /app

# CPU wheels avoid downloading the CUDA runtime on a CPU server.
COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install -r requirements.txt \
    && useradd --uid 10001 --create-home outfitly \
    && mkdir -p /app/cache/huggingface \
    && chown -R outfitly:outfitly /app/cache

# Credentials and local development files are excluded from the build context.
COPY --chown=outfitly:outfitly app ./app
USER outfitly

EXPOSE 8001
CMD ["python", "-m", "app.run"]
