/**
 * IATA airport code → IANA time zone, for the busiest international
 * airports. Used by the transit/flight form to auto-derive `tz` and
 * `end_tz` without needing to hit Claude. Anything missing here falls
 * back to the AI deriver via /api/ai/items/:id/derive-tz.
 *
 * Keep this list pruned to airports that actually appear in itineraries
 * — adding obscure regional fields adds bundle weight for no win. PRs
 * to extend are welcome; verify the IANA name with `tzdata`.
 */
export const IATA_TO_TZ: Record<string, string> = {
  // North America
  ATL: 'America/New_York', BOS: 'America/New_York', DCA: 'America/New_York',
  IAD: 'America/New_York', JFK: 'America/New_York', LGA: 'America/New_York',
  EWR: 'America/New_York', PHL: 'America/New_York', CLT: 'America/New_York',
  MIA: 'America/New_York', MCO: 'America/New_York', FLL: 'America/New_York',
  ORD: 'America/Chicago', MDW: 'America/Chicago', DFW: 'America/Chicago',
  IAH: 'America/Chicago', AUS: 'America/Chicago', MSY: 'America/Chicago',
  MSP: 'America/Chicago', STL: 'America/Chicago', NSH: 'America/Chicago',
  BNA: 'America/Chicago', MCI: 'America/Chicago',
  DEN: 'America/Denver', SLC: 'America/Denver', PHX: 'America/Phoenix',
  LAS: 'America/Los_Angeles', LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles', SJC: 'America/Los_Angeles', OAK: 'America/Los_Angeles',
  SEA: 'America/Los_Angeles', PDX: 'America/Los_Angeles',
  ANC: 'America/Anchorage', HNL: 'Pacific/Honolulu',
  YYZ: 'America/Toronto', YUL: 'America/Toronto', YOW: 'America/Toronto',
  YVR: 'America/Vancouver', YYC: 'America/Edmonton', YEG: 'America/Edmonton',
  MEX: 'America/Mexico_City', CUN: 'America/Cancun',

  // Europe
  LHR: 'Europe/London', LGW: 'Europe/London', STN: 'Europe/London',
  LCY: 'Europe/London', MAN: 'Europe/London', EDI: 'Europe/London',
  DUB: 'Europe/Dublin',
  CDG: 'Europe/Paris', ORY: 'Europe/Paris', NCE: 'Europe/Paris',
  AMS: 'Europe/Amsterdam',
  FRA: 'Europe/Berlin', MUC: 'Europe/Berlin', BER: 'Europe/Berlin',
  HAM: 'Europe/Berlin', DUS: 'Europe/Berlin',
  ZRH: 'Europe/Zurich', GVA: 'Europe/Zurich',
  VIE: 'Europe/Vienna',
  MAD: 'Europe/Madrid', BCN: 'Europe/Madrid',
  LIS: 'Europe/Lisbon', OPO: 'Europe/Lisbon',
  FCO: 'Europe/Rome', MXP: 'Europe/Rome', VCE: 'Europe/Rome',
  ATH: 'Europe/Athens',
  CPH: 'Europe/Copenhagen', OSL: 'Europe/Oslo', ARN: 'Europe/Stockholm',
  HEL: 'Europe/Helsinki', KEF: 'Atlantic/Reykjavik',
  WAW: 'Europe/Warsaw', PRG: 'Europe/Prague', BUD: 'Europe/Budapest',
  IST: 'Europe/Istanbul', SAW: 'Europe/Istanbul',
  SVO: 'Europe/Moscow', DME: 'Europe/Moscow',

  // Middle East / Africa
  DXB: 'Asia/Dubai', AUH: 'Asia/Dubai', DOH: 'Asia/Qatar',
  RUH: 'Asia/Riyadh', JED: 'Asia/Riyadh', TLV: 'Asia/Jerusalem',
  CAI: 'Africa/Cairo', JNB: 'Africa/Johannesburg', CPT: 'Africa/Johannesburg',
  NBO: 'Africa/Nairobi',

  // Asia
  HKG: 'Asia/Hong_Kong', TPE: 'Asia/Taipei', TSA: 'Asia/Taipei',
  PEK: 'Asia/Shanghai', PKX: 'Asia/Shanghai', PVG: 'Asia/Shanghai',
  SHA: 'Asia/Shanghai', CAN: 'Asia/Shanghai', CTU: 'Asia/Shanghai',
  ICN: 'Asia/Seoul', GMP: 'Asia/Seoul',
  NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', KIX: 'Asia/Tokyo',
  SIN: 'Asia/Singapore', KUL: 'Asia/Kuala_Lumpur',
  BKK: 'Asia/Bangkok', DMK: 'Asia/Bangkok', HKT: 'Asia/Bangkok',
  CGK: 'Asia/Jakarta', DPS: 'Asia/Makassar',
  MNL: 'Asia/Manila', SGN: 'Asia/Ho_Chi_Minh', HAN: 'Asia/Ho_Chi_Minh',
  DEL: 'Asia/Kolkata', BOM: 'Asia/Kolkata', BLR: 'Asia/Kolkata',
  MAA: 'Asia/Kolkata', HYD: 'Asia/Kolkata',
  KTM: 'Asia/Kathmandu', CMB: 'Asia/Colombo',

  // Oceania
  SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne', BNE: 'Australia/Brisbane',
  PER: 'Australia/Perth', ADL: 'Australia/Adelaide', CBR: 'Australia/Sydney',
  CNS: 'Australia/Brisbane', OOL: 'Australia/Brisbane',
  AKL: 'Pacific/Auckland', WLG: 'Pacific/Auckland', CHC: 'Pacific/Auckland',
  ZQN: 'Pacific/Auckland',
  NAN: 'Pacific/Fiji', PPT: 'Pacific/Tahiti',

  // South America
  GRU: 'America/Sao_Paulo', GIG: 'America/Sao_Paulo', SDU: 'America/Sao_Paulo',
  EZE: 'America/Argentina/Buenos_Aires', AEP: 'America/Argentina/Buenos_Aires',
  SCL: 'America/Santiago', LIM: 'America/Lima', BOG: 'America/Bogota',
  UIO: 'America/Guayaquil', GYE: 'America/Guayaquil',
};

export function tzForIata(code: string | null | undefined): string | null {
  if (!code) return null;
  return IATA_TO_TZ[code.toUpperCase().trim()] ?? null;
}
