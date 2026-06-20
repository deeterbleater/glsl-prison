import type { Env } from '../env.js';

export function getRateLimitOptions(env: Env) {
  return {
    max: env.rateLimitPerMinute,
    timeWindow: '1 minute',
  };
}
