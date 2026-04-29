import { describe, it, expect } from '@jest/globals';
import {
  normalizeAirlineCode,
  formatFlightNumber,
  checkInWindowHours,
} from '../../src/itemKinds/airlines.js';

/**
 * Smoke tests for the airline normalizer. Pure-function module — no DB,
 * no network — so this also doubles as a "is the test runner wired up
 * at all" sanity check on CI.
 */
describe('normalizeAirlineCode', () => {
  it('folds full names onto IATA codes', () => {
    expect(normalizeAirlineCode('Southwest')).toBe('WN');
    expect(normalizeAirlineCode('southwest airlines')).toBe('WN');
    expect(normalizeAirlineCode('American Airlines')).toBe('AA');
    expect(normalizeAirlineCode('Lufthansa')).toBe('LH');
  });
  it('passes IATA codes through unchanged', () => {
    expect(normalizeAirlineCode('AA')).toBe('AA');
    expect(normalizeAirlineCode('aa')).toBe('AA');
  });
  it('preserves unknown carriers as the user typed them', () => {
    // We never silently drop a name we don't recognise; the user can
    // still see what they entered and add a mapping later.
    expect(normalizeAirlineCode('Some Tiny Airline')).toBe('Some Tiny Airline');
  });
  it('returns null for empty/null input', () => {
    expect(normalizeAirlineCode(null)).toBeNull();
    expect(normalizeAirlineCode('')).toBeNull();
    expect(normalizeAirlineCode('   ')).toBeNull();
  });
});

describe('formatFlightNumber', () => {
  it('reformats glommed numbers to "XX 1234"', () => {
    expect(formatFlightNumber('AA', 'AA2364')).toBe('AA 2364');
    expect(formatFlightNumber('American', 'aa-2364')).toBe('AA 2364');
    expect(formatFlightNumber('Southwest', '1234')).toBe('WN 1234');
  });
  it('keeps already-formatted numbers stable (idempotent)', () => {
    expect(formatFlightNumber('AA', 'AA 2364')).toBe('AA 2364');
  });
  it('returns the digit portion alone when carrier is unknown', () => {
    expect(formatFlightNumber('Some Tiny Airline', '0042')).toBe('Some Tiny Airline 0042');
  });
});

describe('checkInWindowHours', () => {
  it('returns the per-carrier window when known', () => {
    // Lufthansa opens at 23h, Singapore at 48h, easyJet super-early.
    expect(checkInWindowHours('LH')).toBe(23);
    expect(checkInWindowHours('SQ')).toBe(48);
    expect(checkInWindowHours('U2')).toBe(30 * 24);
  });
  it('returns null for unknown carriers so the caller can default', () => {
    expect(checkInWindowHours('ZZ')).toBeNull();
    expect(checkInWindowHours(null)).toBeNull();
  });
});
