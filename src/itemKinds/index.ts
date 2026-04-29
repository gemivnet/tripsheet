import { z } from 'zod';
import type { ItemKind } from '../types.js';
import { tzForIata } from './iataTz.js';
import { normalizeAirlineCode, formatFlightNumber } from './airlines.js';

/**
 * Per-kind item schemas. Each `ItemKindDef` declares a Zod schema for
 * the kind's optional structured attributes (stored in
 * `items.attributes_json`), the form metadata so the React form can
 * render itself, and an optional `derive` function that backfills
 * top-level fields (tz, start_time, location, hours, …) from the
 * richer attribute fields when the user hasn't set them explicitly.
 *
 * Adding a new kind:
 *   1. Add the kind to ItemKind in src/types.ts
 *   2. Define a ItemKindDef here and register it in `KINDS`
 *   3. Optionally extend the IATA table in iataTz.ts
 * No DB migration is needed — attributes live in JSON.
 */

export type FieldType = 'text' | 'time' | 'date' | 'number' | 'iata' | 'tz' | 'select';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  // When set, the form shows a hint that this field is auto-derived
  // from another (so the user knows to fill the source instead).
  derivesFrom?: string;
}

export interface DerivedFields {
  tz?: string | null;
  end_tz?: string | null;
  day_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  title?: string | null;
  location?: string | null;
  hours?: string | null;
  cost?: string | null;
  confirmation?: string | null;
}

export interface ItemKindDef {
  /** The canonical ItemKind this definition extends. */
  kind: ItemKind;
  /** Discriminator for kinds that share an ItemKind but render different forms. */
  subtype: string;
  /** Display label for the form heading. */
  label: string;
  /** A short hint shown beneath the heading. */
  hint?: string;
  /**
   * If true, the generic "Time" field at the top of the editor is hidden
   * because this kind owns its own time input(s). Avoids redundant
   * top-level + per-kind time fields (e.g. flight has departure_time).
   */
  ownsTime?: boolean;
  /**
   * If true, the generic "Title" field is hidden in the editor and the
   * derived title from the kind's structured fields wins on save. Use
   * for kinds where the structured attributes fully determine the
   * canonical name (flight: "ANA NH109 · ORD → LAX"; check-in:
   * property name; meal: "Dinner · Joe's").
   */
  derivesTitle?: boolean;
  /**
   * If true, the generic "Location" field is hidden in the editor and
   * the derived location from the kind's structured fields wins on
   * save. Use for kinds where address/venue/operator IS the location.
   */
  derivesLocation?: boolean;
  /** Form fields, in render order. */
  fields: FieldDef[];
  /** Zod schema validating the attributes blob. All fields optional. */
  attrs: z.ZodType<Record<string, unknown>>;
  /**
   * Optional canonicalization pass over the attributes blob. Runs after
   * Zod parsing and before `derive()`. Use to fold known free-text
   * synonyms onto a canonical form (e.g. airline name → IATA code,
   * "AA2364" → "AA 2364"). Must be idempotent.
   */
  normalizeAttrs?: (attrs: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Compute base-item fields from attributes. Returned fields are
   * applied to the item only when the corresponding base field is
   * empty — user authoring always wins over derivation.
   *
   * `base` carries the item's current top-level fields so that kinds
   * which don't own their time (e.g. activity) can still derive
   * `end_time` from `base.start_time + attrs.duration_min`.
   */
  derive?: (attrs: Record<string, unknown>, base?: { start_time?: string | null }) => DerivedFields;
}

// ─── flight ─────────────────────────────────────────────────────────────────

const FlightAttrs = z.object({
  airline: z.string().max(100).optional(),
  flight_number: z.string().max(20).optional(),
  cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
  departure_airport: z.string().max(4).optional(),  // IATA
  departure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  departure_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  arrival_airport: z.string().max(4).optional(),
  arrival_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  arrival_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  seat: z.string().max(10).optional(),
  // confirmation kept in schema for backcompat (old data), but the base
  // item confirmation column is canonical — see derive() below.
  confirmation: z.string().max(40).optional(),
}).partial();

const flight: ItemKindDef = {
  kind: 'transit',
  subtype: 'flight',
  label: 'Flight',
  ownsTime: true,
  derivesTitle: true,
  derivesLocation: true,
  hint: 'Time zones auto-fill from IATA codes. Departure date/time drive the item\'s position on the timeline.',
  fields: [
    { name: 'airline',           label: 'Airline',           type: 'text',   placeholder: 'e.g. ANA, Delta' },
    { name: 'flight_number',     label: 'Flight number',     type: 'text',   placeholder: 'e.g. NH109' },
    { name: 'cabin',             label: 'Cabin',             type: 'select', options: ['economy', 'premium_economy', 'business', 'first'] },
    { name: 'departure_airport', label: 'Departure airport', type: 'iata',   placeholder: 'e.g. LAX' },
    { name: 'departure_date',    label: 'Departure date',    type: 'date' },
    { name: 'departure_time',    label: 'Departure time',    type: 'time' },
    { name: 'arrival_airport',   label: 'Arrival airport',   type: 'iata',   placeholder: 'e.g. NRT' },
    { name: 'arrival_date',      label: 'Arrival date',      type: 'date' },
    { name: 'arrival_time',      label: 'Arrival time',      type: 'time' },
    { name: 'seat',              label: 'Seat',              type: 'text',   placeholder: 'e.g. 32A' },
    // Confirmation # is the base item field — shown in top-level form, not duplicated here.
  ],
  attrs: FlightAttrs,
  normalizeAttrs(attrs) {
    const a = { ...attrs } as z.infer<typeof FlightAttrs>;
    // Fold airline (free text) → IATA code, and reformat flight_number
    // as "XX 1234" so timeline display is uniform regardless of how the
    // user typed it. Idempotent.
    const code = normalizeAirlineCode(a.airline ?? null);
    if (code) a.airline = code;
    const formatted = formatFlightNumber(a.airline ?? null, a.flight_number ?? null);
    if (formatted) {
      // formatFlightNumber returns "XX 1234" — split off the prefix when
      // it matches the (now-normalized) airline so we don't double-store.
      const m = formatted.match(/^([A-Z0-9]{2,3})\s+(\d+)$/i);
      if (m) {
        a.airline = a.airline ?? m[1];
        a.flight_number = m[2];
      } else {
        a.flight_number = formatted;
      }
    }
    // Uppercase IATA airport codes.
    if (a.departure_airport) a.departure_airport = a.departure_airport.toUpperCase();
    if (a.arrival_airport) a.arrival_airport = a.arrival_airport.toUpperCase();
    return a as Record<string, unknown>;
  },
  derive(attrs) {
    const a = attrs as z.infer<typeof FlightAttrs>;
    const tz = tzForIata(a.departure_airport ?? null);
    const end_tz = tzForIata(a.arrival_airport ?? null);
    const route = a.departure_airport && a.arrival_airport
      ? `${a.departure_airport} → ${a.arrival_airport}`
      : null;
    const flightCode = formatFlightNumber(a.airline ?? null, a.flight_number ?? null);
    const title = route
      ? (flightCode ? `${flightCode} · ${route}` : route)
      : (flightCode || null);
    return {
      tz, end_tz,
      day_date: a.departure_date ?? null,
      start_time: a.departure_time ?? null,
      end_time: a.arrival_time ?? null,
      title,
      location: route,
      // Bridge: old items may have stored confirmation inside attributes_json.
      confirmation: a.confirmation ?? null,
    };
  },
};

// ─── lodging (checkin / checkout) ───────────────────────────────────────────

const LodgingAttrs = z.object({
  property_name: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  room_type: z.string().max(100).optional(),
  party_size: z.number().int().min(1).max(20).optional(),
  policy_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  confirmation: z.string().max(40).optional(),
  rate: z.string().max(40).optional(),  // free text — currencies + caveats
  cancellation: z.string().max(200).optional(),
}).partial();

function buildLodging(kind: 'checkin' | 'checkout', label: string, hint: string): ItemKindDef {
  return {
    kind,
    subtype: 'lodging',
    label,
    hint,
    // policy_time drives the item's timeline position (ownsTime), so the
    // generic "Time" field is hidden to avoid showing the same value twice.
    ownsTime: true,
    derivesTitle: true,
    derivesLocation: true,
    fields: [
      { name: 'property_name', label: 'Property',         type: 'text', placeholder: 'Hotel / rental name' },
      { name: 'address',       label: 'Address',          type: 'text' },
      { name: 'room_type',     label: 'Room',             type: 'text', placeholder: 'e.g. King with view' },
      { name: 'party_size',    label: 'Party size',       type: 'number' },
      { name: 'policy_time',   label: kind === 'checkin' ? 'Earliest check-in' : 'Latest check-out', type: 'time' },
      { name: 'rate',          label: 'Nightly rate',     type: 'text' },
      // Confirmation # is the base item field — shown in top-level form, not duplicated here.
      { name: 'cancellation',  label: 'Cancellation',     type: 'text', placeholder: 'e.g. Free until 48h before' },
    ],
    attrs: LodgingAttrs,
    derive(attrs) {
      const a = attrs as z.infer<typeof LodgingAttrs>;
      const property = a.property_name ?? a.address ?? null;
      const action = kind === 'checkin' ? 'Check-in' : 'Check-out';
      return {
        title: property ? `${action} · ${property}` : action,
        location: property,
        start_time: a.policy_time ?? null,
        cost: a.rate ?? null,
        // Bridge: old items may have stored confirmation inside attributes_json.
        confirmation: a.confirmation ?? null,
      };
    },
  };
}
const checkin = buildLodging('checkin', 'Check-in', 'Check-in time sets the earliest arrival on the timeline.');
const checkout = buildLodging('checkout', 'Check-out', 'Check-out time sets the latest departure on the timeline.');

// ─── meal ───────────────────────────────────────────────────────────────────

const MealAttrs = z.object({
  meal_type: z.enum(['breakfast', 'brunch', 'lunch', 'dinner', 'late-night', 'snack', 'drinks']).optional(),
  venue_name: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  cuisine: z.string().max(60).optional(),
  party_size: z.number().int().min(1).max(50).optional(),
  price_level: z.enum(['$', '$$', '$$$', '$$$$']).optional(),
  dress_code: z.string().max(60).optional(),
}).partial();

const meal: ItemKindDef = {
  kind: 'meal',
  subtype: 'meal',
  label: 'Meal',
  derivesTitle: true,
  derivesLocation: true,
  hint: 'Breakfast, lunch, dinner, drinks. Time + reservation are both optional.',
  fields: [
    { name: 'meal_type',   label: 'Which meal',   type: 'select', options: ['breakfast', 'brunch', 'lunch', 'dinner', 'late-night', 'snack', 'drinks'] },
    { name: 'venue_name',  label: 'Venue',        type: 'text', placeholder: 'Optional' },
    { name: 'address',     label: 'Address',      type: 'text' },
    { name: 'cuisine',     label: 'Cuisine',      type: 'text', placeholder: 'e.g. Italian, ramen' },
    { name: 'party_size',  label: 'Party of',     type: 'number' },
    { name: 'price_level', label: 'Price',        type: 'select', options: ['$', '$$', '$$$', '$$$$'] },
    { name: 'dress_code',  label: 'Dress code',   type: 'text' },
    // Confirmation # is the base item field — set it if you have a reservation, leave blank otherwise.
  ],
  attrs: MealAttrs,
  derive(attrs) {
    const a = attrs as z.infer<typeof MealAttrs>;
    const mealLabel = a.meal_type
      ? a.meal_type[0].toUpperCase() + a.meal_type.slice(1)
      : 'Meal';
    return {
      title: a.venue_name ? `${mealLabel} · ${a.venue_name}` : mealLabel,
      location: a.venue_name ?? a.address ?? null,
    };
  },
};

// ─── reservation (tour / show / spa / non-meal booking) ─────────────────────

const ReservationAttrs = z.object({
  venue_name: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  category: z.string().max(60).optional(),  // cuisine, tour type, etc.
  party_size: z.number().int().min(1).max(50).optional(),
  // reservation_number kept in schema for backcompat — base confirmation column is canonical.
  reservation_number: z.string().max(40).optional(),
  opens_at: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closes_at: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  price_level: z.enum(['$', '$$', '$$$', '$$$$']).optional(),
  dress_code: z.string().max(60).optional(),
}).partial();

const reservation: ItemKindDef = {
  kind: 'reservation',
  subtype: 'reservation',
  label: 'Reservation',
  derivesLocation: true,
  hint: 'Tours, shows, spa, non-meal bookings. For meals, use the Meal kind instead.',
  fields: [
    { name: 'venue_name',  label: 'Venue',        type: 'text' },
    { name: 'address',     label: 'Address',      type: 'text' },
    { name: 'category',    label: 'Category',     type: 'text', placeholder: 'e.g. Italian, walking tour' },
    { name: 'party_size',  label: 'Party of',     type: 'number' },
    { name: 'opens_at',    label: 'Venue opens',  type: 'time' },
    { name: 'closes_at',   label: 'Venue closes', type: 'time' },
    { name: 'price_level', label: 'Price',        type: 'select', options: ['$', '$$', '$$$', '$$$$'] },
    { name: 'dress_code',  label: 'Dress code',   type: 'text' },
    // Confirmation # is the base item field — shown in top-level form, not duplicated here.
  ],
  attrs: ReservationAttrs,
  derive(attrs) {
    const a = attrs as z.infer<typeof ReservationAttrs>;
    const hours = a.opens_at && a.closes_at ? `${a.opens_at}–${a.closes_at}` : null;
    return {
      location: a.venue_name ?? a.address ?? null,
      hours,
      // Bridge: old items may have stored reservation_number inside attributes_json.
      confirmation: a.reservation_number ?? null,
    };
  },
};

// ─── activity ───────────────────────────────────────────────────────────────

const ActivityAttrs = z.object({
  venue_name: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  opens_at: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closes_at: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  ticket_required: z.boolean().optional(),
  price: z.string().max(40).optional(),
  duration_min: z.number().int().min(1).max(1440).optional(),
}).partial();

const activity: ItemKindDef = {
  kind: 'activity',
  subtype: 'activity',
  label: 'Activity',
  derivesLocation: true,
  hint: 'Duration auto-fills end time. Opens/Closes are venue hours, not your visit time.',
  fields: [
    { name: 'venue_name',      label: 'Place',           type: 'text' },
    { name: 'address',         label: 'Address',         type: 'text' },
    { name: 'opens_at',        label: 'Venue opens',     type: 'time' },
    { name: 'closes_at',       label: 'Venue closes',    type: 'time' },
    { name: 'ticket_required', label: 'Ticket required', type: 'select', options: ['no', 'yes'] },
    { name: 'price',           label: 'Price',           type: 'text' },
    { name: 'duration_min',    label: 'Duration (min)',  type: 'number', placeholder: 'e.g. 90' },
  ],
  attrs: ActivityAttrs,
  derive(attrs, base) {
    const a = attrs as z.infer<typeof ActivityAttrs>;
    const hours = a.opens_at && a.closes_at ? `${a.opens_at}–${a.closes_at}` : null;
    // Compute end_time from start_time + duration_min when both are available.
    let end_time: string | null = null;
    const startTime = base?.start_time ?? null;
    if (startTime && a.duration_min && a.duration_min > 0) {
      const [h, m] = startTime.split(':').map(Number);
      const totalMin = h * 60 + m + a.duration_min;
      end_time = `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
    }
    return {
      location: a.venue_name ?? a.address ?? null,
      hours,
      cost: a.price ?? null,
      ...(end_time ? { end_time } : {}),
    };
  },
};

// ─── package (multi-day all-inclusive: tour, cruise, retreat, resort) ───────

const PackageAttrs = z.object({
  operator: z.string().max(200).optional(),  // tour company / resort / cruise line
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  includes_lodging: z.enum(['yes', 'no']).optional(),
  includes_meals: z.enum(['yes', 'no', 'some']).optional(),
  meal_plan: z.string().max(200).optional(),  // free-form: "All meals included", "Breakfast only", etc.
  price: z.string().max(40).optional(),
  cancellation: z.string().max(200).optional(),
}).partial();

const packageDef: ItemKindDef = {
  kind: 'package',
  subtype: 'package',
  label: 'Multi-day package',
  derivesLocation: true,
  hint: 'Tours, cruises, all-inclusive resorts, retreats. Spans multiple days; can include lodging and meals.',
  fields: [
    { name: 'operator',         label: 'Operator',          type: 'text',   placeholder: 'Tour company / resort / cruise line' },
    { name: 'end_date',         label: 'End date',          type: 'date' },
    { name: 'end_time',         label: 'End time',          type: 'time' },
    { name: 'includes_lodging', label: 'Lodging included?', type: 'select', options: ['yes', 'no'] },
    { name: 'includes_meals',   label: 'Meals included?',   type: 'select', options: ['yes', 'no', 'some'] },
    { name: 'meal_plan',        label: 'Meal plan',         type: 'text',   placeholder: 'e.g. All meals · Breakfast only' },
    { name: 'price',            label: 'Price',             type: 'text' },
    { name: 'cancellation',     label: 'Cancellation',      type: 'text' },
  ],
  attrs: PackageAttrs,
  derive(attrs) {
    const a = attrs as z.infer<typeof PackageAttrs>;
    return {
      location: a.operator ?? null,
      end_time: a.end_time ?? null,
    };
  },
};

// ─── option / note (no extra fields beyond the common base) ─────────────────

const optionDef: ItemKindDef = {
  kind: 'option', subtype: 'option', label: 'Option',
  hint: 'A "we could do this" idea, untimed and unbooked.',
  fields: [], attrs: z.object({}).strict(),
};
const noteDef: ItemKindDef = {
  kind: 'note', subtype: 'note', label: 'Note',
  hint: 'A reminder, journal entry, or context for the day.',
  fields: [], attrs: z.object({}).strict(),
};

// ─── registry ───────────────────────────────────────────────────────────────

export const KINDS: ItemKindDef[] = [
  flight, checkin, checkout, meal, reservation, activity, packageDef, optionDef, noteDef,
];

const BY_KIND: Record<string, ItemKindDef> = Object.fromEntries(
  KINDS.map((k) => [k.kind, k]),
);

export function defForKind(kind: ItemKind): ItemKindDef {
  return BY_KIND[kind] ?? noteDef;
}

/**
 * Validate an attributes blob against its kind's schema. On failure
 * returns `{}` (lenient — bad attrs shouldn't block the user from
 * saving the rest of the item); the strict schema is used at the
 * routes layer to surface validation issues to the UI.
 */
export function safeParseAttrs(kind: ItemKind, raw: unknown): Record<string, unknown> {
  const def = defForKind(kind);
  const result = def.attrs.safeParse(raw ?? {});
  return result.success ? result.data : {};
}
