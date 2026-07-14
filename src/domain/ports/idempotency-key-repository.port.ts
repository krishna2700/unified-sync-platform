export type IdempotencyClaimResult =
  | { status: 'claimed' }
  | { status: 'in_progress' }
  | { status: 'completed'; storedResult: unknown };

/**
 * Generic idempotency ledger for client-initiated mutating operations (e.g. `POST /sync/trigger`
 * with an `Idempotency-Key` header), distinct from WebhookEventRepository which is specific to
 * inbound provider webhook deliveries. Same pattern Stripe's own API uses.
 */
export interface IdempotencyKeyRepository {
  claim(key: string, scope: string): Promise<IdempotencyClaimResult>;
  complete(key: string, scope: string, result: unknown): Promise<void>;
  release(key: string, scope: string): Promise<void>;
}
