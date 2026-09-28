import { describe, expect, it } from "vitest";
import {
  ARTIFACTS, ARTIFACT_IDS, BUILDINGS, DROP_POOL, FACTION_UNITS, MAPS, QUESTS, SETS, SHOP_ITEMS, SKILLS, SKILL_IDS,
  SLOTS, SPELLS, STAT_KEYS, UNITS, UNIT_IDS, UPGRADES, isPassable, weeklyGrowth, START_GROWTH,
} from "../src";

describe("units", () => {
  it("ids match keys and upgrade targets exist", () => {
    for (const id of UNIT_IDS) {
      const u = UNITS[id];
      expect(u.id).toBe(id);
      expect(u.dmg[0]).toBeLessThanOrEqual(u.dmg[1]);
      if (u.upgradesTo) {
        expect(UNITS[u.upgradesTo]).toBeDefined();
        expect(UNITS[u.upgradesTo].upgraded).toBe(true);
        expect(u.upgradeCost).toBeGreaterThan(0);
        expect(UPGRADES[id]).toEqual({ to: u.upgradesTo, cost: u.upgradeCost });
      }
    }
    for (const [from, up] of Object.entries(UPGRADES)) {
      expect(UNITS[from as keyof typeof UNITS].upgradesTo).toBe(up?.to);
    }
  });

  it("carries prototype balance", () => {
    expect(UNITS.lich).toMatchObject({ hp: 30, atk: 13, def: 10, dmg: [11, 13], spd: 6, cost: 550, shots: 12, splash: true });
    expect(UNITS.royalGriffin).toMatchObject({ spd: 9, cost: 300, fly: true, unlimRetal: true });
    expect(UNITS.ghost.noRetal).toBe(true);
    expect(UNITS.pike.antiFly && UNITS.halberd.antiFly).toBe(true);
  });

  it("faction units belong to their faction", () => {
    for (const [f, list] of Object.entries(FACTION_UNITS)) for (const u of list) expect(UNITS[u].faction).toBe(f);
  });
});

describe("artifacts", () => {
  const slotIds = new Set<string>(SLOTS.map((s) => s.id));
  it("have valid slots, stats and sets", () => {
    for (const id of ARTIFACT_IDS) {
      const a = ARTIFACTS[id];
      expect(a.id).toBe(id);
      const slot: string = a.slot;
      expect(slot === "ring" || (slotIds.has(slot) && slot !== "ring1" && slot !== "ring2")).toBe(true);
      for (const k of Object.keys(a.fx)) expect(STAT_KEYS).toContain(k);
      if (a.set) expect(SETS[a.set]).toBeDefined();
    }
  });
  it("ash set has enough pieces", () => {
    expect(ARTIFACT_IDS.filter((id) => ARTIFACTS[id].set === "ash").length).toBeGreaterThanOrEqual(SETS.ash.need);
  });
  it("drop pool is valid", () => {
    expect([...DROP_POOL]).toEqual(["windCloak", "valorPauldrons", "mageRing", "rookieMail", "luckAmulet"]);
  });
});

describe("other data", () => {
  it("buildings, spells, skills, quests, shop are consistent", () => {
    expect(BUILDINGS.griffinTower.cost).toBe(2000);
    expect(BUILDINGS.mageGuild.cost).toBe(1500);
    expect(BUILDINGS.forge.cost).toBe(1000);
    for (const s of Object.values(SPELLS)) if (s.requires) expect(BUILDINGS[s.requires]).toBeDefined();
    expect(SPELLS.bolt.target).toBe("enemy");
    expect(SPELLS.heal.requires).toBe("mageGuild");
    for (const id of SKILL_IDS) expect(STAT_KEYS).toContain(SKILLS[id].stat);
    expect(QUESTS.map((q) => q.id)).toEqual(["chest", "mine", "fight", "artifact", "build", "upgrade", "level3", "conquer"]);
    const ids = new Set(SHOP_ITEMS.map((i) => i.id));
    expect(ids.size).toBe(SHOP_ITEMS.length);
    for (const i of SHOP_ITEMS) {
      expect(i.pricePi).toBeGreaterThan(0);
      if (i.grants.startArtifact) expect(ARTIFACTS[i.grants.startArtifact]).toBeDefined();
    }
  });

  it("weekly growth follows the rules", () => {
    expect(weeklyGrowth("castle", 2, {})).toEqual({ pike: 10, archer: 6 });
    expect(weeklyGrowth("castle", 2, { griffinTower: true })).toEqual({ pike: 10, archer: 6, griffin: 3 });
    // prototype weekly tick: skel +12, ghost +5, lich +2 from week 2 (the start pool 8/3/0 is different)
    expect(weeklyGrowth("necropolis", 1, {})).toEqual({ skeleton: 12, ghost: 5 });
    expect(weeklyGrowth("necropolis", 2, {})).toEqual({ skeleton: 12, ghost: 5, lich: 2 });
    expect(START_GROWTH.necropolis).toEqual({ skeleton: 8, ghost: 3, lich: 0 });
  });
});

describe("maps", () => {
  for (const map of Object.values(MAPS)) {
    describe(map.id, () => {
      it("has consistent dimensions", () => {
        expect(map.terrain.length).toBe(map.rows);
        for (const row of map.terrain) {
          expect(row.length).toBe(map.cols);
          expect(/^[.FMW]+$/.test(row)).toBe(true);
        }
      });
      it("places every object and hero start on passable terrain, no overlaps", () => {
        const seen = new Set<string>();
        for (const o of map.objects) {
          expect(isPassable(map.terrain, o.x, o.y), `${o.kind} at ${o.x},${o.y}`).toBe(true);
          const k = `${o.x},${o.y}`;
          expect(seen.has(k), `duplicate ${k}`).toBe(false);
          seen.add(k);
          if (o.kind === "artifact") expect(o.artifact && ARTIFACTS[o.artifact]).toBeTruthy();
          if (o.kind === "monster") expect(o.army?.length).toBeGreaterThan(0);
          for (const s of [...(o.army ?? []), ...(o.garrison ?? [])]) expect(UNITS[s.unit]).toBeDefined();
        }
        map.starts.forEach((s, seat) => {
          expect(isPassable(map.terrain, s.hero.x, s.hero.y)).toBe(true);
          const castle = map.objects[s.castleIndex];
          expect(castle?.kind).toBe("castle");
          expect(castle?.owner).toBe(seat);
          for (const st of s.army ?? []) expect(UNITS[st.unit]).toBeDefined();
        });
      });
    });
  }

  it("valley matches the prototype setup", () => {
    const v = MAPS.valley!;
    expect(v.cols).toBe(14);
    expect(v.rows).toBe(16);
    expect(v.starts[0]).toMatchObject({ hero: { x: 3, y: 13 }, gold: 2500, faction: "castle" });
    expect(v.starts[1]).toMatchObject({ hero: { x: 11, y: 2 }, gold: 2500, equipped: { weapon: "ashBlade", shield: "shield" } });
    expect(v.objects.filter((o) => o.kind === "monster").length).toBe(7);
    expect(v.objects.filter((o) => o.kind === "chest").length).toBe(4);
    expect(v.objects.filter((o) => o.kind === "artifact").length).toBe(7);
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(MAPS))).toEqual(MAPS);
  });
});
