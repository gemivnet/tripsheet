import { callMessages } from './client.js';

/**
 * Map a free-form location string to its IANA time zone (e.g. "Sydney" →
 * "Australia/Sydney"). Uses Haiku for cost; the answer is cached
 * per-process. Returns null if the model isn't confident or the location
 * is too vague (e.g. "the airport").
 */
const cache = new Map<string, string | null>();

interface DerivedTz {
  tz: string | null;
  end_tz: string | null;
}

/**
 * For flight items the user typically writes location as "JFK → LHR" or
 * "Sydney to Tokyo". We ask the model for both legs and return them
 * separately so the UI can show departure tz vs arrival tz.
 */
export async function deriveTimezone(location: string, kind: string): Promise<DerivedTz> {
  const key = `${kind}::${location.toLowerCase().trim()}`;
  if (cache.has(key)) {
    const cached = cache.get(key)!;
    return { tz: cached, end_tz: null };
  }

  const isTransit = kind === 'transit';
  const ask = isTransit
    ? `For this transit/flight, return the IANA time zones of the origin and destination. Location: "${location}". Reply ONLY as JSON: {"tz":"Origin/Tz","end_tz":"Destination/Tz"}. Use null if unsure.`
    : `Return the IANA time zone for this location: "${location}". Reply ONLY as JSON: {"tz":"Region/City"}. Use null if unsure or if the location is too vague.`;

  const response = await callMessages<{ content?: Array<{ type: string; text?: string }> }>(
    'deriveTz',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: ask }],
    },
  );
  const text = (response.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { tz: null, end_tz: null };
  try {
    const parsed = JSON.parse(match[0]) as { tz?: string | null; end_tz?: string | null };
    const result: DerivedTz = {
      tz: parsed.tz && /^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(parsed.tz) ? parsed.tz : null,
      end_tz: parsed.end_tz && /^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(parsed.end_tz)
        ? parsed.end_tz
        : null,
    };
    cache.set(key, result.tz);
    return result;
  } catch {
    return { tz: null, end_tz: null };
  }
}
