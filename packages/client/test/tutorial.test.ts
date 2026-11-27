import { describe, expect, it } from "vitest";
import { applyAction, createGame, playerView } from "@korony/shared";
import type { GameEvent, GameState } from "@korony/shared";
import { TUTORIAL_MAP, TUTORIAL_STEPS, advance, stepDone } from "../src/game/tutorial";

function game(): GameState {
  return createGame({
    id: "tut", mapId: TUTORIAL_MAP, seed: 3, aiLevel: "easy",
    players: [{ id: "p0", name: "A", isAI: false }, { id: "p1", name: "AI", isAI: true }],
  });
}

const none = { castleOpened: false };

describe("tutorial steps", () => {
  it("starts with a move and ends with the closing tip, which never finishes by itself", () => {
    expect(TUTORIAL_STEPS[0]).toBe("move");
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]).toBe("win");
    const s = game();
    expect(stepDone("win", playerView(s, "p0"), [{ type: "newDay", day: 2 }], none)).toBe(false);
  });

  it("a walk finishes the move step, ending the day finishes the end-day step", () => {
    const s = game();
    const h = s.heroes["h0"]!;
    const to = [[1, 0], [0, -1], [-1, 0], [0, 1]].map(([dx, dy]) => ({ x: h.x + dx!, y: h.y + dy! }))
      .find((p) => s.terrain[p.y]?.[p.x] === "." && !s.objects.some((o) => Math.abs(o.x - p.x) <= 1 && Math.abs(o.y - p.y) <= 1 && o.kind === "monster"))!;
    const r = applyAction(s, "p0", { type: "move", to });
    expect(r.ok).toBe(true);
    const v = playerView(s, "p0");
    let st = advance({ gameId: "tut", step: 0 }, v, r.events, none);
    expect(TUTORIAL_STEPS[st.step]).toBe("collect");
    // nothing new: the state object stays the same
    expect(advance(st, v, [], none)).toBe(st);
    const day: GameEvent[] = [{ type: "newDay", day: 2 }];
    st = advance({ gameId: "tut", step: TUTORIAL_STEPS.indexOf("endDay") }, v, day, none);
    expect(TUTORIAL_STEPS[st.step]).toBe("win");
  });

  it("opening the castle, hiring and building each count", () => {
    const s = game();
    const v = playerView(s, "p0");
    const at = (id: (typeof TUTORIAL_STEPS)[number]) => ({ gameId: "tut", step: TUTORIAL_STEPS.indexOf(id) });
    expect(advance(at("castle"), v, [], { castleOpened: true }).step).toBe(TUTORIAL_STEPS.indexOf("hire"));
    const hired: GameEvent[] = [{ type: "gold", player: "p0", amount: -600, reason: "hire" }];
    expect(advance(at("hire"), v, hired, none).step).toBe(TUTORIAL_STEPS.indexOf("build"));
    s.players[0]!.built = { forge: true };
    expect(advance(at("build"), playerView(s, "p0"), [], none).step).toBe(TUTORIAL_STEPS.indexOf("battle"));
    const won: GameEvent[] = [{ type: "battleEnd", battleId: "b", winner: "p0", sides: ["p0", "neutral"] }];
    expect(advance(at("battle"), v, won, none).step).toBe(TUTORIAL_STEPS.indexOf("endDay"));
    // someone else's gold does not count
    expect(advance(at("hire"), v, [{ type: "gold", player: "p1", amount: -10, reason: "hire" }], none).step).toBe(TUTORIAL_STEPS.indexOf("hire"));
  });
});
