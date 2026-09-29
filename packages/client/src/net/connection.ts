import type { GameAction, GameEvent, PlayerView } from "@korony/shared";

/** What `send` resolves to: the shared ActionResult shape (events optional for network results). */
export interface ActionResultLike {
  ok: boolean;
  error?: string;
  events?: GameEvent[];
}

export type ViewListener = (view: PlayerView, events: GameEvent[]) => void;

/**
 * A running game, local or online. Screens only see views and events, never where they came from.
 * `subscribe` calls the listener right away with the current view (and no events) when there is one,
 * then on every update; it returns an unsubscribe function.
 */
export interface GameConnection {
  readonly kind: "local" | "online";
  view: PlayerView | null;
  subscribe(cb: ViewListener): () => void;
  send(action: GameAction): Promise<ActionResultLike>;
  leave(): void;
  /** End of the current day by the server timer (unix ms), online only. */
  timerEndsAt?: number;
}
