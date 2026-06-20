import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RouteContext } from './context.js';

export function requestUserId(context: RouteContext, request: FastifyRequest): string | undefined {
  return context.auth.getUserId(request);
}

export function requireUserId(
  context: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
): string | undefined {
  const userId = requestUserId(context, request);
  if (userId) return userId;
  if (!context.auth.required) return undefined;

  reply.code(401).send({ ok: false, error: 'sign in required' });
  return undefined;
}

export function canAccessOwner(
  context: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
  ownerId: string | undefined,
): boolean {
  if (!context.auth.required || !ownerId) return true;

  const userId = requireUserId(context, request, reply);
  if (!userId) return false;
  if (userId === ownerId) return true;

  reply.code(404).send({ ok: false, error: 'not found' });
  return false;
}
