# Foundry — PO Capture
# Production image for Hugging Face Spaces (Docker SDK).
#
# HF runs containers as a non-root user (UID 1000). The standard pattern is
# to work under $HOME so the user owns the directory tree by default —
# otherwise `mkdir` etc. fail with EACCES on /app.
#
# Runtime configuration comes from Space "Variables and secrets":
#   FOUNDRY_DB_BACKEND  = turso
#   TURSO_DB_URL        = libsql://...turso.io
#   TURSO_DB_TOKEN      = eyJhbGciOi...
#   OPENROUTER_API_KEY  = AIza...  (or sk-or-v1-...)
#   FOUNDRY_JWT_SECRET  = <hex>

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Non-root user (HF convention). `-m` creates /home/user which user owns.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR $HOME/app

# Install Python deps to ~/.local — separated from app code so this layer
# caches across edits.
COPY --chown=user:user requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# Copy app source. --chown makes everything writable by `user` at runtime,
# so backend.py can mkdir ./files for uploaded sources.
COPY --chown=user:user . .

ENV PORT=7860
EXPOSE 7860

# One process serves everything: GET / → React HTML, GET /api/* → REST API
CMD ["sh", "-c", "uvicorn backend:app --host 0.0.0.0 --port ${PORT:-7860}"]
