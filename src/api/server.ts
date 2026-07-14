import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { buildCompositionRoot } from './composition-root.js';
import { disconnectPrisma } from '../infrastructure/db/prisma-client.js';

async function main(): Promise<void> {
  const root = await buildCompositionRoot();
  const app = await buildApp(root);

  closeWithGrace({ delay: 10_000 }, async ({ err }) => {
    if (err) {
      root.logger.error('Shutting down due to unhandled error', { error: err.message });
    } else {
      root.logger.info('Shutting down gracefully');
    }
    await app.close();
    await disconnectPrisma();
  });

  await app.listen({ port: root.env.PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
