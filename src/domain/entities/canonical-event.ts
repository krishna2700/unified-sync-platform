import type { CanonicalRecordBase } from './canonical-record.base.js';

export const CalendarEventStatus = {
  CONFIRMED: 'confirmed',
  TENTATIVE: 'tentative',
  CANCELLED: 'cancelled',
} as const;
export type CalendarEventStatus = (typeof CalendarEventStatus)[keyof typeof CalendarEventStatus];

export interface CalendarAttendee {
  email: string;
  responseStatus: string | null;
}

export interface CanonicalEvent extends CanonicalRecordBase {
  kind: 'event';
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  timezone: string | null;
  status: CalendarEventStatus;
  organizerEmail: string | null;
  attendees: CalendarAttendee[];
  isRecurring: boolean;
  recurringEventSourceId: string | null;
}
