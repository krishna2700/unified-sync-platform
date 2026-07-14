import type { CanonicalRecordBase } from './canonical-record.base.js';

export interface CanonicalContact extends CanonicalRecordBase {
  kind: 'contact';
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  lifecycleStage: string | null;
}
