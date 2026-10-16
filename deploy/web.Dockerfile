# syntax=docker/dockerfile:1
# Build context = repository root (monorepo with npm workspaces).

# ─────────────────────────── deps ───────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm ci

# ─────────────────────────── build ───────────────────────────
FROM deps AS build
COPY . .
RUN npm run build -w @flygit/shared
RUN npm run build -w @flygit/web

# ────────────────────────── runtime ──────────────────────────
FROM nginx:1.27-alpine AS runtime
# SPA fallback + reverse-proxy the API and git smart-HTTP to the api service.
COPY deploy/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
