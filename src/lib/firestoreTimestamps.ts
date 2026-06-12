import type { Timestamp } from '@google-cloud/firestore';

export type TimestampLike =
  | Timestamp
  | { toDate(): Date }
  | Date
  | string
  | null
  | undefined;

export function timestampToIso(value: TimestampLike): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate().toISOString();
  }
  return undefined;
}

export function timestampToDate(value: TimestampLike): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }
  throw new Error('Unexpected timestamp payload');
}
