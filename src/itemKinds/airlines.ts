/**
 * Airline normalization helpers.
 *
 * The free-text "airline" attribute that flights are imported with (PDF
 * parses, manual entry, AI suggestions) needs to be folded onto a
 * canonical IATA-code key so that:
 *
 *   - "Southwest", "southwest airlines", "SOUTHWEST" → "WN"
 *   - "American", "american airlines", "AA" → "AA"
 *   - "AA2364" / "aa-2364" / "AA 2364" → "AA 2364"
 *   - the online-check-in window lookup (24h, 23h, 36h…) keys off the
 *     same code
 *   - the timeline card displays a consistent "AA 2364" everywhere
 *
 * Add carriers to `AIRLINES` as needed — the table only needs to grow
 * when a new alias surfaces in the wild.
 */

interface AirlineSpec {
  iata: string;
  /** Display name shown back to the user when they typed the IATA code. */
  display: string;
  /** Lowercased aliases the user might have typed (full names, abbreviations). */
  aliases: readonly string[];
  /** Hours before scheduled departure that online check-in opens. */
  checkInWindowHours?: number;
}

export const AIRLINES: readonly AirlineSpec[] = [
  // ─── United States ──────────────────────────────────────────────────────
  { iata: 'AA', display: 'American Airlines', aliases: ['american', 'american airlines', 'aa'], checkInWindowHours: 24 },
  { iata: 'DL', display: 'Delta', aliases: ['delta', 'delta air lines', 'dl'], checkInWindowHours: 24 },
  { iata: 'UA', display: 'United', aliases: ['united', 'united airlines', 'ua'], checkInWindowHours: 24 },
  { iata: 'WN', display: 'Southwest', aliases: ['southwest', 'southwest airlines', 'wn'], checkInWindowHours: 24 },
  { iata: 'B6', display: 'JetBlue', aliases: ['jetblue', 'jet blue', 'b6'], checkInWindowHours: 24 },
  { iata: 'AS', display: 'Alaska', aliases: ['alaska', 'alaska airlines', 'as'], checkInWindowHours: 24 },
  { iata: 'NK', display: 'Spirit', aliases: ['spirit', 'spirit airlines', 'nk'], checkInWindowHours: 24 },
  { iata: 'F9', display: 'Frontier', aliases: ['frontier', 'frontier airlines', 'f9'], checkInWindowHours: 24 },
  { iata: 'HA', display: 'Hawaiian', aliases: ['hawaiian', 'hawaiian airlines', 'ha'], checkInWindowHours: 24 },
  { iata: 'G4', display: 'Allegiant', aliases: ['allegiant', 'allegiant air', 'g4'], checkInWindowHours: 24 },
  // ─── Canada / Mexico / Latin America ─────────────────────────────────
  { iata: 'AC', display: 'Air Canada', aliases: ['air canada', 'aircanada', 'ac'], checkInWindowHours: 24 },
  { iata: 'WS', display: 'WestJet', aliases: ['westjet', 'west jet', 'ws'], checkInWindowHours: 24 },
  { iata: 'AM', display: 'Aeromexico', aliases: ['aeromexico', 'aero mexico', 'am'], checkInWindowHours: 48 },
  { iata: 'LA', display: 'LATAM', aliases: ['latam', 'latam airlines', 'la'], checkInWindowHours: 48 },
  { iata: 'AV', display: 'Avianca', aliases: ['avianca', 'av'], checkInWindowHours: 24 },
  { iata: 'CM', display: 'Copa', aliases: ['copa', 'copa airlines', 'cm'], checkInWindowHours: 24 },
  { iata: 'G3', display: 'Gol', aliases: ['gol', 'gol linhas aereas', 'g3'], checkInWindowHours: 48 },
  { iata: 'JJ', display: 'LATAM Brasil', aliases: ['latam brasil', 'tam', 'jj'], checkInWindowHours: 48 },
  // ─── Europe ─────────────────────────────────────────────────────────
  { iata: 'BA', display: 'British Airways', aliases: ['british airways', 'british', 'ba'], checkInWindowHours: 24 },
  { iata: 'LH', display: 'Lufthansa', aliases: ['lufthansa', 'lh'], checkInWindowHours: 23 },
  { iata: 'AF', display: 'Air France', aliases: ['air france', 'airfrance', 'af'], checkInWindowHours: 30 },
  { iata: 'KL', display: 'KLM', aliases: ['klm', 'klm royal dutch', 'kl'], checkInWindowHours: 30 },
  { iata: 'IB', display: 'Iberia', aliases: ['iberia', 'ib'], checkInWindowHours: 48 },
  { iata: 'AY', display: 'Finnair', aliases: ['finnair', 'ay'], checkInWindowHours: 36 },
  { iata: 'SK', display: 'SAS', aliases: ['sas', 'scandinavian airlines', 'sk'], checkInWindowHours: 22 },
  { iata: 'TP', display: 'TAP Portugal', aliases: ['tap', 'tap portugal', 'tap air portugal', 'tp'], checkInWindowHours: 36 },
  { iata: 'LX', display: 'Swiss', aliases: ['swiss', 'swiss international', 'lx'], checkInWindowHours: 23 },
  { iata: 'OS', display: 'Austrian', aliases: ['austrian', 'austrian airlines', 'os'], checkInWindowHours: 23 },
  { iata: 'SN', display: 'Brussels Airlines', aliases: ['brussels', 'brussels airlines', 'sn'], checkInWindowHours: 24 },
  { iata: 'EI', display: 'Aer Lingus', aliases: ['aer lingus', 'ei'], checkInWindowHours: 30 },
  { iata: 'VS', display: 'Virgin Atlantic', aliases: ['virgin atlantic', 'vs'], checkInWindowHours: 24 },
  { iata: 'AZ', display: 'ITA Airways', aliases: ['ita', 'ita airways', 'alitalia', 'az'], checkInWindowHours: 24 },
  { iata: 'TK', display: 'Turkish Airlines', aliases: ['turkish', 'turkish airlines', 'tk'], checkInWindowHours: 24 },
  { iata: 'FR', display: 'Ryanair', aliases: ['ryanair', 'fr'], checkInWindowHours: 48 },
  { iata: 'U2', display: 'easyJet', aliases: ['easyjet', 'easy jet', 'u2'], checkInWindowHours: 30 * 24 },
  { iata: 'W6', display: 'Wizz Air', aliases: ['wizz', 'wizz air', 'w6'], checkInWindowHours: 48 },
  { iata: 'DY', display: 'Norwegian', aliases: ['norwegian', 'norwegian air', 'dy'], checkInWindowHours: 24 },
  { iata: 'VY', display: 'Vueling', aliases: ['vueling', 'vy'], checkInWindowHours: 7 * 24 },
  // ─── Middle East ────────────────────────────────────────────────────
  { iata: 'EK', display: 'Emirates', aliases: ['emirates', 'ek'], checkInWindowHours: 48 },
  { iata: 'EY', display: 'Etihad', aliases: ['etihad', 'etihad airways', 'ey'], checkInWindowHours: 30 },
  { iata: 'QR', display: 'Qatar Airways', aliases: ['qatar', 'qatar airways', 'qr'], checkInWindowHours: 48 },
  { iata: 'GF', display: 'Gulf Air', aliases: ['gulf air', 'gf'], checkInWindowHours: 24 },
  { iata: 'SV', display: 'Saudia', aliases: ['saudia', 'saudi arabian', 'sv'], checkInWindowHours: 24 },
  // ─── Asia / Pacific ─────────────────────────────────────────────────
  { iata: 'NH', display: 'ANA', aliases: ['ana', 'all nippon', 'all nippon airways', 'nh'], checkInWindowHours: 24 },
  { iata: 'JL', display: 'JAL', aliases: ['jal', 'japan airlines', 'jl'], checkInWindowHours: 24 },
  { iata: 'CX', display: 'Cathay Pacific', aliases: ['cathay', 'cathay pacific', 'cx'], checkInWindowHours: 48 },
  { iata: 'SQ', display: 'Singapore Airlines', aliases: ['singapore', 'singapore airlines', 'sq'], checkInWindowHours: 48 },
  { iata: 'KE', display: 'Korean Air', aliases: ['korean air', 'korean', 'ke'], checkInWindowHours: 48 },
  { iata: 'OZ', display: 'Asiana', aliases: ['asiana', 'asiana airlines', 'oz'], checkInWindowHours: 48 },
  { iata: 'CA', display: 'Air China', aliases: ['air china', 'ca'], checkInWindowHours: 48 },
  { iata: 'MU', display: 'China Eastern', aliases: ['china eastern', 'mu'], checkInWindowHours: 48 },
  { iata: 'CZ', display: 'China Southern', aliases: ['china southern', 'cz'], checkInWindowHours: 48 },
  { iata: 'TG', display: 'Thai Airways', aliases: ['thai', 'thai airways', 'tg'], checkInWindowHours: 24 },
  { iata: 'MH', display: 'Malaysia Airlines', aliases: ['malaysia airlines', 'malaysia', 'mh'], checkInWindowHours: 48 },
  { iata: 'PR', display: 'Philippine Airlines', aliases: ['philippine', 'philippine airlines', 'pr'], checkInWindowHours: 24 },
  { iata: 'GA', display: 'Garuda', aliases: ['garuda', 'garuda indonesia', 'ga'], checkInWindowHours: 24 },
  { iata: 'VN', display: 'Vietnam Airlines', aliases: ['vietnam airlines', 'vn'], checkInWindowHours: 24 },
  { iata: 'AI', display: 'Air India', aliases: ['air india', 'ai'], checkInWindowHours: 48 },
  { iata: '6E', display: 'IndiGo', aliases: ['indigo', '6e'], checkInWindowHours: 48 },
  { iata: 'QF', display: 'Qantas', aliases: ['qantas', 'qf'], checkInWindowHours: 24 },
  { iata: 'VA', display: 'Virgin Australia', aliases: ['virgin australia', 'va'], checkInWindowHours: 24 },
  { iata: 'NZ', display: 'Air New Zealand', aliases: ['air new zealand', 'air nz', 'nz'], checkInWindowHours: 48 },
  { iata: 'JQ', display: 'Jetstar', aliases: ['jetstar', 'jq'], checkInWindowHours: 48 },
  // ─── Africa ─────────────────────────────────────────────────────────
  { iata: 'SA', display: 'South African', aliases: ['south african', 'south african airways', 'sa'], checkInWindowHours: 24 },
  { iata: 'ET', display: 'Ethiopian', aliases: ['ethiopian', 'ethiopian airlines', 'et'], checkInWindowHours: 24 },
  { iata: 'KQ', display: 'Kenya Airways', aliases: ['kenya airways', 'kq'], checkInWindowHours: 24 },
  { iata: 'MS', display: 'EgyptAir', aliases: ['egyptair', 'egypt air', 'ms'], checkInWindowHours: 24 },
];

const BY_ALIAS = new Map<string, AirlineSpec>();
const BY_IATA = new Map<string, AirlineSpec>();
for (const a of AIRLINES) {
  BY_IATA.set(a.iata.toUpperCase(), a);
  for (const alias of a.aliases) BY_ALIAS.set(alias.toLowerCase(), a);
  BY_ALIAS.set(a.iata.toLowerCase(), a);
  BY_ALIAS.set(a.display.toLowerCase(), a);
}

/**
 * Resolve a free-text airline string to a canonical IATA code. Returns
 * the input (trimmed, uppercased) when no match — we don't want to
 * silently lose user input we don't recognise.
 */
export function normalizeAirlineCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hit = BY_ALIAS.get(trimmed.toLowerCase());
  if (hit) return hit.iata;
  // Two-letter all-caps, leave alone (already looks like an IATA code).
  if (/^[A-Z0-9]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  // Don't silently drop unfamiliar full names — keep them as the user typed.
  return trimmed;
}

/**
 * Format an airline + flight number pair as "XX 1234". Tolerates the
 * user typing "AA2364", "AA-2364", "aa 2364", or "2364" alone.
 *
 * When the airline can't be resolved, returns the number portion alone
 * (or the original input when no digits are present).
 */
export function formatFlightNumber(
  airline: string | null | undefined,
  flightNumber: string | null | undefined,
): string | null {
  if (!flightNumber) return null;
  const raw = flightNumber.trim();
  if (!raw) return null;
  // Pull out the digit portion. Prefer trailing digits over leading
  // (so "AA2364" → "2364", not "" + leftover).
  const digitMatch = raw.match(/(\d{1,5})\s*$/);
  const digits = digitMatch ? digitMatch[1] : raw.replace(/\D+/g, '');
  // If the user typed letters at the start ("AA2364"), use those when
  // no airline is set explicitly.
  const prefixMatch = raw.match(/^([A-Za-z0-9]{1,3})/);
  const code = normalizeAirlineCode(airline) ?? (prefixMatch ? normalizeAirlineCode(prefixMatch[1]) : null);
  if (code && digits) return `${code} ${digits}`;
  if (digits) return digits;
  return raw;
}

/**
 * Hours before scheduled departure that online check-in opens, by IATA
 * carrier code. Returns null when the carrier is unknown — the caller
 * should fall back to a sensible default (24h).
 */
export function checkInWindowHours(iata: string | null | undefined): number | null {
  if (!iata) return null;
  return BY_IATA.get(iata.toUpperCase())?.checkInWindowHours ?? null;
}
