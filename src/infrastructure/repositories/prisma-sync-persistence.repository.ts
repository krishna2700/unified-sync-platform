import type { Prisma, PrismaClient } from '@prisma/client';
import type { CanonicalRecord } from '../../domain/entities/index.js';
import { isCalendarEvent, isContact, isDeal, isPayment } from '../../domain/entities/index.js';
import type {
  SyncPersistencePort,
  UpsertSummary,
} from '../../domain/ports/sync-persistence.port.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';
import type { SyncCursor } from '../../domain/value-objects/sync-cursor.js';

type Tx = Prisma.TransactionClient;
type Outcome = 'created' | 'updated' | 'unchanged';

/**
 * Persists a fetched batch and advances the cursor inside a single Postgres transaction — the
 * core idempotency/data-safety mechanism of the whole pipeline (see the `SyncPersistencePort`
 * doc comment). Each canonical kind is routed to its own table; the (provider, sourceId) unique
 * constraint on every canonical table is what makes concurrent/duplicate/retried writes safe at
 * the database level, independent of whatever this class computes for the created/updated/
 * unchanged counters (which are purely informational, for job-history/observability).
 */
export class PrismaSyncPersistence implements SyncPersistencePort {
  constructor(private readonly prisma: PrismaClient) {}

  async persistBatch(params: {
    provider: ProviderId;
    entityType: EntityType;
    records: CanonicalRecord[];
    newCursor: SyncCursor | null;
  }): Promise<UpsertSummary> {
    return this.prisma.$transaction(async (tx) => {
      const summary: UpsertSummary = { created: 0, updated: 0, unchanged: 0 };

      for (const record of params.records) {
        const outcome = await this.upsertOne(tx, record);
        summary[
          outcome === 'created' ? 'created' : outcome === 'updated' ? 'updated' : 'unchanged'
        ]++;
      }

      if (params.newCursor) {
        const cursor = params.newCursor;
        await tx.syncCursor.upsert({
          where: {
            provider_entityType: { provider: params.provider, entityType: params.entityType },
          },
          create: {
            provider: params.provider,
            entityType: params.entityType,
            token: cursor.token,
            issuedAt: cursor.issuedAt,
            expiresAt: cursor.expiresAt,
          },
          update: { token: cursor.token, issuedAt: cursor.issuedAt, expiresAt: cursor.expiresAt },
        });
      }

      return summary;
    });
  }

  private async upsertOne(tx: Tx, record: CanonicalRecord): Promise<Outcome> {
    if (isContact(record)) return this.upsertContact(tx, record);
    if (isDeal(record)) return this.upsertDeal(tx, record);
    if (isCalendarEvent(record)) return this.upsertEvent(tx, record);
    if (isPayment(record)) return this.upsertPayment(tx, record);
    throw new Error(`Unhandled canonical record kind: ${(record as { kind: string }).kind}`);
  }

  private async upsertContact(
    tx: Tx,
    record: Extract<CanonicalRecord, { kind: 'contact' }>,
  ): Promise<Outcome> {
    const existing = await tx.canonicalContact.findUnique({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
    });
    const data = {
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      phone: record.phone,
      company: record.company,
      lifecycleStage: record.lifecycleStage,
      sourceCreatedAt: record.sourceCreatedAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      syncedAt: new Date(),
      raw: record.raw as Prisma.InputJsonValue,
    };
    await tx.canonicalContact.upsert({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
      create: { provider: record.provider, sourceId: record.sourceId, ...data },
      update: data,
    });
    return classifyOutcome(existing?.sourceUpdatedAt ?? null, record.sourceUpdatedAt);
  }

  private async upsertDeal(
    tx: Tx,
    record: Extract<CanonicalRecord, { kind: 'deal' }>,
  ): Promise<Outcome> {
    const existing = await tx.canonicalDeal.findUnique({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
    });
    const data = {
      dealName: record.dealName,
      stage: record.stage,
      amountMinor: record.amount ? BigInt(record.amount.amountMinor) : null,
      currency: record.amount?.currency ?? null,
      pipeline: record.pipeline,
      closeDate: record.closeDate,
      primaryContactSourceId: record.primaryContactSourceId,
      sourceCreatedAt: record.sourceCreatedAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      syncedAt: new Date(),
      raw: record.raw as Prisma.InputJsonValue,
    };
    await tx.canonicalDeal.upsert({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
      create: { provider: record.provider, sourceId: record.sourceId, ...data },
      update: data,
    });
    return classifyOutcome(existing?.sourceUpdatedAt ?? null, record.sourceUpdatedAt);
  }

  private async upsertEvent(
    tx: Tx,
    record: Extract<CanonicalRecord, { kind: 'event' }>,
  ): Promise<Outcome> {
    const existing = await tx.canonicalEvent.findUnique({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
    });
    const data = {
      title: record.title,
      description: record.description,
      location: record.location,
      startAt: record.start,
      endAt: record.end,
      timezone: record.timezone,
      status: record.status,
      organizerEmail: record.organizerEmail,
      attendees: record.attendees as unknown as Prisma.InputJsonValue,
      isRecurring: record.isRecurring,
      recurringEventSourceId: record.recurringEventSourceId,
      sourceCreatedAt: record.sourceCreatedAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      syncedAt: new Date(),
      raw: record.raw as Prisma.InputJsonValue,
    };
    await tx.canonicalEvent.upsert({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
      create: { provider: record.provider, sourceId: record.sourceId, ...data },
      update: data,
    });
    return classifyOutcome(existing?.sourceUpdatedAt ?? null, record.sourceUpdatedAt);
  }

  private async upsertPayment(
    tx: Tx,
    record: Extract<CanonicalRecord, { kind: 'payment' }>,
  ): Promise<Outcome> {
    const existing = await tx.canonicalPayment.findUnique({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
    });
    const data = {
      amountMinor: BigInt(record.amount.amountMinor),
      currency: record.amount.currency,
      rawStatus: record.rawStatus,
      canonicalStatus: record.canonicalStatus,
      customerRef: record.customerRef,
      occurredAt: record.occurredAt,
      description: record.description,
      sourceCreatedAt: record.sourceCreatedAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      syncedAt: new Date(),
      raw: record.raw as Prisma.InputJsonValue,
    };
    await tx.canonicalPayment.upsert({
      where: { provider_source_id: { provider: record.provider, sourceId: record.sourceId } },
      create: { provider: record.provider, sourceId: record.sourceId, ...data },
      update: data,
    });
    return classifyOutcome(existing?.sourceUpdatedAt ?? null, record.sourceUpdatedAt);
  }
}

function classifyOutcome(existingUpdatedAt: Date | null, incomingUpdatedAt: Date | null): Outcome {
  if (existingUpdatedAt === null) return 'created';
  if (incomingUpdatedAt === null) return 'updated';
  return existingUpdatedAt.getTime() === incomingUpdatedAt.getTime() ? 'unchanged' : 'updated';
}
