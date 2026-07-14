import { PrismaClient } from '@prisma/client';

let instance: PrismaClient | undefined;

/** Single shared PrismaClient per process (Prisma's own recommendation) — creating one per
 * request would exhaust Postgres connections, especially against Supabase's pooled connection
 * limit on the free tier. */
export function getPrismaClient(): PrismaClient {
  instance ??= new PrismaClient();
  return instance;
}

export async function disconnectPrisma(): Promise<void> {
  await instance?.$disconnect();
  instance = undefined;
}
