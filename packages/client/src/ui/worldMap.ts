/**
 * The Seasonal Wasteland map: named locations with heraldic badges and level marks over the painted world,
 * glowing territory borders per clan (or per player without a clan), events and the player's camp.
 * The map is larger than a phone screen and pans by touch; a button fits it to the width.
 */
import { WORLD_COLS, WORLD_LAYOUT, WORLD_ROWS, sectorRing } from "@korony/shared";
import type { SectorKind, WorldSectorView, WorldView } from "@korony/shared";
import { artUrl } from "../gfx/artUrls";
import { getLang, t } from "../i18n";
import { h } from "./dom";

const NAMES: Record<"ru" | "en", Partial<Record<SectorKind, readonly string[]>>> = {
  ru: {
    mine: ["Ржавый карьер", "Медная шахта", "Угольный разрез", "Старая выработка", "Железный карьер", "Глубокая шахта", "Сланцевый разрез", "Шахта «Восток»"],
    ruins: [
      "Мёртвый город", "Руины вокзала", "Старый завод", "Разбитый мост", "Руины больницы", "Затопленный квартал",
      "Руины телебашни", "Сгоревший рынок", "Руины школы", "Разрушенный склад", "Руины депо", "Старая церковь",
    ],
    zone: [
      "Альфа", "Бета", "Гамма", "Дельта", "Эпсилон", "Дзета", "Эта", "Тета", "Йота",
      "Каппа", "Лямбда", "Мю", "Ню", "Кси", "Омикрон", "Пи", "Ро", "Сигма",
    ],
    fort: ["Северный форт", "Западный форт", "Восточный форт", "Южный форт"],
    citadel: ["Цитадель"],
  },
  en: {
    mine: ["Rusty Quarry", "Copper Mine", "Coal Pit", "Old Diggings", "Iron Quarry", "Deep Mine", "Shale Pit", "East Mine"],
    ruins: [
      "Dead City", "Station Ruins", "Old Factory", "Broken Bridge", "Hospital Ruins", "Flooded Block",
      "TV Tower Ruins", "Burnt Market", "School Ruins", "Ruined Depot", "Tram Yard", "Old Church",
    ],
    zone: [
      "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota",
      "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma",
    ],
    fort: ["North Fort", "West Fort", "East Fort", "South Fort"],
    citadel: ["The Citadel"],
  },
};

const COLS = "ABCDEFGHI";

/** Position of (x, y) among the sectors of the same kind, in reading order. */
function kindIndex(x: number, y: number): number {
  const ch = WORLD_LAYOUT[y]?.[x];
  let n = 0;
  for (let yy = 0; yy < WORLD_ROWS; yy++) {
    for (let xx = 0; xx < WORLD_COLS; xx++) {
      if (yy === y && xx === x) return n;
      if (WORLD_LAYOUT[yy]?.[xx] === ch) n++;
    }
  }
  return n;
}

/** Display name of a sector: its own name, or the kind with coordinates for plain wasteland. */
export function sectorName(s: Pick<WorldSectorView, "kind" | "x" | "y">): string {
  const lang = getLang() === "en" ? "en" : "ru";
  const list = NAMES[lang][s.kind];
  const own = list?.[kindIndex(s.x, s.y)];
  if (own && s.kind === "zone") return `${t("world.kind.zone")} «${own}»`;
  if (own) return own;
  return `${t(`world.kind.${s.kind}` as Parameters<typeof t>[0])} ${COLS[s.x] ?? "?"}${s.y + 1}`;
}

/** Short name for the map label: zones drop the "Contamination zone" prefix (the badge icon says it). */
function mapName(s: Pick<WorldSectorView, "kind" | "x" | "y">): string {
  const lang = getLang() === "en" ? "en" : "ru";
  const own = s.kind === "zone" ? NAMES[lang].zone?.[kindIndex(s.x, s.y)] : undefined;
  return own ?? sectorName(s);
}

const KIND_BONUS: Record<SectorKind, number> = { waste: 0, mine: 1, ruins: 1, zone: 2, fort: 2, citadel: 1 };

/** Danger level shown on the badge: grows towards the centre. */
export function sectorLevel(s: Pick<WorldSectorView, "kind" | "x" | "y">): number {
  return 1 + (4 - sectorRing(s.x, s.y)) * 2 + KIND_BONUS[s.kind];
}

// small line icons (static markup, no user data)
const ICONS: Record<string, string> = {
  mine: '<path d="M4 20l9-9M14 4c3 0 6 3 6 6M11 5l8 8M9 7c2-2 5-3 8-2" />',
  ruins: '<path d="M3 21h18M5 21V9l4-2v14M11 21V5l3 2v3M16 21v-8l4 2v6" /><path d="M14 10l2 1" />',
  zone: '<circle cx="12" cy="12" r="2" /><path d="M12 10V3a9 9 0 0 1 7.8 4.5L13.7 11M10.3 11 4.2 7.5A9 9 0 0 1 12 3M13.7 13l6.1 3.5A9 9 0 0 1 12 21v-7M10.3 13 4.2 16.5" />',
  fort: '<path d="M4 21V8h3v2h2V8h3v2h2V8h3v2h2V8h1v13z" /><path d="M10 21v-5h4v5" />',
  citadel: '<path d="M3 18h18l-2-10-4 4-3-7-3 7-4-4z" /><path d="M3 21h18" />',
  waste: '<circle cx="12" cy="12" r="3" />',
  boss: '<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.3 4.2 3 5.3V19h8v-3.7c1.7-1.1 3-2.8 3-5.3a7 7 0 0 0-7-7z" /><circle cx="9.5" cy="10.5" r="1.4" /><circle cx="14.5" cy="10.5" r="1.4" /><path d="M10 19v2M14 19v2" />',
  cache: '<path d="M3 8l9-4 9 4v9l-9 4-9-4z" /><path d="M3 8l9 4 9-4M12 12v9" />',
  camp: '<path d="M2 20L12 4l10 16z" /><path d="M9 20l3-6 3 6" />',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />',
};

export function icon(name: string, cls = "wico"): HTMLElement {
  const span = h("span", { class: cls });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
  return span;
}

export interface MapDeps {
  view: WorldView;
  interactive: boolean;
  selected: number | null;
  zoomed: boolean;
  clanColor(clanId: string | null): string | null;
  onSelect(id: number): void;
  onToggleZoom(): void;
}

/** Territory owner key: the clan, or the player when not in a clan. */
function owner(s: WorldSectorView): string | null {
  return s.holder ? (s.clanId ?? `p:${s.holder}`) : null;
}

/** Colour of a sector's owner for the viewer: gold for you, the clan colour, pale for clanless players. */
function ownerColor(d: MapDeps, s: WorldSectorView): string | null {
  if (!s.holder) return null;
  const me = d.view.me;
  if (me && s.holder === me.id && !me.clanId) return "#ffd76a";
  return d.clanColor(s.clanId) ?? "#e8e2d0";
}

let lastScroll: { left: number; top: number } | null = null;

export function worldMap(d: MapDeps): HTMLElement {
  const v = d.view;
  const me = v.me;
  const map = h("div", { class: d.zoomed ? "wmap zoomed" : "wmap", testid: "world-map" });
  const cw = 100 / v.cols;
  const ch = 100 / v.rows;
  const byXY = (x: number, y: number): WorldSectorView | undefined => v.sectors[y * v.cols + x];

  // territory: tinted cells and glowing borders where the owner changes
  for (const s of v.sectors) {
    const own = owner(s);
    if (!own) continue;
    const color = ownerColor(d, s) ?? "#fff";
    const tint = h("div", { class: "wterr" });
    tint.style.cssText = `left:${s.x * cw}%;top:${s.y * ch}%;width:${cw}%;height:${ch}%;--c:${color}`;
    map.append(tint);
    const sides: [number, number, string][] = [[0, -1, "t"], [0, 1, "b"], [-1, 0, "l"], [1, 0, "r"]];
    for (const [dx, dy, side] of sides) {
      const n = byXY(s.x + dx, s.y + dy);
      if (n && owner(n) === own) continue;
      const edge = h("div", { class: `wedge ${side}` });
      edge.style.cssText = `left:${(s.x + (side === "r" ? 1 : 0)) * cw}%;top:${(s.y + (side === "b" ? 1 : 0)) * ch}%;` +
        (side === "t" || side === "b" ? `width:${cw}%` : `height:${ch}%`) + `;--c:${color}`;
      map.append(edge);
    }
  }

  // locations
  for (const s of v.sectors) {
    const color = ownerColor(d, s);
    const special = s.kind !== "waste";
    const isCamp = !!me && me.camp === s.id;
    const cls = ["wpoi", `k-${s.kind}`];
    if (!special && !s.event && !isCamp) cls.push("small");
    if (d.interactive && s.reachable) cls.push("reach");
    if (d.selected === s.id) cls.push("sel");
    if (color) cls.push("owned");
    const badgeIcon = s.event === "boss" ? "boss" : s.event === "cache" ? "cache" : isCamp && !special ? "camp" : s.kind;
    const showLabel = special || !!s.event || isCamp || d.selected === s.id;
    const poi = h(
      "button",
      {
        class: cls.join(" "),
        testid: `sector-${s.id}`,
        ariaLabel: sectorName(s),
        onClick: () => {
          if (d.interactive) d.onSelect(s.id);
        },
      },
      h("span", { class: `wbadge${s.event ? ` ev-${s.event}` : ""}` }, icon(badgeIcon)),
      special || s.event ? h("b", { class: "wlvl" }, sectorLevel(s)) : null,
      showLabel ? h("span", { class: "wlabel" }, isCamp && !special ? t("world.camp") : mapName(s)) : null,
    );
    poi.style.left = `${(s.x + 0.5) * cw}%`;
    poi.style.top = `${(s.y + 0.5) * ch}%`;
    if (color) poi.style.setProperty("--c", color);
    map.append(poi);
  }

  const legend = h(
    "div",
    { class: "wlegend" },
    [
      ["#ffd76a", t("world.legend.you")],
      ["#4a90e2", t("world.legend.clans")],
      ["#c0392b", t("world.legend.raiders")],
      ["rgba(255,225,120,.8)", t("world.legend.reach")],
    ].map(([c, label]) => h("span", null, h("i", { style: `background:${c}` }), label)),
  );
  const fit = h("button", { class: "wfit icon-btn", ariaLabel: t("world.fit"), onClick: () => d.onToggleZoom() }, icon("fit"));
  const scroller = h("div", { class: "wmap-scroll" }, map);
  const wrap = h("div", { class: "wmap-wrap" }, scroller, fit, legend);
  scroller.addEventListener("scroll", () => {
    lastScroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
  });
  // keep the pan position across re-renders; the first time centre on the camp (or the Citadel)
  requestAnimationFrame(() => {
    if (lastScroll) {
      scroller.scrollLeft = lastScroll.left;
      scroller.scrollTop = lastScroll.top;
      return;
    }
    const focus = (me ? v.sectors[me.camp] : undefined) ?? byXY(Math.floor(v.cols / 2), Math.floor(v.rows / 2));
    if (!focus) return;
    scroller.scrollLeft = ((focus.x + 0.5) / v.cols) * map.clientWidth - scroller.clientWidth / 2;
    scroller.scrollTop = ((focus.y + 0.5) / v.rows) * map.clientHeight - scroller.clientHeight / 2;
  });
  return wrap;
}

/** Forget the pan position (logout, leaving the world). */
export function resetMapScroll(): void {
  lastScroll = null;
}

/** Hero portrait for the HUD. */
export function portraitUrl(): string {
  return artUrl("portrait-player");
}
