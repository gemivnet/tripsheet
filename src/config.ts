import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  allowed_emails: z.array(z.string().email()).min(1),
  ai: z
    .object({
      model: z.string().default('claude-sonnet-4-5'),
      thinking_budget_tokens: z.number().int().min(0).default(8000),
      max_suggestions: z.number().int().positive().default(8),
      max_web_searches: z.number().int().min(0).default(6),
    })
    .default({}),
  uploads: z
    .object({
      max_bytes: z.number().int().positive().default(26_214_400),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load `config.yaml`, validate the shape, and merge env-var overrides.
 *
 * Throws if the file is missing or the shape is wrong — we'd rather fail
 * loudly on boot than serve requests with a broken config.
 */
export function loadConfig(path: string): Config {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(path, 'utf-8'));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not read config at ${path}: ${reason}`);
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid config at ${path}:\n${parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }

  const cfg = parsed.data;
  const envModel = process.env.ANTHROPIC_MODEL;
  if (envModel) cfg.ai.model = envModel;

  return cfg;
}
