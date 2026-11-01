import { env, loadEnv } from '@evendule/shared/env';
import { initLogger } from '@evendule/shared/logger';
import { z } from 'zod';

export const config = loadEnv({
  PORT: env.port(4004),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: env.bool(false),
  DB_POOL_MAX: env.int(5),
  REDIS_URL: z.string().min(1),
  NOTIFICATION_DISPATCH_INTERVAL_MS: env.int(3000),
});

initLogger('notify-service', config.LOG_LEVEL);
