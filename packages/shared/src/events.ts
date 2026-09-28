import type { GameEvent, GameState, PlayerId } from "./types";
import { isExplored } from "./map";

/**
 * The part of `events` (from applyAction, run against `state` which is the state AFTER the action)
 * that `player` may see: their own gold/artifacts/quests/levels/toasts, battles they take part in,
 * foreign hero moves only over tiles they have explored, foreign mine captures only on explored tiles,
 * and public events (new day/week, defeat, victory).
 */
export function eventsForPlayer(state: GameState, player: PlayerId, events: readonly GameEvent[]): GameEvent[] {
  const battles: string[] = [];
  for (const ab of state.battles) if (ab.sides[0] === player || ab.sides[1] === player) battles.push(ab.battle.id);
  for (const e of events) {
    if ((e.type === "battleStart" || e.type === "battleEnd") && e.sides && (e.sides[0] === player || e.sides[1] === player)) {
      battles.push(e.battleId);
    }
  }
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case "moved": {
        const h = state.heroes[e.heroId];
        if (h && h.owner === player) {
          out.push(e);
        } else {
          const path = e.path.filter((pt) => isExplored(state, player, pt.x, pt.y));
          if (path.length > 0) out.push({ type: "moved", heroId: e.heroId, path });
        }
        break;
      }
      case "gold":
      case "artifact":
      case "level":
      case "quest":
        if (e.player === player) out.push(e);
        break;
      case "mine": {
        const o = state.objects.find((x) => x.id === e.objectId);
        if (e.player === player || (o && isExplored(state, player, o.x, o.y))) out.push(e);
        break;
      }
      case "toast":
        if (e.player === undefined || e.player === player) out.push(e);
        break;
      case "battleStart":
      case "battleEnd":
      case "battle":
        if (battles.includes(e.battleId)) out.push(e);
        break;
      default:
        out.push(e);
    }
  }
  return out;
}
