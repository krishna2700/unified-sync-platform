import type { SyncProvider } from '../../domain/ports/sync-provider.port.js';
import type { EntityType } from '../../domain/value-objects/entity-type.js';
import type { ProviderId } from '../../domain/value-objects/provider.js';

function key(provider: ProviderId, entityType: EntityType): string {
  return `${provider}::${entityType}`;
}

/**
 * Factory/registry for every (provider, entityType) sync unit the engine knows about. The
 * engine iterates this registry and never references a concrete provider by name — onboarding a
 * new provider or a new entity type for an existing provider is exactly one `register()` call in
 * the composition root (src/api/composition-root.ts), nothing in application/domain changes.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, SyncProvider>();

  register(provider: SyncProvider): this {
    const k = key(provider.providerId, provider.entityType);
    if (this.providers.has(k)) {
      throw new Error(`Provider already registered for ${k}`);
    }
    this.providers.set(k, provider);
    return this;
  }

  get(provider: ProviderId, entityType: EntityType): SyncProvider | undefined {
    return this.providers.get(key(provider, entityType));
  }

  all(): SyncProvider[] {
    return [...this.providers.values()];
  }
}
