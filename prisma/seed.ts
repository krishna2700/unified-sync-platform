import { PrismaClient } from '@prisma/client';
import { ProviderId, sourceSystemOf } from '../src/domain/value-objects/provider.js';
import { CanonicalPaymentStatus } from '../src/domain/value-objects/payment-status.js';

const prisma = new PrismaClient();

const PROVIDERS: Array<{ id: ProviderId; displayName: string }> = [
  { id: ProviderId.HUBSPOT, displayName: 'HubSpot' },
  { id: ProviderId.GOOGLE_CALENDAR, displayName: 'Google Calendar' },
  { id: ProviderId.STRIPE, displayName: 'Stripe' },
];

/**
 * Default raw-status -> canonical-status mapping for the one payment provider we wire up
 * (Stripe). This table is what makes the mapping "configurable" per the assignment: adding a
 * second payment processor with its own vocabulary (Provider B's "completed", Provider D's
 * "captured", ...) is a data insert here, never a code change to RevenueCalculator.
 */
const STRIPE_STATUS_MAPPINGS: Array<{ rawStatus: string; canonicalStatus: string }> = [
  { rawStatus: 'succeeded', canonicalStatus: CanonicalPaymentStatus.COLLECTED },
  { rawStatus: 'processing', canonicalStatus: CanonicalPaymentStatus.PENDING },
  { rawStatus: 'requires_payment_method', canonicalStatus: CanonicalPaymentStatus.PENDING },
  { rawStatus: 'requires_action', canonicalStatus: CanonicalPaymentStatus.PENDING },
  { rawStatus: 'requires_confirmation', canonicalStatus: CanonicalPaymentStatus.PENDING },
  { rawStatus: 'requires_capture', canonicalStatus: CanonicalPaymentStatus.PENDING },
  { rawStatus: 'canceled', canonicalStatus: CanonicalPaymentStatus.CANCELLED },
];

async function main(): Promise<void> {
  for (const provider of PROVIDERS) {
    await prisma.provider.upsert({
      where: { id: provider.id },
      create: {
        id: provider.id,
        sourceSystem: sourceSystemOf(provider.id),
        displayName: provider.displayName,
      },
      update: { displayName: provider.displayName, sourceSystem: sourceSystemOf(provider.id) },
    });
  }
  console.log(`Seeded ${PROVIDERS.length} providers.`);

  for (const mapping of STRIPE_STATUS_MAPPINGS) {
    await prisma.paymentStatusMapping.upsert({
      where: { provider_rawStatus: { provider: ProviderId.STRIPE, rawStatus: mapping.rawStatus } },
      create: {
        provider: ProviderId.STRIPE,
        rawStatus: mapping.rawStatus,
        canonicalStatus: mapping.canonicalStatus,
      },
      update: { canonicalStatus: mapping.canonicalStatus },
    });
  }
  console.log(`Seeded ${STRIPE_STATUS_MAPPINGS.length} Stripe payment status mappings.`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
