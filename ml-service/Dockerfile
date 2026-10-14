FROM python:3.12-slim

# The CLIP model baked into the image, so hosts without persistent disk
# (Hugging Face Spaces) start without downloading it.
ARG EMBEDDING_MODEL=sentence-transformers/clip-ViT-B-32

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/cache/huggingface \
    TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    EMBEDDING_MODEL=${EMBEDDING_MODEL}

WORKDIR /app

# CPU wheels avoid downloading the CUDA runtime on a CPU server.
# UID 1000 is required by Hugging Face Spaces and works everywhere else.
COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install -r requirements.txt \
    && useradd --uid 1000 --create-home outfitly \
    && mkdir -p /app/cache/huggingface \
    && chown -R outfitly:outfitly /app/cache

USER outfitly
RUN python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['EMBEDDING_MODEL'])"
# Load only the baked model at runtime: no Hub requests or cache writes on startup.
ENV HF_HUB_OFFLINE=1

# Credentials and local development files are excluded from the build context.
COPY --chown=outfitly:outfitly app ./app

EXPOSE 8001
CMD ["python", "-m", "app.run"]
