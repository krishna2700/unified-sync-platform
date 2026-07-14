import { DomainValidationError } from '../errors/domain-validation-error.js';

export interface SyncCursorProps {
  /** Opaque, provider-specific cursor payload (page token, syncToken, watermark timestamp...). */
  token: string;
  issuedAt: Date;
  /** Provider-declared hard expiry, when the provider tells us one (e.g. Google syncToken TTL). */
  expiresAt: Date | null;
}

/**
 * SyncCursor is deliberately opaque to everything except the provider adapter that issued it —
 * the sync engine only ever calls `.isStale()` / `.isExpired()` and passes the token back verbatim.
 * This lets each provider encode whatever cursor shape it needs (a Google syncToken, a HubSpot
 * "after" pagination key + lastmodifieddate watermark serialized as JSON, a Stripe object id for
 * `starting_after`) without leaking provider concepts into the domain layer.
 */
export class SyncCursor {
  private constructor(private readonly props: SyncCursorProps) {}

  static issue(
    token: string,
    issuedAt: Date = new Date(),
    expiresAt: Date | null = null,
  ): SyncCursor {
    if (!token || token.trim().length === 0) {
      throw new DomainValidationError('SyncCursor token must be a non-empty string');
    }
    return new SyncCursor({ token, issuedAt, expiresAt });
  }

  static rehydrate(props: SyncCursorProps): SyncCursor {
    return new SyncCursor(props);
  }

  get token(): string {
    return this.props.token;
  }

  get issuedAt(): Date {
    return this.props.issuedAt;
  }

  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.props.expiresAt !== null && now.getTime() >= this.props.expiresAt.getTime();
  }

  /** Policy-based staleness: even without a provider-declared expiry, a cursor sitting unused
   * too long is untrustworthy (the provider's change log may have rolled off). */
  isStale(maxAgeMs: number, now: Date = new Date()): boolean {
    if (this.isExpired(now)) return true;
    return now.getTime() - this.props.issuedAt.getTime() > maxAgeMs;
  }

  toJSON(): SyncCursorProps {
    return { ...this.props };
  }
}
