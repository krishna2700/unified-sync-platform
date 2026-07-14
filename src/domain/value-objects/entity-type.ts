export const EntityType = {
  CONTACT: 'contact',
  DEAL: 'deal',
  EVENT: 'event',
  PAYMENT: 'payment',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export function isEntityType(value: string): value is EntityType {
  return Object.values(EntityType).includes(value as EntityType);
}
