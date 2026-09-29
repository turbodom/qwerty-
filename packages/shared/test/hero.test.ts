import { describe, expect, it } from "vitest";
import type { Hero } from "../src";
import { baseStats, effectiveStat, effectiveStats, equip, heroPower, maxMovement, mergeArmy, pickUp, unequip } from "../src";

function hero(): Hero {
  return {
    id: "h0", owner: "p0", name: "Эльмира", x: 3, y: 13, mp: 12, level: 1, exp: 0, alive: true,
    base: baseStats(), equipped: {}, bag: [], army: [{ unit: "pike", count: 20 }, { unit: "archer", count: 10 }],
  };
}

describe("hero stats", () => {
  it("base stats", () => {
    const h = hero();
    expect(effectiveStat(h, "atk")).toBe(1);
    expect(effectiveStat(h, "pow")).toBe(1);
    expect(effectiveStat(h, "luck")).toBe(0);
    expect(maxMovement(h)).toBe(12);
    expect(effectiveStat(null, "atk")).toBe(0);
  });

  it("adds artifact effects", () => {
    const h = hero();
    pickUp(h, "crown");
    pickUp(h, "boots");
    expect(effectiveStat(h, "atk")).toBe(3);
    expect(effectiveStat(h, "def")).toBe(3);
    expect(effectiveStat(h, "pow")).toBe(2);
    expect(maxMovement(h)).toBe(15);
  });

  it("applies set bonus only with the full set", () => {
    const h = hero();
    pickUp(h, "ashHelm");
    pickUp(h, "ashBlade");
    expect(effectiveStat(h, "dmgPct")).toBe(0);
    expect(effectiveStat(h, "morale")).toBe(0);
    pickUp(h, "ashMail");
    expect(effectiveStat(h, "dmgPct")).toBe(20);
    expect(effectiveStat(h, "morale")).toBe(1);
    expect(effectiveStat(h, "atk")).toBe(1 + 1 + 3);
    expect(effectiveStat(h, "def")).toBe(1 + 1 + 3);
    expect(effectiveStats(h).dmgPct).toBe(20);
    unequip(h, "torso");
    expect(effectiveStat(h, "dmgPct")).toBe(0);
  });
});

describe("equipment", () => {
  it("rings go to ring1 then ring2, then replace ring1", () => {
    const h = hero();
    expect(pickUp(h, "apprenticeRing")).toBe("ring1");
    expect(pickUp(h, "mageRing")).toBe("ring2");
    expect(effectiveStat(h, "pow")).toBe(4);
    h.bag.push("apprenticeRing");
    expect(equip(h, "apprenticeRing")).toBe("ring1");
    expect(h.equipped.ring1).toBe("apprenticeRing");
    expect(h.bag).toEqual(["apprenticeRing"]);
  });

  it("pickUp puts into bag when slot is taken", () => {
    const h = hero();
    expect(pickUp(h, "ashBlade")).toBe("weapon");
    expect(pickUp(h, "sword")).toBe("bag");
    expect(h.bag).toEqual(["sword"]);
  });

  it("equip swaps with bag and unequip returns to bag", () => {
    const h = hero();
    pickUp(h, "ashBlade");
    pickUp(h, "sword");
    expect(equip(h, "sword")).toBe("weapon");
    expect(h.equipped.weapon).toBe("sword");
    expect(h.bag).toEqual(["ashBlade"]);
    expect(unequip(h, "weapon")).toBe("sword");
    expect(h.equipped.weapon).toBeUndefined();
    expect("weapon" in h.equipped).toBe(false);
    expect(h.bag).toEqual(["ashBlade", "sword"]);
    expect(unequip(h, "weapon")).toBeNull();
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });
});

describe("power", () => {
  it("matches the prototype formula", () => {
    const h = hero();
    // pike: 20*10*(1+(4+5+2)/12) ; archer: 10*10*(1+(6+3+2)/12)*1.3
    const expected = 20 * 10 * (1 + 11 / 12) + 10 * 10 * (1 + 11 / 12) * 1.3;
    expect(heroPower(h.army, h)).toBeCloseTo(expected, 6);
    expect(heroPower([{ unit: "wolf", count: 10 }], null)).toBeCloseTo(10 * 6 * (1 + 8 / 12), 6);
  });

  it("stronger with better gear and bigger armies", () => {
    const h = hero();
    const p0 = heroPower(h.army, h);
    pickUp(h, "crown");
    expect(heroPower(h.army, h)).toBeGreaterThan(p0);
  });

  it("mergeArmy merges and drops empty stacks", () => {
    expect(mergeArmy([{ unit: "pike", count: 3 }, { unit: "archer", count: 0 }, { unit: "pike", count: 2 }]))
      .toEqual([{ unit: "pike", count: 5 }]);
  });
});
