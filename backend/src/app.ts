import './config'; // validate env vars on startup — crashes fast if misconfigured
import './types';  // ensure Express Request augmentation (req.user) is loaded

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { config } from './config';
import { redis } from './config/redis'; // reuse existing ioredis client
import { ensureEmailLogsIndex } from './config/elasticsearch';
import { emailQueue } from './queues/emailQueue';
import { createEmailWorker } from './queues/worker';
import { runBootstrapReconciler } from './jobs/bootstrap';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

import authRoutes, { passport } from './routes/auth';
import senderRoutes   from './routes/senders';
import campaignRoutes from './routes/campaigns';
import emailRoutes    from './routes/emails';
import uploadRoutes   from './routes/upload';
import slackRoutes    from './routes/slack';

const app = express();

// Trust the Railway load balancer so secure cookies can be set
app.set('trust proxy', 1);

// ── Core middleware ───────────────────────────────────────────────────────────

app.use(
  cors({
    origin:      config.frontendUrl,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Session (Redis-backed — survives backend restarts) ─────────────────────────
//
// Using RedisStore instead of the default MemoryStore means:
//  • Sessions persist across backend restarts
//  • Multiple API process replicas share the same session data
//  • No "Unauthorized" errors simply because the server was restarted
//
// In development: sameSite='lax' lets the browser send the connect.sid
// cookie on cross-origin XHR from localhost:3000 → localhost:4000.
// In production:  sameSite='none' + secure=true (requires HTTPS).
app.use(
  session({
    store: new RedisStore({ client: redis }),
    secret:            config.session.secret,
    resave:            false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure:   config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge:   config.session.maxAgeHours * 60 * 60 * 1000,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(requestLogger);

// ── Bull Board ────────────────────────────────────────────────────────────────

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(config.bullBoard.path);

createBullBoard({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queues:        [new BullMQAdapter(emailQueue) as any],
  serverAdapter,
});

// Protect Bull Board with HTTP Basic Auth
app.use(
  config.bullBoard.path,
  (req, res, next) => {
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).send('Authentication required');
      return;
    }
    const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString();
    const password = decoded.split(':').slice(1).join(':'); // handle colons in password
    if (password !== config.bullBoard.password) {
      res.status(403).send('Forbidden');
      return;
    }
    next();
  },
  serverAdapter.getRouter()
);

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/auth',          authRoutes);
app.use('/api/senders',   senderRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/emails',    emailRoutes);
app.use('/api/upload',    uploadRoutes);
app.use('/slack',         slackRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global error handler (must be last) ──────────────────────────────────────

app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // 1. Ensure Elasticsearch index exists (non-fatal)
  await ensureEmailLogsIndex();

  // 2. Start BullMQ worker
  createEmailWorker();

  // 3. Start HTTP server
  app.listen(config.port, () => {
    console.log(`\n🚀 ReachInbox backend running on http://localhost:${config.port}`);
    console.log(`📊 Bull Board:  http://localhost:${config.port}${config.bullBoard.path}`);
    console.log(`❤️  Health:     http://localhost:${config.port}/health\n`);
  });

  // 4. Run bootstrap reconciler after 2 s (gives the DB connection pool time to warm up)
  setTimeout(() => runBootstrapReconciler(), 2000);
}

start().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

export default app;
