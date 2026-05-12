# Foundry — PO Capture
# Production image for Hugging Face Spaces (Docker SDK).
#
# HF Spaces runs the container with HOME=/data (writable persistent disk on paid tiers)
# and expects the app to listen on $PORT (default 7860).
#
# We do NOT bake credentials in. At runtime, set these as Space "Variables and
# secrets" in the Settings tab:
#   FOUNDRY_DB_BACKEND  = turso
#   TURSO_DB_URL        = libsql://...turso.io
#   TURSO_DB_TOKEN      = eyJhbGciOi...
#   OPENROUTER_API_KEY  = AIza...  (or sk-or-v1-...)
#   FOUNDRY_JWT_SECRET  = <hex secret>

FROM python:3.11-slim

# Avoid prompts, write .pyc out of the layer, log straight to stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Hugging Face runs the container as a non-root user (UID 1000). Make sure
# the working directory and python user-site are writable by that user.
RUN useradd -m -u 1000 user
WORKDIR /app

# Install Python deps first so this layer is cached across code-only changes
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY --chown=user:user . .

USER user

# HF Spaces routes traffic to $PORT (defaults to 7860 for Docker SDK)
ENV PORT=7860
EXPOSE 7860

# One process serves everything: GET / → React HTML, GET /api/* → REST API
CMD ["sh", "-c", "uvicorn backend:app --host 0.0.0.0 --port ${PORT:-7860}"]
