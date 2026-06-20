import type { Env } from '../env.js';
import type { Repository } from '../db/repository.js';
import type { ModelClient } from '../services/modelClient.js';

export type RouteContext = {
  env: Env;
  repository: Repository;
  modelClient: ModelClient;
};
