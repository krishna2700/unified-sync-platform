import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Runs reference-data seeding (providers, default status mappings) plus every provider seed
 * script whose credentials are configured, skipping — not failing — the ones that aren't. */
async function runScript(label: string, path: string): Promise<void> {
  console.log(`\n--- ${label} ---`);
  try {
    const { stdout } = await execFileAsync('npx', ['tsx', path], { env: process.env });
    console.log(stdout.trim());
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? '';
    console.log(stdout.trim());
    console.warn(`${label} skipped or failed (see above) — continuing with the rest.`);
  }
}

async function main(): Promise<void> {
  await runScript('Reference data (providers, status mappings)', 'prisma/seed.ts');

  if (process.env['HUBSPOT_ACCESS_TOKEN']) {
    await runScript('HubSpot sample data', 'scripts/seed-hubspot.ts');
  } else {
    console.log('\n--- HubSpot sample data --- skipped (HUBSPOT_ACCESS_TOKEN not set)');
  }

  if (process.env['GOOGLE_REFRESH_TOKEN']) {
    await runScript('Google Calendar sample data', 'scripts/seed-google-calendar.ts');
  } else {
    console.log('\n--- Google Calendar sample data --- skipped (GOOGLE_REFRESH_TOKEN not set)');
  }

  if (process.env['STRIPE_SECRET_KEY']) {
    await runScript('Stripe sample data', 'scripts/seed-stripe.ts');
  } else {
    console.log('\n--- Stripe sample data --- skipped (STRIPE_SECRET_KEY not set)');
  }
}

main().catch((error: unknown) => {
  console.error('Seed orchestration failed:', error);
  process.exitCode = 1;
});
