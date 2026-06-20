import type { Env } from '../env.js';
import type { Repository } from '../db/repository.js';
import type { ModelClient } from '../services/modelClient.js';
import type { FastifyRequest } from 'fastify';

export type AuthContext = {
  enabled: boolean;
  required: boolean;
  getUserId(request: FastifyRequest): string | undefined;
};

export type RouteContext = {
  env: Env;
  repository: Repository;
  modelClient: ModelClient;
  auth: AuthContext;
};
