# FlyGit

Self-hosted Git platform: repositories, issues, merge requests, organizations and notifications — with full control over your code and data.
<img width="1356" height="1022" alt="image" src="https://github.com/user-attachments/assets/ea1d2138-a953-470c-bcad-adadd53c0a51" />

## Features

- **Git transport** — smart HTTP (`git push/clone`) and SSH, branches, tags, blame, diffs, file browsing.
- **Repositories** — public/private, stars, watchers, forks, topics, releases, wiki, protected branches.
- **Issues** — statuses, labels, milestones, assignees, comments, reactions.
- **Merge requests** — diffs, commits, reviews, approvals, merge strategies (merge / squash / rebase).
- **Organizations** — teams, roles (owner / maintainer / member), invitations, audit trail.
- **Auth & security** — 2FA (TOTP), personal access tokens, SSH keys, argon2 hashing, rate limiting.
- **Notifications** — repository events and email templates in three languages (ru / en / zh-CN).
- **Admin panel** — platform users, moderation and system settings.

## Tech stack

| Layer    | Choice |
| -------- | ------ |
| API      | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7 |
| Web      | React 19, Vite 8, Tailwind CSS 4, TanStack Query 5 |
| Git      | `git http-backend` (smart HTTP) + `ssh2` server |
| Monorepo | npm workspaces |
| Deploy   | Docker Compose, nginx, GitHub Actions CI |

## Quick start (Docker)

```bash
# 1. Configure environment
cp deploy/.env.example deploy/.env
# edit deploy/.env — set POSTGRES_PASSWORD, JWT_*_SECRET, FLYGIT_HOOK_SECRET
# (generate secrets: openssl rand -hex 32)

# 2. Build and start the stack (postgres + redis + api + web)
docker compose -f deploy/docker-compose.yml up -d --build

# 3. Open the app
#   Web:  http://localhost:8080
#   Git:  git clone http://localhost:8080/<owner>/<repo>.git
#   SSH:  git clone ssh://git@localhost:2222/<owner>/<repo>.git
```

The API runs `prisma migrate deploy` on start, so the database is set up automatically.

## Development

```bash
npm install

# copy env and generate secrets
cp deploy/.env.example apps/api/.env
# ...fill apps/api/.env, then:
npm run prisma:generate -w @flygit/api
npm run prisma:migrate -w @flygit/api

# run API (http://localhost:3001) and Web (http://localhost:5173) together
npm run dev
```

The web dev server proxies `/api` and `/git` to the API on port `3001`.

## Testing

```bash
npm test          # unit tests (api + web + shared)
npm run lint      # eslint
npm run typecheck # tsc across all workspaces
```

## Project structure

```
apps/
  api/          NestJS backend (REST + git transport)
  web/          React frontend (Vite)
packages/
  shared/       Types, constants, zod schemas
  config/       Shared tsconfig / eslint presets
deploy/
  docker-compose.yml
  api.Dockerfile
  web.Dockerfile
  web.nginx.conf
  .env.example
```

## Environment variables

See [`deploy/.env.example`](deploy/.env.example) for the full list. Required values:

| Variable | Purpose |
| -------- | ------- |
| `POSTGRES_PASSWORD` | Database password |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | JWT signing keys (≥16 chars) |
| `FLYGIT_HOOK_SECRET` | Shared secret for git pre/post-receive hooks |

All other variables have safe defaults (see `apps/api/src/config/env.schema.ts`).

## License

MIT
