import { SHOP_ITEMS } from "@korony/shared";
import type { AuthResponse, PlayerLoadout, ShopItem } from "@korony/shared";
import type { UserRecord } from "./store";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type PublicUser = AuthResponse["user"];

/** The user as the client sees it (AuthResponse.user). */
export function publicUser(u: UserRecord): PublicUser {
  return { uid: u.uid, username: u.username, premiumUntil: u.premiumUntil, banner: u.banner, owned: [...u.owned] };
}

/** A fresh user record for a session whose user is not in the store (e.g. after a MemoryStore restart). */
export function blankUser(uid: string, username: string, now: number): UserRecord {
  return { uid, username, premiumUntil: null, banner: null, owned: [], createdAt: now };
}

/**
 * What buying `item` gives: premiumDays extend premium (from now or from the current end, whichever is later),
 * a banner becomes the active banner and is owned, loadout items become owned. Pure: returns a new record.
 */
export function applyGrant(user: UserRecord, item: ShopItem, now: number): UserRecord {
  const next: UserRecord = { ...user, owned: [...user.owned] };
  const g = item.grants;
  if (g.premiumDays !== undefined && g.premiumDays > 0) {
    const from = Math.max(now, user.premiumUntil ?? 0);
    next.premiumUntil = from + g.premiumDays * DAY_MS;
  }
  if (g.banner) next.banner = g.banner;
  // Premium is time-limited and can be bought again; everything else is a permanent unlock.
  if (item.kind !== "premium" && !next.owned.includes(item.id)) next.owned.push(item.id);
  return next;
}

/**
 * The grant for a payment Pi already reports as completed by us while the store has no record of it (the
 * record was lost, e.g. a MemoryStore restart). Permanent unlocks are restored as by applyGrant, but premium
 * is never counted from now: it can only reach the end the purchase itself gave, `paidAt + premiumDays`
 * (a lower bound of the original expiry), and is not stacked on the current end, so replaying old payments
 * in any order cannot add days. Without a known payment time premium is not restored at all.
 */
export function restoreGrant(user: UserRecord, item: ShopItem, paidAt: number | null, now: number): UserRecord {
  const days = item.grants.premiumDays;
  const next = applyGrant(user, { ...item, grants: { ...item.grants, premiumDays: undefined } }, now);
  if (days !== undefined && days > 0 && paidAt !== null && Number.isFinite(paidAt)) {
    const end = Math.min(paidAt, now) + days * DAY_MS;
    if (end > now && end > (user.premiumUntil ?? 0)) next.premiumUntil = end;
  }
  return next;
}

/** True when buying the item again would give nothing new (owned cosmetics and loadout unlocks). */
export function alreadyOwned(user: UserRecord | null, item: ShopItem): boolean {
  return !!user && item.kind !== "premium" && user.owned.includes(item.id);
}

/**
 * Match loadout from the user's purchases: the most expensive owned start artifact, the sum of start gold
 * bonuses, and the active banner (or the last owned banner in catalog order). Catalog order breaks ties.
 */
export function loadoutFor(user: UserRecord | null): PlayerLoadout {
  const lo: PlayerLoadout = {};
  if (!user) return lo;
  let artifactPrice = -1;
  let gold = 0;
  let banner: string | undefined;
  for (const item of SHOP_ITEMS) {
    if (!user.owned.includes(item.id)) continue;
    const g = item.grants;
    if (g.startArtifact && item.pricePi > artifactPrice) {
      artifactPrice = item.pricePi;
      lo.startArtifact = g.startArtifact;
    }
    if (g.startGold !== undefined && g.startGold > 0) gold += g.startGold;
    if (g.banner) banner = g.banner;
  }
  if (gold > 0) lo.startGold = gold;
  const b = user.banner ?? banner;
  if (b) lo.banner = b;
  return lo;
}

/** Pi amounts are decimals: compare with a tolerance far below the smallest Pi unit. */
export function sameAmount(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
}
