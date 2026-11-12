FROM node:20-alpine AS front
WORKDIR /front
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY wsgi.py .
COPY --from=front /front/dist ./frontend/dist

RUN mkdir -p /app/data \
    && useradd --create-home --uid 1000 app \
    && chown -R app:app /app
USER app

EXPOSE 5000

# Um worker com varias threads: o cache em memoria fica compartilhado entre as requisicoes.
CMD ["sh", "-c", "gunicorn --preload --bind 0.0.0.0:${PORT} --worker-class gthread --workers 1 --threads ${WEB_THREADS:-16} --timeout 120 --access-logfile - --error-logfile - wsgi:app"]
