/**
 * AfriStable Pay — API entrypoint.
 *
 * Single Fastify instance. Routes are mounted from `routes/`. The composition
 * root (`container.ts`) wires every service; routes get a reference to it via
 * `app.container`.
 *
 * NOTE: this is the HTTP server only. The BullMQ workers (chain indexer,
 * payout dispatcher, webhook processor) live in `src/workers/*` and start
 * via `pnpm --filter @afristable/api workers`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { env } from '@afristable/config';
import { AppError } from '@afristable/shared';
import { buildContainer, type Container } from './container.js';
import { registerAuth }       from './routes/auth.js';
import { registerKyc }        from './routes/kyc.js';
import { registerWallets }    from './routes/wallets.js';
import { registerQuotes }     from './routes/quotes.js';
import { registerTransfers }  from './routes/transfers.js';
import { registerWithdrawals } from './routes/withdrawals.js';
import { registerWebhooks }   from './routes/webhooks.js';
import { registerAdmin }      from './routes/admin.js';
import { registerHealth }     from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
  interface FastifyRequest {
    auth?: { userId: string; sessionId: string };
    admin?: { adminId: string; permissions: Set<string> };
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const e = env();
  const app = Fastify({
    logger: {
      level: e.LOG_LEVEL,
      // Redact sensitive headers/values from log output.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-webhook-signature"]',
          'req.body.password',
          'req.body.refreshToken',
        ],
        censor: '[REDACTED]',
      },
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,           // 1 MB cap; raise per-route for uploads
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  });

  // ---- Security headers ----
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: e.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {
    parseOptions: { httpOnly: true, sameSite: 'strict', secure: e.NODE_ENV === 'production' },
  });

  await app.register(rateLimit, {
    max: e.RATE_LIMIT_GLOBAL_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = req.auth?.userId;
      if (auth) return `u:${auth}`;
      return `ip:${req.ip}`;
    },
  });

  // ---- DI ----
  const container = buildContainer();
  app.decorate('container', container);

  // ---- Global error handler ----
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send(err.toJSON());
    }
    if ((err as { validation?: unknown }).validation) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: err.message, details: (err as { validation?: unknown }).validation },
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  // ---- Routes ----
  await app.register(registerHealth,      { prefix: '/health' });
  await app.register(registerAuth,        { prefix: '/v1/auth' });
  await app.register(registerKyc,         { prefix: '/v1/kyc' });
  await app.register(registerWallets,     { prefix: '/v1/wallets' });
  await app.register(registerQuotes,      { prefix: '/v1/quotes' });
  await app.register(registerTransfers,   { prefix: '/v1/transfers' });
  await app.register(registerWithdrawals, { prefix: '/v1/withdrawals' });
  await app.register(registerWebhooks,    { prefix: '/v1/webhooks' });
  await app.register(registerAdmin,       { prefix: '/v1/admin' });

  return app;
}

async function main() {
  const e = env();
  const app = await buildApp();
  try {
    await app.listen({ host: e.API_HOST, port: e.API_PORT });
    app.log.info({ port: e.API_PORT }, 'AfriStable Pay API listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
