import type { PrismaClient } from '@prisma/client';
import type {
  PaymentStatusMappingRepository,
  PaymentStatusMappingRow,
} from '../../domain/ports/payment-status-mapping-repository.port.js';
import { isCanonicalPaymentStatus } from '../../domain/value-objects/payment-status.js';
import { isProviderId } from '../../domain/value-objects/provider.js';

export class PrismaPaymentStatusMappingRepository implements PaymentStatusMappingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listAll(): Promise<PaymentStatusMappingRow[]> {
    const rows = await this.prisma.paymentStatusMapping.findMany();
    return rows.map((row) => {
      if (!isProviderId(row.provider)) {
        throw new Error(`Unknown provider in payment_status_mappings row: ${row.provider}`);
      }
      if (!isCanonicalPaymentStatus(row.canonicalStatus)) {
        throw new Error(
          `Invalid canonical_status in payment_status_mappings row: ${row.canonicalStatus}`,
        );
      }
      return {
        provider: row.provider,
        rawStatus: row.rawStatus,
        canonicalStatus: row.canonicalStatus,
      };
    });
  }

  async upsert(row: PaymentStatusMappingRow): Promise<void> {
    await this.prisma.paymentStatusMapping.upsert({
      where: { provider_rawStatus: { provider: row.provider, rawStatus: row.rawStatus } },
      create: {
        provider: row.provider,
        rawStatus: row.rawStatus,
        canonicalStatus: row.canonicalStatus,
      },
      update: { canonicalStatus: row.canonicalStatus },
    });
  }
}
