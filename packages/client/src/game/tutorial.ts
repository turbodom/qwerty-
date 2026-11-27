/**
 * The first-game tutorial: a fixed list of steps, each finished by something the player does. Pure logic
 * (no DOM), so it is easy to test; ui/coach.ts shows the current step.
 */
import type { GameEvent, PlayerView } from "@korony/shared";
import { mePlayer, myHero } from "./helpers";

export const TUTORIAL_STEPS = ["move", "collect", "castle", "hire", "build", "battle", "endDay", "win"] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Map and difficulty of the tutorial game: the small hand-made valley against an easy AI. */
export const TUTORIAL_MAP = "valley";

export interface TutorialState {
  /** Local game the tutorial belongs to. */
  gameId: string;
  /** Index into TUTORIAL_STEPS; TUTORIAL_STEPS.length when finished. */
  step: number;
}

/** What else the player did that the game state does not show. */
export interface TutorialSignals {
  castleOpened: boolean;
}

/** True when the update finishes `step` for the viewer. */
export function stepDone(step: TutorialStep, view: PlayerView, events: readonly GameEvent[], sig: TutorialSignals): boolean {
  const me = mePlayer(view);
  if (!me) return false;
  const you = view.you;
  switch (step) {
    case "move": {
      const hero = myHero(view);
      return events.some((e) => e.type === "moved" && e.heroId === hero?.id);
    }
    case "collect":
      return events.some(
        (e) =>
          (e.type === "gold" && e.player === you && (e.reason === "chest" || e.reason === "quest")) ||
          (e.type === "mine" && e.player === you) ||
          (e.type === "artifact" && e.player === you),
      );
    case "castle":
      return sig.castleOpened;
    case "hire":
      return events.some((e) => e.type === "gold" && e.player === you && e.reason === "hire");
    case "build":
      return Object.keys(me.built).length > 0;
    case "battle":
      return events.some((e) => e.type === "battleEnd" && (e.sides?.includes(you) ?? true));
    case "endDay":
      return events.some((e) => e.type === "newDay");
    case "win":
      return false;
  }
}

/**
 * Moves the tutorial on as far as this update allows (a single action can finish several steps, e.g. a walk
 * that picks up a chest). Steps the player already did out of order count too.
 */
export function advance(state: TutorialState, view: PlayerView, events: readonly GameEvent[], sig: TutorialSignals): TutorialState {
  let step = state.step;
  while (step < TUTORIAL_STEPS.length) {
    const id = TUTORIAL_STEPS[step];
    if (!id || !stepDone(id, view, events, sig)) break;
    step++;
  }
  return step === state.step ? state : { ...state, step };
}
