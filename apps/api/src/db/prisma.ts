import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

declare global {
  var shaderOraclePrisma: PrismaClient | undefined;
}

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://shader_oracle:password@localhost:5432/shader_oracle',
});

export const prisma = globalThis.shaderOraclePrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalThis.shaderOraclePrisma = prisma;
}
