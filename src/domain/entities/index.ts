import type { CanonicalContact } from './canonical-contact.js';
import type { CanonicalDeal } from './canonical-deal.js';
import type { CanonicalEvent } from './canonical-event.js';
import type { CanonicalPayment } from './canonical-payment.js';

export type { CanonicalContact } from './canonical-contact.js';
export type { CanonicalDeal } from './canonical-deal.js';
export type { CanonicalEvent, CalendarAttendee, CalendarEventStatus } from './canonical-event.js';
export type { CanonicalPayment } from './canonical-payment.js';
export type { CanonicalRecordBase } from './canonical-record.base.js';

export type CanonicalRecord = CanonicalContact | CanonicalDeal | CanonicalEvent | CanonicalPayment;

export function isContact(record: CanonicalRecord): record is CanonicalContact {
  return record.kind === 'contact';
}
export function isDeal(record: CanonicalRecord): record is CanonicalDeal {
  return record.kind === 'deal';
}
export function isCalendarEvent(record: CanonicalRecord): record is CanonicalEvent {
  return record.kind === 'event';
}
export function isPayment(record: CanonicalRecord): record is CanonicalPayment {
  return record.kind === 'payment';
}
