FROM node:22-bookworm-slim AS frontend-build

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend ./frontend
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

# Requirements first so a Python code-only change reuses the dependency layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend-build /build/frontend/dist/ ./movie_showtime_aggregator/static/
RUN mkdir -p data

EXPOSE 8000

CMD ["python", "-m", "movie_showtime_aggregator.api", "--host", "0.0.0.0", "--port", "8000"]
