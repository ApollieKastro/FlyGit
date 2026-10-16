# syntax=docker/dockerfile:1
# Build context = repository root (monorepo with npm workspaces).

# ─────────────────────────── deps ───────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Only the manifests first — maximises layer caching.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
# Native modules (argon2, ssh2, cpu-features) need build tools.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# ─────────────────────────── build ───────────────────────────
FROM deps AS build
COPY . .
RUN npm run build -w @flygit/shared
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
# `nest build` respects apps/api/nest-cli.json and emits to apps/api/dist.
RUN npm run build -w @flygit/api

# ────────────────────────── runtime ──────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git + openssh are required: bare repos, receive-pack, generated hooks (node).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json

RUN mkdir -p /data/git /data/uploads /data/ssh
ENV GIT_STORAGE_DIR=/data/git \
    STORAGE_LOCAL_DIR=/data/uploads \
    SSH_HOST_KEY_PATH=/data/ssh/host_ed25519 \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000 2222
VOLUME ["/data/git", "/data/uploads", "/data/ssh"]
WORKDIR /app/apps/api

# tini reaps zombie git processes spawned by receive-pack.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
