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

# .dockerignore excludes .git, so CI passes the running commit explicitly.
ARG GIT_COMMIT=unknown
ARG GIT_BRANCH=""
ARG IMAGE_TAG=""
ARG COMMIT_AT=""
ARG BUILT_AT=""
ENV APP_COMMIT=$GIT_COMMIT \
    APP_BRANCH=$GIT_BRANCH \
    APP_IMAGE_TAG=$IMAGE_TAG \
    APP_COMMIT_AT=$COMMIT_AT \
    APP_BUILT_AT=$BUILT_AT

EXPOSE 8000

CMD ["python", "-m", "movie_showtime_aggregator.api", "--host", "0.0.0.0", "--port", "8000"]
