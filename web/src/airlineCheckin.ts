/**
 * Client-side airline check-in window lookup. Mirrors the table in
 * `src/itemKinds/airlines.ts` for the carriers whose window differs
 * from the 24-hour default. When you add a new carrier on the server
 * with a non-24h window, mirror it here.
 *
 * Kept intentionally small: only the exceptions need entries, and
 * `checkinHours()` returns the default for everything else (including
 * unknown carriers) so the synthetic "online check-in opens" marker
 * still appears for flights we don't recognize.
 */

const NON_24H_WINDOWS: Record<string, number> = {
  // Long opening windows (low-cost carriers selling early seat assignments)
  U2: 30 * 24, // easyJet
  VY: 7 * 24, // Vueling
  // 48h windows
  AM: 48,
  FR: 48,
  W6: 48,
  EK: 48,
  QR: 48,
  CX: 48,
  SQ: 48,
  KE: 48,
  OZ: 48,
  CA: 48,
  MU: 48,
  CZ: 48,
  MH: 48,
  AI: 48,
  '6E': 48,
  LA: 48,
  JJ: 48,
  JQ: 48,
  QH: 48,
  G3: 48,
  // 36h windows
  AY: 36,
  AF: 30,
  KL: 30,
  EI: 30,
  EY: 30,
  U2_: 36,
  // Tight windows
  LH: 23,
  LX: 23,
  OS: 23,
  SK: 22,
  TP: 36,
};

export function checkinHours(iata: string | null | undefined): number {
  if (!iata) return 24;
  return NON_24H_WINDOWS[iata.toUpperCase()] ?? 24;
}

/**
 * Compute the local-clock date+time when online check-in opens for a
 * flight, given its departure date/time and operating airline's IATA
 * code. Returns null when departure date or time is missing.
 *
 * Local-clock arithmetic is the right choice here: "24 hours before
 * departure" in the airline's terms is wall-clock, not UTC-offset
 * adjusted across the user's planning device. The marker just needs to
 * land on the right day in the itinerary.
 */
export function checkinOpensAt(
  departureDate: string | null | undefined,
  departureTime: string | null | undefined,
  airlineIata: string | null | undefined,
): { date: string; time: string } | null {
  if (!departureDate || !departureTime) return null;
  const hours = checkinHours(airlineIata);
  // Anchor on the departure date at midday so DST transitions can't
  // shift the resulting local date by a day in edge cases. Then add
  // the time-of-day and subtract the window.
  const [h, m] = departureTime.split(':').map(Number);
  const t = new Date(`${departureDate}T00:00:00`);
  t.setHours(h, m, 0, 0);
  t.setHours(t.getHours() - hours);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const time = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return { date, time };
}
