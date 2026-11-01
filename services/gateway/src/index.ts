import { serve } from '@evendule/shared/lifecycle';
import { createRedis } from '@evendule/shared/redis';
import { createGatewayApp } from './app.js';
import { config } from './config.js';

const redis = createRedis(config.REDIS_URL, 'gateway');
serve(createGatewayApp(redis), config.PORT, [async () => redis.quit()]);
