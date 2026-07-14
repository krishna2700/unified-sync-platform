import type { EntityType } from '../value-objects/entity-type.js';
import type { ProviderId } from '../value-objects/provider.js';
import type { SyncCursor } from '../value-objects/sync-cursor.js';

export interface CursorRepository {
  get(provider: ProviderId, entityType: EntityType): Promise<SyncCursor | null>;
  save(provider: ProviderId, entityType: EntityType, cursor: SyncCursor): Promise<void>;
  /** Forces the next run to perform a full backfill (used after a fallback resolves). */
  clear(provider: ProviderId, entityType: EntityType): Promise<void>;
}
