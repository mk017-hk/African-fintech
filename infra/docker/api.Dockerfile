# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/api/package.json                apps/api/package.json
COPY packages/shared/package.json         packages/shared/package.json
COPY packages/database/package.json       packages/database/package.json
COPY packages/config/package.json         packages/config/package.json
COPY packages/ledger/package.json         packages/ledger/package.json
COPY packages/fraud/package.json          packages/fraud/package.json
COPY packages/compliance/package.json     packages/compliance/package.json
COPY packages/blockchain/package.json     packages/blockchain/package.json
COPY packages/payments/package.json       packages/payments/package.json
RUN pnpm install --frozen-lockfile=false

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @afristable/database prisma:generate
RUN pnpm --filter @afristable/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
