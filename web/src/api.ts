export interface User {
  id: number;
  email: string;
  display_name: string;
}

export interface Trip {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  destination: string | null;
  goals: string | null;
  notes: string | null;
  default_tz: string | null;
}

export type ItemKind =
  | 'reservation'
  | 'checkin'
  | 'checkout'
  | 'activity'
  | 'option'
  | 'note'
  | 'transit';

export interface Item {
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
  created_by_name?: string | null;
  source_doc_id: number | null;
  tz: string | null;
  end_tz: string | null;
  attributes_json: string;
  participant_ids?: number[];
  /** Runtime-only flag: true when this is a synthetic arrival entry for a multi-day transit. Never stored in DB. */
  _arrivalShadow?: true;
}

export interface Participant {
  id: number;
  trip_id: number;
  user_id: number | null;
  display_name: string;
  color_hue: number | null;
  notes: string | null;
}

export type FieldType = 'text' | 'time' | 'date' | 'number' | 'iata' | 'tz' | 'select';
export interface KindFieldDef {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  derivesFrom?: string;
}
export interface KindDef {
  kind: ItemKind;
  subtype: string;
  label: string;
  hint: string | null;
  ownsTime: boolean;
  fields: KindFieldDef[];
}

export type SuggestionKind =
  | 'add_item'
  | 'modify_item'
  | 'remove_item'
  | 'move_item'
  | 'note';

export interface Suggestion {
  id: number;
  trip_id: number;
  batch_id: string;
  kind: SuggestionKind;
  target_item_id: number | null;
  payload_json: string;
  rationale: string;
  citations_json: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface ReferenceDoc {
  id: number;
  trip_id: number | null;
  title: string;
  kind: string;
  source_filename: string;
  stored_filename: string;
  parsed_summary: string | null;
  parse_status: 'pending' | 'running' | 'complete' | 'error';
  parse_error: string | null;
  parsed_trip_json: string | null;
  derived_trip_id: number | null;
  uploaded_at: string;
}

export interface Comment {
  id: number;
  item_id: number;
  user_id: number;
  body: string;
  created_at: string;
  author_name: string;
}

export interface ActivityEntry {
  kind: 'audit' | 'comment';
  id: number;
  author_name: string;
  created_at: string;
  entity: string | null;
  entity_id: number | null;
  action: string | null;
  item_id: number | null;
  body: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  signup: (body: { email: string; display_name: string; password: string }) =>
    request<{ user: User }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listTrips: () => request<{ trips: Trip[] }>('/api/trips'),
  listItemKinds: () => request<{ kinds: KindDef[] }>('/api/trips/item-kinds'),
  createTrip: (body: Partial<Trip>) =>
    request<{ trip: Trip }>('/api/trips', { method: 'POST', body: JSON.stringify(body) }),
  getTrip: (id: number) =>
    request<{ trip: Trip; items: Item[]; participants: Participant[] }>(`/api/trips/${id}`),

  listParticipants: (tripId: number) =>
    request<{ participants: Participant[] }>(`/api/participants/trips/${tripId}`),
  addParticipant: (tripId: number, body: { display_name: string; color_hue?: number | null; notes?: string | null }) =>
    request<{ participant: Participant }>(`/api/participants/trips/${tripId}`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateParticipant: (id: number, patch: Partial<Participant>) =>
    request<{ participant: Participant }>(`/api/participants/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  deleteParticipant: (id: number) =>
    request<{ ok: true }>(`/api/participants/${id}`, { method: 'DELETE' }),
  setItemParticipants: (itemId: number, participantIds: number[]) =>
    request<{ ok: true; participant_ids: number[] }>(
      `/api/participants/items/${itemId}`,
      { method: 'PUT', body: JSON.stringify({ participant_ids: participantIds }) },
    ),
  updateTrip: (id: number, patch: Partial<Trip>) =>
    request<{ trip: Trip }>(`/api/trips/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTrip: (id: number) =>
    request<{ ok: true }>(`/api/trips/${id}`, { method: 'DELETE' }),
  deleteDay: (id: number, date: string, mode: 'shift' | 'leave') =>
    request<{ ok: true; trip: Trip; deleted_items: number; shifted_items: number }>(
      `/api/trips/${id}/days/${date}?mode=${mode}`,
      { method: 'DELETE' },
    ),
  reimportTrip: (tripId: number, docId: number) =>
    request<{ ok: true; deleted: number; created: number }>(
      `/api/trips/${tripId}/reimport`,
      { method: 'POST', body: JSON.stringify({ doc_id: docId }) },
    ),

  createItem: (tripId: number, body: Partial<Item>) =>
    request<{ item: Item }>(`/api/trips/${tripId}/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateItem: (tripId: number, itemId: number, patch: Partial<Item>) =>
    request<{ item: Item }>(`/api/trips/${tripId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteItem: (tripId: number, itemId: number) =>
    request<{ ok: true }>(`/api/trips/${tripId}/items/${itemId}`, { method: 'DELETE' }),

  listComments: (itemId: number) =>
    request<{ comments: Comment[] }>(`/api/items/${itemId}/comments`),
  postComment: (itemId: number, body: string) =>
    request<{ comment: Comment }>(`/api/items/${itemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  listSuggestions: (tripId: number) =>
    request<{ suggestions: Suggestion[] }>(`/api/suggestions/trips/${tripId}`),
  patchSuggestion: (id: number, patch: { payload?: Record<string, unknown>; rationale?: string }) =>
    request<{ suggestion: Suggestion }>(`/api/suggestions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  acceptSuggestion: (id: number) =>
    request<{ ok: true; item?: Item; removed_item_id?: number }>(`/api/suggestions/${id}/accept`, { method: 'POST' }),
  rejectSuggestion: (id: number) =>
    request<{ ok: true }>(`/api/suggestions/${id}/reject`, { method: 'POST' }),

  runSuggest: (tripId: number) =>
    request<{ suggestions: Suggestion[] }>(`/api/ai/trips/${tripId}/suggest`, { method: 'POST' }),
  chatAi: (tripId: number, messages: ChatMessage[]) =>
    request<{ reply: string; suggestions: Suggestion[] }>(`/api/ai/trips/${tripId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),

  listDocs: (scope?: { library: true } | { tripId: number }) => {
    const url = !scope
      ? '/api/uploads'
      : 'library' in scope
        ? '/api/uploads?scope=library'
        : `/api/uploads?scope=trip&trip_id=${scope.tripId}`;
    return request<{ docs: ReferenceDoc[] }>(url);
  },
  getDoc: (id: number) =>
    request<{ doc: ReferenceDoc; items: unknown[] }>(`/api/uploads/${id}`),
  uploadDoc: async (form: FormData) => {
    const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { doc: ReferenceDoc };
  },
  reparseDoc: (id: number) =>
    request<{ ok: true }>(`/api/ai/docs/${id}/reparse`, { method: 'POST' }),
  deleteDoc: (id: number) =>
    request<{ ok: true }>(`/api/uploads/${id}`, { method: 'DELETE' }),
  deriveItemTz: (itemId: number) =>
    request<{ tz: string | null; end_tz: string | null }>(
      `/api/ai/items/${itemId}/derive-tz`,
      { method: 'POST' },
    ),
  docFileUrl: (id: number) => `/api/uploads/${id}/file`,

  activity: () => request<{ activity: ActivityEntry[] }>('/api/activity'),

  devState: (sinceEventId = 0) =>
    request<DevState>(`/api/dev/state?since=${sinceEventId}`),
  devSetConcurrency: (n: number) =>
    request<{ ok: true; concurrency: number }>('/api/dev/ai/concurrency', {
      method: 'POST', body: JSON.stringify({ n }),
    }),
  devGetExchange: (id: number | string) =>
    request<{ exchange: ExchangeFull }>(`/api/dev/exchanges/${encodeURIComponent(String(id))}`),
  devPauseAi: (paused: boolean) =>
    request<{ ok: true; paused: boolean }>('/api/dev/ai/pause', {
      method: 'POST', body: JSON.stringify({ paused }),
    }),
  devSetModel: (model: string | null) =>
    request<{ ok: true; model: string }>('/api/dev/ai/model', {
      method: 'POST', body: JSON.stringify({ model }),
    }),
  devResetUsage: () =>
    request<{ ok: true }>('/api/dev/ai/usage/reset', { method: 'POST' }),
  devReparseAll: () =>
    request<{ ok: true; queued: number }>('/api/dev/reparse-all', { method: 'POST' }),
  devNuke: () =>
    request<{ ok: true }>('/api/dev/nuke-data', { method: 'POST' }),
};

export interface AiJob {
  id: string;
  caller: string;
  status: 'queued' | 'running' | 'streaming';
  queued_at: string;
  started_at?: string;
  attempt: number;
  output_tokens?: number;
}

export interface AiEvent {
  id: number;
  at: string;
  kind: 'queued' | 'started' | 'streaming' | 'retry' | 'completed' | 'error' | 'paused' | 'resumed' | 'log';
  caller: string;
  job_id?: string;
  message?: string;
  attempt?: number;
  delay_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface DevState {
  ai_paused: boolean;
  model: string;
  concurrency: number;
  usage: { input_tokens: number; output_tokens: number; requests: number };
  jobs: AiJob[];
  events: AiEvent[];
  last_exchange: ExchangeFull | null;
  exchanges: ExchangeSummary[];
}

export interface ExchangeSummary {
  id: number | string;
  at: string;
  caller: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
  in_flight?: boolean;
}

export interface ExchangeFull extends ExchangeSummary {
  request: unknown;
  response: unknown;
  partial_text?: string;
}
