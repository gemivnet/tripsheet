import type { ChatMessage, Item, Suggestion, Trip, User, ReferenceDoc, Participant } from '../api.js';
import type { Day } from './shared.js';

export type RightTab = 'event' | 'comments' | 'ai' | 'preview' | 'pdf';

/**
 * Everything the left timeline + right pane need from TripEditor.
 * TripEditor owns the state; this interface is the contract.
 */
export interface EditorState {
  user: User;
  trip: Trip;
  items: Item[];
  days: Day[];
  docs: ReferenceDoc[];
  participants: Participant[];
  refreshParticipants: () => Promise<void>;
  setItemParticipants: (itemId: number, participantIds: number[]) => Promise<void>;
  refreshDocs: () => Promise<void>;

  selectedItemId: number | null;
  selectItem: (id: number | null) => void;
  scrollTargetId: number | null;
  scrollToItem: (id: number) => void;

  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;

  addForDate: string | null;
  openAdd: (date: string) => void;
  closeAdd: () => void;

  // CRUD on items (optimistic-ish — updates local state then reconciles).
  createItem: (patch: Partial<Item> & { day_date: string; title: string; kind: Item['kind'] }) => Promise<Item | null>;
  updateItem: (id: number, patch: Partial<Item>) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;

  reorderItemsInDay: (date: string, fromIdx: number, toIdx: number) => void;
  moveItemToDay: (itemId: number, toDate: string, toIdx: number) => void;

  addDay: () => Promise<void>;
  deleteDay: (date: string, mode: 'shift' | 'leave') => Promise<void>;

  // Duplicate flow.
  duplicatingId: number | null;
  duplicateItem: (id: number) => Promise<void>;
  confirmDuplicate: () => void;
  cancelDuplicate: () => Promise<void>;

  // Fly-in animation when a suggestion lands in the timeline.
  flyingItemId: number | null;

  // Comments.
  commentCounts: Record<number, number>;
  refreshComments: (itemId: number) => Promise<void>;

  // AI chat.
  aiMessages: ChatMessage[];
  aiSuggestions: Suggestion[];
  aiLoading: boolean;
  sendAiMessage: (text: string) => Promise<void>;
  acceptSuggestion: (s: Suggestion, overrides?: { payload?: Record<string, unknown> }) => Promise<void>;
  rejectSuggestion: (id: number) => Promise<void>;
  patchSuggestion: (id: number, patch: { payload?: Record<string, unknown>; rationale?: string }) => Promise<void>;
}
