# syntax=docker/dockerfile:1.6
#
# All-in-one production image: runs the API + Next.js on a single container,
# behind a tiny supervisor. Web is the public surface; API is reached via
# its proxy. Designed for one-service-per-container hosts (Render, Railway,
# Fly.io) where you want to ship the platform with one URL.
#
# For high scale, split into two images (api.Dockerfile + web.Dockerfile)
# and deploy them as separate services behind the same domain.

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json                apps/api/package.json
COPY apps/web/package.json                apps/web/package.json
COPY packages/shared/package.json         packages/shared/package.json
COPY packages/database/package.json       packages/database/package.json
COPY packages/config/package.json         packages/config/package.json
COPY packages/ledger/package.json         packages/ledger/package.json
COPY packages/fraud/package.json          packages/fraud/package.json
COPY packages/compliance/package.json     packages/compliance/package.json
COPY packages/blockchain/package.json     packages/blockchain/package.json
COPY packages/payments/package.json       packages/payments/package.json
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @afristable/database prisma:generate
RUN pnpm --filter @afristable/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN apk add --no-cache tini
COPY --from=build /app /app

# Render/Railway/Fly all set $PORT — make Next listen on it; the API stays
# on 4000 internally and is reached via the Next.js rewrite (/api/* → :4000).
ENV API_INTERNAL_URL=http://127.0.0.1:4000 \
    API_HOST=127.0.0.1 \
    API_PORT=4000

EXPOSE 3000

# tini handles signal forwarding; we run the API in the background and
# foreground Next so the platform's healthchecks see the public service.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm --filter @afristable/database prisma migrate deploy && (pnpm --filter @afristable/api tsx src/server.ts &) && pnpm --filter @afristable/web start -p ${PORT:-3000}"]
