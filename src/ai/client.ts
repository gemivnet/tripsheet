import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  client = new Anthropic({ apiKey });
  return client;
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ─── runtime controls (mutated via dev toolbar) ──────────────────────────────

let aiPaused = false;
export function setAiPaused(paused: boolean): void {
  aiPaused = paused;
}
export function isAiPaused(): boolean {
  return aiPaused;
}

let modelOverride: string | null = null;
export function setModelOverride(model: string | null): void {
  modelOverride = model;
}
export function currentModel(): string {
  return modelOverride ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
}

let concurrencyLimit = 4;
export function setConcurrency(n: number): void {
  concurrencyLimit = Math.max(1, Math.min(8, n));
}
export function getConcurrency(): number {
  return concurrencyLimit;
}

const usage = { input_tokens: 0, output_tokens: 0, requests: 0 };
export function getUsage(): { input_tokens: number; output_tokens: number; requests: number } {
  return { ...usage };
}
export function resetUsage(): void {
  usage.input_tokens = 0;
  usage.output_tokens = 0;
  usage.requests = 0;
}

// ─── live event log + queue inspector ────────────────────────────────────────

export interface AiEvent {
  id: number;
  at: string;
  kind:
    | 'queued'
    | 'started'
    | 'streaming'
    | 'retry'
    | 'completed'
    | 'error'
    | 'paused'
    | 'resumed'
    | 'log';
  caller: string;
  job_id?: string;
  message?: string;
  attempt?: number;
  delay_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
}

const eventLog: AiEvent[] = [];
let eventSeq = 0;
const MAX_EVENTS = 500;

function logEvent(ev: Omit<AiEvent, 'id' | 'at'>): void {
  const e: AiEvent = { ...ev, id: ++eventSeq, at: new Date().toISOString() };
  eventLog.push(e);
  if (eventLog.length > MAX_EVENTS) eventLog.splice(0, eventLog.length - MAX_EVENTS);
}

export function getEvents(sinceId = 0, limit = 200): AiEvent[] {
  const start = eventLog.findIndex((e) => e.id > sinceId);
  if (start === -1) return [];
  return eventLog.slice(start, start + limit);
}

export function appendLog(message: string, caller = 'app'): void {
  logEvent({ kind: 'log', caller, message });
}

export interface AiJob {
  id: string;
  caller: string;
  status: 'queued' | 'running' | 'streaming';
  queued_at: string;
  started_at?: string;
  attempt: number;
  output_tokens?: number;
}

const jobs = new Map<string, AiJob>();
export function getJobs(): AiJob[] {
  return Array.from(jobs.values()).sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export interface Exchange {
  id: number | string;
  at: string;
  caller: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  request: unknown;
  response: unknown;
  error?: string;
  in_flight?: boolean;
  partial_text?: string;
}
const exchanges: Exchange[] = [];
let exchangeSeq = 0;
const MAX_EXCHANGES = 30;

function recordExchange(e: Omit<Exchange, 'id'>): Exchange {
  const full: Exchange = { ...e, id: ++exchangeSeq };
  exchanges.push(full);
  if (exchanges.length > MAX_EXCHANGES) exchanges.splice(0, exchanges.length - MAX_EXCHANGES);
  return full;
}
export function getExchanges(): Exchange[] {
  return exchanges.slice().reverse();
}
export function getLastExchange(): Exchange | null {
  return exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
}

const inFlight = new Map<string, Exchange>();
function inFlightId(jobId: string): string {
  return `live:${jobId}`;
}
export function getInFlightExchanges(): Exchange[] {
  // Newest first to match getExchanges() ordering.
  return Array.from(inFlight.values()).sort((a, b) => b.at.localeCompare(a.at));
}
export function findExchangeById(id: number | string): Exchange | null {
  if (typeof id === 'string' && id.startsWith('live:')) {
    return inFlight.get(id.slice('live:'.length)) ?? null;
  }
  const numeric = typeof id === 'number' ? id : Number(id);
  return exchanges.find((e) => e.id === numeric) ?? null;
}

// ─── concurrency-limited queue with streaming ────────────────────────────────

interface PendingTask {
  job: AiJob;
  body: Record<string, unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
const queue: PendingTask[] = [];
let activeCount = 0;

/**
 * Submit an Anthropic messages call. Up to `concurrencyLimit` jobs run
 * in parallel; the rest queue. Streams the response so we can update
 * token counts live and report progress through the event log.
 */
export async function callMessages<T>(caller: string, body: Record<string, unknown>): Promise<T> {
  if (aiPaused) {
    logEvent({ kind: 'paused', caller, message: 'AI paused — request rejected' });
    throw new Error('AI is paused (toggle off in the dev toolbar to re-enable).');
  }
  const job: AiJob = {
    id: randomUUID(),
    caller,
    status: 'queued',
    queued_at: new Date().toISOString(),
    attempt: 0,
  };
  jobs.set(job.id, job);
  logEvent({ kind: 'queued', caller, job_id: job.id });

  return new Promise<T>((resolve, reject) => {
    queue.push({ job, body, resolve: resolve as (v: unknown) => void, reject });
    drain();
  });
}

function drain(): void {
  while (activeCount < concurrencyLimit && queue.length > 0) {
    const task = queue.shift()!;
    activeCount += 1;
    void runTask(task).finally(() => {
      activeCount -= 1;
      jobs.delete(task.job.id);
      drain();
    });
  }
}

async function runTask(task: PendingTask): Promise<void> {
  const { job, body, resolve, reject } = task;
  const finalBody = { model: currentModel(), ...body };
  const MAX = 7;
  while (true) {
    try {
      job.attempt += 1;
      job.status = 'running';
      job.started_at = new Date().toISOString();
      logEvent({
        kind: 'started',
        caller: job.caller,
        job_id: job.id,
        attempt: job.attempt,
      });
      inFlight.set(job.id, {
        id: inFlightId(job.id),
        at: job.started_at,
        caller: job.caller,
        model: finalBody.model,
        request: redactRequest(finalBody),
        response: null,
        in_flight: true,
        partial_text: '',
      });
      const response = await streamCall(job, finalBody);
      inFlight.delete(job.id);
      const r = response as { usage?: { input_tokens?: number; output_tokens?: number } };
      usage.input_tokens += r.usage?.input_tokens ?? 0;
      usage.output_tokens += r.usage?.output_tokens ?? 0;
      usage.requests += 1;
      recordExchange({
        at: new Date().toISOString(),
        caller: job.caller,
        model: finalBody.model,
        input_tokens: r.usage?.input_tokens,
        output_tokens: r.usage?.output_tokens,
        request: redactRequest(finalBody),
        response,
      });
      logEvent({
        kind: 'completed',
        caller: job.caller,
        job_id: job.id,
        input_tokens: r.usage?.input_tokens,
        output_tokens: r.usage?.output_tokens,
      });
      resolve(response);
      return;
    } catch (e: unknown) {
      const { status } = e as { status?: number };
      const retryable = status === 429 || status === 529 || status === 503;
      if (!retryable || job.attempt >= MAX) {
        const msg = e instanceof Error ? e.message : String(e);
        inFlight.delete(job.id);
        recordExchange({
          at: new Date().toISOString(),
          caller: job.caller,
          model: finalBody.model,
          request: redactRequest(finalBody),
          response: null,
          error: msg,
        });
        logEvent({ kind: 'error', caller: job.caller, job_id: job.id, message: msg });
        reject(e);
        return;
      }
      const headerWait = Number(
        (e as { headers?: Record<string, string> }).headers?.['retry-after'],
      );
      const backoffMs =
        Number.isFinite(headerWait) && headerWait > 0
          ? headerWait * 1000
          : Math.min(32_000, 500 * 2 ** (job.attempt - 1)) + Math.random() * 250;
      logEvent({
        kind: 'retry',
        caller: job.caller,
        job_id: job.id,
        attempt: job.attempt,
        delay_ms: Math.round(backoffMs),
        message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      });
      await new Promise((r) => setTimeout(r, backoffMs));
      // Reset live-exchange state for the next attempt.
      const live = inFlight.get(job.id);
      if (live) {
        live.partial_text = '';
        live.at = new Date().toISOString();
      }
      job.status = 'queued';
    }
  }
}

/**
 * Stream-mode messages call. Reports `streaming` events with the
 * running output-token count so the dev toolbar can show progress live.
 */
async function streamCall(job: AiJob, body: Record<string, unknown>): Promise<unknown> {
  const anthropic = getAnthropicClient();
  job.status = 'streaming';
  let outTokens = 0;
  let lastEmitted = 0;
  const stream = anthropic.messages.stream(
    body as unknown as Parameters<typeof anthropic.messages.stream>[0],
  );
  stream.on('text', (chunk: string) => {
    outTokens += Math.max(1, Math.round(chunk.length / 4));
    job.output_tokens = outTokens;
    const live = inFlight.get(job.id);
    if (live) {
      live.partial_text = (live.partial_text ?? '') + chunk;
      live.output_tokens = outTokens;
    }
    if (outTokens - lastEmitted >= 100) {
      lastEmitted = outTokens;
      logEvent({
        kind: 'streaming',
        caller: job.caller,
        job_id: job.id,
        output_tokens: outTokens,
      });
    }
  });
  return await stream.finalMessage();
}

function redactRequest(body: Record<string, unknown>): unknown {
  try {
    const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    const messages = clone.messages as { content?: unknown }[] | undefined;
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (Array.isArray(m.content)) {
          for (const block of m.content as Record<string, unknown>[]) {
            const src = block.source as Record<string, unknown> | undefined;
            if (src && typeof src.data === 'string' && src.data.length > 200) {
              src.data = `<${src.data.length} bytes redacted>`;
            }
          }
        }
      }
    }
    return clone;
  } catch {
    return '<unserializable>';
  }
}
