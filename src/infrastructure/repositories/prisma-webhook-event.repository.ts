import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  WebhookEventRecord,
  WebhookEventRepository,
  WebhookInsertOutcome,
  WebhookProcessingStatus,
} from '../../domain/ports/webhook-event-repository.port.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export class PrismaWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Relies on the DB-level UNIQUE(idempotency_key) constraint, not an app-level check-then-insert
   * (which would race under concurrent duplicate deliveries). A unique-violation on insert means
   * "already seen" — that IS the duplicate-detection mechanism. */
  async recordIfNew(event: WebhookEventRecord): Promise<WebhookInsertOutcome> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          idempotencyKey: event.idempotencyKey,
          provider: event.provider,
          eventType: event.eventType,
          payload: event.payload as Prisma.InputJsonValue,
          receivedAt: event.receivedAt,
        },
      });
      return 'inserted';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async getProcessingStatus(idempotencyKey: string): Promise<WebhookProcessingStatus | null> {
    const row = await this.prisma.webhookEvent.findUnique({
      where: { idempotencyKey },
      select: { processingStatus: true },
    });
    return (row?.processingStatus as WebhookProcessingStatus | undefined) ?? null;
  }

  async markProcessed(
    idempotencyKey: string,
    status: 'processed' | 'failed',
    error?: string,
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { idempotencyKey },
      data: { processingStatus: status, processedAt: new Date(), error: error ?? null },
    });
  }
}
