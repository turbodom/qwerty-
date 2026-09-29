import type { ArtifactId } from "./artifacts";

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  pricePi: number;
  kind: "cosmetic" | "premium" | "loadout";
  grants: { banner?: string; premiumDays?: number; startArtifact?: ArtifactId; startGold?: number };
}

/** Catalog priced in Pi. The server takes prices only from here. */
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: "banner_gold", name: "Золотое знамя", desc: "Золотой флаг героя и замка на карте",
    pricePi: 0.5, kind: "cosmetic", grants: { banner: "gold" },
  },
  {
    id: "banner_crimson", name: "Багровое знамя", desc: "Багровый флаг с чёрной каймой",
    pricePi: 0.5, kind: "cosmetic", grants: { banner: "crimson" },
  },
  {
    id: "banner_emerald", name: "Изумрудное знамя", desc: "Редкий изумрудный флаг с гербом",
    pricePi: 1, kind: "cosmetic", grants: { banner: "emerald" },
  },
  {
    id: "premium_30", name: "Премиум на 30 дней", desc: "Отметка премиума в лобби и профиле на 30 дней",
    pricePi: 2, kind: "premium", grants: { premiumDays: 30 },
  },
  {
    id: "loadout_sword", name: "Меч силы в начале", desc: "Герой начинает партию с Мечом силы (+2 атака)",
    pricePi: 1, kind: "loadout", grants: { startArtifact: "sword" },
  },
  {
    id: "loadout_amulet", name: "Амулет удачи в начале", desc: "Герой начинает партию с Амулетом удачи (+1 удача)",
    pricePi: 1.5, kind: "loadout", grants: { startArtifact: "luckAmulet" },
  },
  {
    id: "loadout_gold", name: "Казна полководца", desc: "+1000 золота в начале партии",
    pricePi: 1, kind: "loadout", grants: { startGold: 1000 },
  },
];

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}
