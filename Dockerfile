# REGIME — single-stage image. Build: docker build -t regime .
# Run:   docker run -p 8050:8050 regime   →   http://localhost:8050
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# Install deps first so layer caches across code changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8050
# Honor the platform's $PORT if set (Render/Railway), else default 8050.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8050}"]
