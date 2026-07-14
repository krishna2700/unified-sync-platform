import Stripe from 'stripe';
import type { CanonicalPayment } from '../../domain/entities/canonical-payment.js';
import type { PaymentStatusMapper } from '../../domain/ports/payment-status-mapper.port.js';
import type {
  ProviderFetchResult,
  ProviderHealth,
  SyncProvider,
  ValidationResult,
} from '../../domain/ports/sync-provider.port.js';
import { EntityType } from '../../domain/value-objects/entity-type.js';
import { Money } from '../../domain/value-objects/money.js';
import { ProviderId } from '../../domain/value-objects/provider.js';
import { SyncCursor } from '../../domain/value-objects/sync-cursor.js';
import { decodePageToken, encodePageToken } from '../shared/page-token-codec.js';
import type { StripeConfig } from './stripe-config.js';
import { mapStripeError } from './stripe-errors.js';

interface StripePageState {
  startingAfter: string | null;
  maxCreatedSeenUnix: number;
}

const PAGE_SIZE = 100;

/**
 * Stripe as the "Payment Processor" provider, using PaymentIntents (whose `status` field is
 * literally "succeeded", matching the assignment's own example vocabulary). Stripe has no
 * syncToken/cursor concept, so incremental sync is watermark-based: filter `created >= cursor`,
 * tracking the running max `created` seen across pages through the opaque pageToken (Stripe
 * paginates via `starting_after`, oldest-safe overlap on the boundary timestamp is accepted
 * because upserts are idempotent).
 *
 * Important limitation, by design: `created` never changes after a PaymentIntent is created, so
 * polling by `created` alone would never notice a status transition (e.g. pending -> succeeded)
 * on an intent created *before* the current watermark. That gap is intentionally covered by the
 * Stripe webhook handler (src/application/webhooks), which re-normalizes and upserts the intent
 * the moment its status changes, using this same `normalize()` — see docs/adr/0005-stripe-incremental-strategy.md.
 */
export class StripePaymentProvider implements SyncProvider<Stripe.PaymentIntent> {
  readonly providerId = ProviderId.STRIPE;
  readonly entityType = EntityType.PAYMENT;

  private readonly stripe: Stripe;

  constructor(
    config: StripeConfig,
    private readonly statusMapper: PaymentStatusMapper,
    stripeClient?: Stripe,
  ) {
    this.stripe = stripeClient ?? new Stripe(config.secretKey);
  }

  async fetchIncremental(
    cursor: SyncCursor,
    pageToken: string | null,
  ): Promise<ProviderFetchResult<Stripe.PaymentIntent>> {
    const watermarkUnix = Number(cursor.token);
    const decoded = decodePageToken<StripePageState>(pageToken) ?? {
      startingAfter: null,
      maxCreatedSeenUnix: watermarkUnix,
    };
    try {
      const page = await this.stripe.paymentIntents.list({
        limit: PAGE_SIZE,
        starting_after: decoded.startingAfter ?? undefined,
        created: { gte: watermarkUnix },
      });
      return this.toFetchResult(page, decoded.maxCreatedSeenUnix);
    } catch (error) {
      throw mapStripeError(error, this.entityType);
    }
  }

  async fetchFull(pageToken: string | null): Promise<ProviderFetchResult<Stripe.PaymentIntent>> {
    const decoded = decodePageToken<StripePageState>(pageToken) ?? {
      startingAfter: null,
      maxCreatedSeenUnix: 0,
    };
    try {
      const page = await this.stripe.paymentIntents.list({
        limit: PAGE_SIZE,
        starting_after: decoded.startingAfter ?? undefined,
      });
      return this.toFetchResult(page, decoded.maxCreatedSeenUnix);
    } catch (error) {
      throw mapStripeError(error, this.entityType);
    }
  }

  private toFetchResult(
    page: Stripe.ApiList<Stripe.PaymentIntent>,
    priorMaxCreatedUnix: number,
  ): ProviderFetchResult<Stripe.PaymentIntent> {
    const maxCreatedSeenUnix = page.data.reduce(
      (max, intent) => Math.max(max, intent.created),
      priorMaxCreatedUnix,
    );
    const lastRecord = page.data[page.data.length - 1];

    if (page.has_more && lastRecord) {
      return {
        records: page.data,
        nextPageToken: encodePageToken<StripePageState>({
          startingAfter: lastRecord.id,
          maxCreatedSeenUnix,
        }),
        nextCursor: null,
        hasMore: true,
      };
    }
    return {
      records: page.data,
      nextPageToken: null,
      nextCursor: SyncCursor.issue(String(maxCreatedSeenUnix)),
      hasMore: false,
    };
  }

  normalize(raw: Stripe.PaymentIntent): CanonicalPayment {
    const occurredAt = new Date(raw.created * 1000);
    return {
      kind: 'payment',
      id: null,
      provider: this.providerId,
      sourceId: raw.id,
      amount: Money.of(raw.amount, raw.currency),
      rawStatus: raw.status,
      canonicalStatus: this.statusMapper.map(this.providerId, raw.status),
      customerRef: typeof raw.customer === 'string' ? raw.customer : (raw.customer?.id ?? null),
      occurredAt,
      description: raw.description ?? null,
      sourceCreatedAt: occurredAt,
      // PaymentIntents expose no generic "last updated" timestamp via the REST API; the webhook
      // path (which fires per status transition) sets this more precisely at ingestion time.
      sourceUpdatedAt: occurredAt,
      syncedAt: null,
      raw: raw as unknown as Record<string, unknown>,
    };
  }

  validate(record: CanonicalPayment): ValidationResult {
    const issues: ValidationResult['issues'] = [];
    if (!record.sourceId) issues.push({ field: 'sourceId', message: 'sourceId is required' });
    if (record.amount.amountMinor < 0)
      issues.push({ field: 'amount', message: 'amount must be non-negative' });
    return { valid: issues.length === 0, issues };
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.stripe.paymentIntents.list({ limit: 1 });
      return { healthy: true, checkedAt: new Date() };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        checkedAt: new Date(),
      };
    }
  }
}
