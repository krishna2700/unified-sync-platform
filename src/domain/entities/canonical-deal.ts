import type { CanonicalRecordBase } from './canonical-record.base.js';
import type { Money } from '../value-objects/money.js';

export interface CanonicalDeal extends CanonicalRecordBase {
  kind: 'deal';
  dealName: string;
  stage: string;
  amount: Money | null;
  pipeline: string | null;
  closeDate: Date | null;
  primaryContactSourceId: string | null;
}
