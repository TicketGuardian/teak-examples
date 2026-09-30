# Build from the checkout folder, so the image includes the shared frontend:
#   docker build -f checkout/python/Dockerfile checkout
FROM python:3.12-slim
WORKDIR /app
COPY python/requirements.txt python/
RUN pip install --no-cache-dir -r python/requirements.txt
COPY python/ python/
COPY frontend/ frontend/
WORKDIR /app/python
ENV PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
RUN useradd --create-home app
USER app
# One worker, because orders are kept in memory. Threads let background submits run.
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads 8 --bind 0.0.0.0:${PORT} server:app"]
