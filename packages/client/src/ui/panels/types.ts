import type { GameAction, PlayerView, ShopItem } from "@korony/shared";
import type { User } from "../../api";
import type { ActionResultLike } from "../../net/connection";

/** What panels may use from the app. */
export interface AppApi {
  view(): PlayerView | null;
  act(action: GameAction): Promise<ActionResultLike>;
  openPanel(factory: PanelFactory): void;
  closePanel(): void;
  /** Re-renders the open panel (after async data arrived). */
  rerender(): void;
  toast(text: string, kind?: "info" | "error"): void;
  user(): User | null;
  shopCatalog(): { items: readonly ShopItem[]; fromServer: boolean };
  loadShop(): void;
  refreshUser(): Promise<void>;
  isLocal(): boolean;
  /** Leaves the game for the lobby; a running online match keeps the seat for the reconnection window. */
  toLobby(): void;
  /** Online only: asks for confirmation, then gives the match up. */
  surrender(): void;
  newLocalGame(): void;
  goLogin(): void;
}

export interface PanelSpec {
  title: string;
  body: HTMLElement;
  /** Centered dialog instead of a bottom sheet. */
  center?: boolean;
  /** Show the close button (default true). */
  closable?: boolean;
  /** Stable id (for tests and re-renders). */
  id: string;
}

export type PanelFactory = (app: AppApi) => PanelSpec;
