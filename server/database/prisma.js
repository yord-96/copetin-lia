import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis;
const loggingEnabled = String(process.env.DATABASE_LOGGING ?? '').toLowerCase() === 'true';
const connectionString = process.env.DATABASE_URL
  || 'postgresql://copetin_local:copetin_local_password@localhost:5432/copetin_dev?schema=public';

export const prisma = globalForPrisma.__copetinPrisma ?? new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: loggingEnabled ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__copetinPrisma = prisma;
}

export const disconnectPrisma = async () => {
  await prisma.$disconnect();
};
