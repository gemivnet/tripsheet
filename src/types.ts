/**
 * Canonical kinds for itinerary items. `kind` is stored as TEXT in SQLite;
 * this union is the source of truth for what's valid.
 */
export type ItemKind =
  | 'meal'
  | 'reservation'
  | 'checkin'
  | 'checkout'
  | 'activity'
  | 'package'
  | 'option'
  | 'note'
  | 'transit';

export const ITEM_KINDS: readonly ItemKind[] = [
  'meal',
  'reservation',
  'checkin',
  'checkout',
  'activity',
  'package',
  'option',
  'note',
  'transit',
] as const;

export type SuggestionKind =
  | 'add_item'
  | 'modify_item'
  | 'remove_item'
  | 'move_item'
  | 'note';

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export type ReferenceDocKind =
  | 'past_itinerary'
  | 'journal'
  | 'external_itinerary'
  | 'confirmation'
  | 'other';

export type ParseStatus = 'pending' | 'running' | 'complete' | 'error';

export interface UserRow {
  id: number;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: string;
}

export interface TripRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  destination: string | null;
  goals: string | null;
  notes: string | null;
  default_tz: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: number;
  trip_id: number;
  day_date: string;
  kind: ItemKind;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  url: string | null;
  confirmation: string | null;
  hours: string | null;
  cost: string | null;
  notes: string | null;
  sort_order: number;
  created_by: number | null;
  source_doc_id: number | null;
  tz: string | null;
  end_tz: string | null;
  attributes_json: string;
  created_at: string;
  updated_at: string;
}

export interface SuggestionCitation {
  url: string;
  title: string;
}

export interface SuggestionRow {
  id: number;
  trip_id: number;
  batch_id: string;
  kind: SuggestionKind;
  target_item_id: number | null;
  payload_json: string;
  rationale: string;
  citations_json: string;
  status: SuggestionStatus;
  decided_by: number | null;
  decided_at: string | null;
  created_at: string;
}

export interface ReferenceDocRow {
  id: number;
  trip_id: number | null;
  title: string;
  kind: ReferenceDocKind;
  source_filename: string;
  stored_filename: string;
  parsed_summary: string | null;
  parse_status: ParseStatus;
  parse_error: string | null;
  parsed_trip_json: string | null;
  derived_trip_id: number | null;
  uploaded_by: number;
  uploaded_at: string;
}

export interface ParsedTripMeta {
  name: string;
  start_date: string;
  end_date: string;
  destination: string | null;
}

export interface ReferenceItemRow {
  id: number;
  doc_id: number;
  day_offset: number | null;
  kind: string;
  title: string;
  location: string | null;
  notes: string | null;
  tags_json: string;
}

export interface ParticipantRow {
  id: number;
  trip_id: number;
  user_id: number | null;
  display_name: string;
  color_hue: number | null;
  notes: string | null;
  created_at: string;
}

export interface CommentRow {
  id: number;
  item_id: number;
  user_id: number;
  body: string;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  user_id: number;
  entity: 'trip' | 'item' | 'suggestion' | 'comment' | 'doc';
  entity_id: number;
  action: 'create' | 'update' | 'delete' | 'accept' | 'reject';
  diff_json: string | null;
  created_at: string;
}

export interface SessionUser {
  id: number;
  email: string;
  display_name: string;
}

// cookie-session's types expose the session object shape via the global
// CookieSessionInterfaces namespace; augment that so `req.session.userId`
// is typed across the app.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace CookieSessionInterfaces {
    interface CookieSessionObject {
      userId?: number;
    }
  }
}
