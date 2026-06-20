import { randomBytes } from 'node:crypto';

export function makeId(prefix: 'run' | 'att' | 'cap' | 'tok'): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}
