# Serves POST /ai/move (src/service.py) over HTTP. CPU-only -- see requirements-service.txt --
# because the model is small (~1.5M params) and this only needs to run inference, not training.
FROM python:3.12-slim

WORKDIR /app

COPY requirements-service.txt .
RUN pip install --no-cache-dir -r requirements-service.txt

COPY src/ ./src/
COPY config.yaml .
# Whole directory (not just best.pt) so every committed best_<size>x<size>.pt -- any
# board size with a native checkpoint, see service.py's CHECKPOINT_FILENAMES -- ships
# too, without needing a Dockerfile edit each time a new size gets trained.
COPY checkpoints/ ./checkpoints/

EXPOSE 8000

# $PORT is set by most hosting platforms (Render/Railway/Fly...); falls back to 8000 locally.
CMD ["sh", "-c", "uvicorn src.service:app --host 0.0.0.0 --port ${PORT:-8000}"]
