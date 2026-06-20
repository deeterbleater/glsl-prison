import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'src/db/schema.prisma',
  migrations: {
    path: 'src/db/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://shader_oracle:password@localhost:5432/shader_oracle',
  },
});
