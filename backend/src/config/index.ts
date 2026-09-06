import dotenv from 'dotenv';
dotenv.config();

import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // PostgreSQL
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_CALLBACK_URL: z.string().url(),

  // Slack OAuth
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().default(''),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('email_logs'),

  // Session
  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
  SESSION_MAX_AGE_HOURS: z.string().default('24'),

  // Scheduling
  MAX_EMAILS_PER_HOUR: z.string().default('50'),
  MIN_DELAY_MS: z.string().default('1000'),
  WORKER_CONCURRENCY: z.string().default('5'),

  // Ethereal
  ETHEREAL_USER: z.string().default(''),
  ETHEREAL_PASS: z.string().default(''),

  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Bull Board
  BULL_BOARD_PATH: z.string().default('/bull-ui'),
  BULL_BOARD_PASSWORD: z.string().default('admin'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parseInt(parsed.data.PORT, 10),
  nodeEnv: parsed.data.NODE_ENV,
  databaseUrl: parsed.data.DATABASE_URL,
  redisUrl: parsed.data.REDIS_URL,
  google: {
    clientId: parsed.data.GOOGLE_CLIENT_ID,
    clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
    callbackUrl: parsed.data.GOOGLE_CALLBACK_URL,
  },
  slack: {
    clientId: parsed.data.SLACK_CLIENT_ID,
    clientSecret: parsed.data.SLACK_CLIENT_SECRET,
    redirectUri: parsed.data.SLACK_REDIRECT_URI,
  },
  elasticsearch: {
    url: parsed.data.ELASTICSEARCH_URL,
    index: parsed.data.ELASTICSEARCH_INDEX,
  },
  session: {
    secret: parsed.data.SESSION_SECRET,
    maxAgeHours: parseInt(parsed.data.SESSION_MAX_AGE_HOURS, 10),
  },
  scheduling: {
    maxEmailsPerHour: parseInt(parsed.data.MAX_EMAILS_PER_HOUR, 10),
    minDelayMs: parseInt(parsed.data.MIN_DELAY_MS, 10),
    workerConcurrency: parseInt(parsed.data.WORKER_CONCURRENCY, 10),
  },
  ethereal: {
    user: parsed.data.ETHEREAL_USER,
    pass: parsed.data.ETHEREAL_PASS,
  },
  frontendUrl: parsed.data.FRONTEND_URL,
  bullBoard: {
    path: parsed.data.BULL_BOARD_PATH,
    password: parsed.data.BULL_BOARD_PASSWORD,
  },
};
