FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
RUN useradd --create-home app
USER app
# One worker, because events are kept in memory.
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads 8 --bind 0.0.0.0:${PORT} server:app"]
