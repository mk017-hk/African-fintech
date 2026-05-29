# Deploying AfriStable Pay

The app now runs as a **single web service** — Next.js serves the UI on `:PORT`
and proxies `/api/*` to the API on `:4000` inside the same container. You only
expose one URL to the world. No CORS, no second forwarded port, no `NEXT_PUBLIC_API_URL`
gymnastics.

You need two managed services from the host:
- **PostgreSQL 16+** (Prisma migrations run on each boot).
- **Redis 6+** (BullMQ + caches).

Everything else is in `infra/docker/all-in-one.Dockerfile`.

---

## Railway (recommended for fastest path)

Railway provisions Postgres + Redis as plugins and reads `railway.json`.

1. Push the branch to GitHub.
2. https://railway.app → **New Project → Deploy from GitHub repo** → pick the repo + this branch.
3. Click **+ New → Database → PostgreSQL**. Railway sets `DATABASE_URL`.
4. Click **+ New → Database → Redis**. Railway sets `REDIS_URL`.
5. On the web service → **Variables**, paste these (the URL ones become the Railway-assigned domain after first deploy — re-edit after step 7):

   ```env
   NODE_ENV=production
   LOG_LEVEL=info
   JWT_ACCESS_SECRET=<openssl rand -hex 32>
   JWT_REFRESH_SECRET=<openssl rand -hex 32>
   QUOTE_SIGNING_KEY=<openssl rand -hex 32>
   WEBHOOK_SIGNING_SECRET=<openssl rand -hex 32>
   PII_ENCRYPTION_KEY=<openssl rand -hex 32>
   API_PUBLIC_URL=https://<your-railway-app>.up.railway.app
   WEB_PUBLIC_URL=https://<your-railway-app>.up.railway.app
   CORS_ORIGINS=https://<your-railway-app>.up.railway.app
   WEBAUTHN_ORIGIN=https://<your-railway-app>.up.railway.app
   WEBAUTHN_RP_ID=<your-railway-app>.up.railway.app
   ```

6. **Settings → Generate Domain**. Copy the URL.
7. Update the five URL/HOST vars from step 5 to the real domain. Redeploy.
8. Open the URL → `/login` → `alice@demo.test` / `AlicePass_999!`.

   - Test users only exist if `db:seed:dev` ran. On production deploys this is gated off. To enable them once:

     ```bash
     # In Railway → web service → Settings → Shell
     NODE_ENV=development pnpm db:seed:dev
     ```

     Then bounce the service.

---

## Render (one-click via blueprint)

`render.yaml` is preconfigured. 

1. Push the branch to GitHub.
2. https://dashboard.render.com → **New → Blueprint** → connect this repo.
3. Render reads `render.yaml`, provisions Postgres + Redis, mints secrets, and deploys.
4. Open the URL → `/login`. Same caveat re: test users.

---

## Fly.io

```bash
fly launch --dockerfile infra/docker/all-in-one.Dockerfile --no-deploy
fly postgres create        # attach to the app
fly redis create           # Upstash Redis
fly secrets set \
  JWT_ACCESS_SECRET=$(openssl rand -hex 32) \
  JWT_REFRESH_SECRET=$(openssl rand -hex 32) \
  QUOTE_SIGNING_KEY=$(openssl rand -hex 32) \
  WEBHOOK_SIGNING_SECRET=$(openssl rand -hex 32) \
  PII_ENCRYPTION_KEY=$(openssl rand -hex 32)
fly deploy
```

Then set the URL vars to your `*.fly.dev` domain and `fly deploy` again.

---

## A note on the all-in-one image

For development, demos, and small-scale production it's fine. For real scale
you'll want to split it: ship `apps/api` and `apps/web` as separate Docker
images behind a single domain (Caddy/nginx/Cloudflare), and run the workers
(`apps/api/src/workers`) as their own deployment so payout/chain jobs can't
starve HTTP traffic. The code already supports this — `containerise.ts` and
the BullMQ topics are wired up.

---

## What you give up on hosted free tiers

- **Custody signer**: no HSM/MPC integration — on-chain withdrawals stub the tx hash.
- **Real sanctions provider**: ships with a tiny stub list.
- **Edge WAF**: put Cloudflare in front before any real load.
- **Admin MFA**: TOTP field is scaffolded, not enforced.

Everything in `SECURITY.md` applies — read it before pointing real money at this.
