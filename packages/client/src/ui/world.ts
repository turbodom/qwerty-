/**
 * Seasonal Wasteland screen: the shared world map with sectors, the player's army and camp, the clan,
 * the rating with the hall of fame, and world events. Everything comes from the server (`/api/world`);
 * this module only renders the WorldView and sends WorldActions.
 */
import { CLAN_CREATE_COST, FORTIFY_COST, SECTOR_RULES, BOSS_REWARD, CACHE_GOLD, ENERGY_MAX } from "@korony/shared";
import type { ArmyStack, PlayableFaction, SectorKind, UnitId, WorldAction, WorldBattleReport, WorldLogEntry, WorldSectorView, WorldView } from "@korony/shared";
import { api } from "../api";
import { artUrl, unitPicUrl } from "../gfx/artUrls";
import { fmtNum, t } from "../i18n";
import type { I18nKey } from "../i18n";
import { countLabel, engineText, unitName } from "../i18n/catalog";
import { clear, h } from "./dom";
import { icon, portraitUrl, resetMapScroll, sectorLevel, sectorName, worldMap } from "./worldMap";

export interface WorldScreenApi {
  back(): void;
  toast(text: string, kind?: "info" | "error"): void;
}

type Tab = "map" | "clan" | "rating" | "events";

/** Clan colours by WorldClan.color (the raider clans use the last ones). */
export const CLAN_COLORS: readonly string[] = ["#4a90e2", "#f0c040", "#9b6bff", "#3fd29a", "#ff6fae", "#e8803a", "#c0392b", "#8d9199"];

const REFRESH_MS = 30_000;

// module state survives re-renders (language switch, returning to the screen)
let view: WorldView | null = null;
let loadError = "";
let loading = false;
let busy = false;
let tab: Tab = "map";
let selected: number | null = null;
let report: WorldBattleReport | null = null;
let clanName = "";
let clanTag = "";
let donate = "";
let fetchedAt = 0;
let clockOffset = 0;
let zoomed = true;


export function sectorLabel(s: Pick<WorldSectorView, "kind" | "x" | "y">): string {
  return sectorName(s);
}

/** Server time now (the view carries the server clock; the offset absorbs a skewed phone clock). */
function serverNow(): number {
  return Date.now() + clockOffset;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

function setView(v: WorldView): void {
  view = v;
  fetchedAt = Date.now();
  clockOffset = v.now - fetchedAt;
  if (selected !== null && !v.sectors[selected]) selected = null;
}

function chips(army: readonly ArmyStack[]): HTMLElement {
  const list = army.filter((s) => s.count > 0 || s.countHint);
  return h(
    "div",
    { class: "chips" },
    list.map((s) => {
      const count = s.countHint ? countLabel(s.countHint) : fmtNum(s.count);
      return h("span", { class: "chip", title: `${unitName(s.unit)} ${count}` }, h("img", { src: unitPicUrl(s.unit), alt: "" }), `${unitName(s.unit)} ${count}`);
    }),
  );
}

function clanById(id: string | null): WorldView["clans"][number] | undefined {
  return id && view ? view.clans.find((c) => c.id === id) : undefined;
}

function holderText(s: WorldSectorView): string {
  if (!s.holder) return t("world.holderNone");
  const c = clanById(s.clanId);
  const name = c ? `${s.holderName ?? "?"} [${c.tag}]` : (s.holderName ?? "?");
  return t("world.holder", { name });
}

// ================= screen =================

let root: HTMLElement | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let screenApi: WorldScreenApi | null = null;

export function worldScreen(sapi: WorldScreenApi): HTMLElement {
  screenApi = sapi;
  root = h("div", { class: "world", testid: "world" });
  render();
  if (!view || Date.now() - fetchedAt > REFRESH_MS / 3) void load();
  if (ticker) clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  return root;
}

function tick(): void {
  if (!root || !root.isConnected) {
    if (ticker) clearInterval(ticker);
    ticker = null;
    return;
  }
  if (!busy && !loading && Date.now() - fetchedAt > REFRESH_MS) {
    void load();
    return;
  }
  // day and energy countdowns
  const v = view;
  if (!v) return;
  const now = serverNow();
  if (now >= v.dayEndsAt || (v.me?.nextEnergyAt && now >= v.me.nextEnergyAt)) {
    if (!loading && Date.now() - fetchedAt > 2000) void load();
    return;
  }
  const day = root.querySelector<HTMLElement>("[data-clock=day]");
  if (day) day.textContent = t("world.dayEnds", { time: fmtDuration(v.dayEndsAt - now) });
  const en = root.querySelector<HTMLElement>("[data-clock=energy]");
  if (en && v.me?.nextEnergyAt) en.textContent = t("world.energyNext", { time: fmtDuration(v.me.nextEnergyAt - now) });
}

async function load(): Promise<void> {
  loading = true;
  try {
    setView(await api.world());
    loadError = "";
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  } finally {
    loading = false;
    render();
  }
}

async function act(action: WorldAction): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try {
    const res = await api.worldAction(action);
    setView(res.view);
    if (!res.result.ok) screenApi?.toast(engineText(res.result.error ?? "?"), "error");
    else if (res.result.report) report = res.result.report;
  } catch (e) {
    screenApi?.toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    busy = false;
    render();
  }
}

function render(): void {
  if (!root) return;
  const scroller = root.closest(".screen");
  const scroll = scroller?.scrollTop ?? 0;
  clear(root);
  root.append(header());
  const v = view;
  if (!v) {
    root.append(
      h(
        "div",
        { class: "card" },
        loadError
          ? [
              h("p", { class: "error-text" }, t("world.loadFailed", { message: loadError })),
              h("button", { class: "btn block", onClick: () => void load() }, t("world.retry")),
            ]
          : [h("div", { class: "spinner" }), h("p", { class: "fx", style: "text-align:center" }, t("world.loading"))],
      ),
    );
    return;
  }
  if (!v.me) {
    root.append(mapBlock(v, false), joinCard());
  } else {
    root.append(statsBar(v));
    if (tab === "map") root.append(mapBlock(v, true), sectorCard(v), armyCard(v));
    else if (tab === "clan") root.append(clanTab(v));
    else if (tab === "rating") root.append(ratingTab(v));
    else root.append(eventsTab(v));
    root.append(tabs());
  }
  if (report) root.append(reportModal(v, report));
  if (scroller) scroller.scrollTop = scroll;
}

function header(): HTMLElement {
  const v = view;
  const clock = v ? h("small", { class: "clock" }, t("world.dayEnds", { time: fmtDuration(v.dayEndsAt - serverNow()) })) : null;
  if (clock) clock.dataset["clock"] = "day";
  return h(
    "div",
    { class: "world-head" },
    h("button", { class: "btn ghost small", testid: "world-back", onClick: () => screenApi?.back() }, `‹ ${t("world.back")}`),
    h(
      "div",
      { class: "world-title" },
      h("h2", null, t("world.title")),
      v ? h("small", null, t("world.seasonDay", { season: v.season, day: v.day, days: v.seasonDays })) : null,
      clock,
    ),
  );
}

function statsBar(v: WorldView): HTMLElement {
  const me = v.me;
  if (!me) return h("div");
  const clan = clanById(me.clanId);
  const energyNext = me.nextEnergyAt ? h("small", null, t("world.energyNext", { time: fmtDuration(me.nextEnergyAt - serverNow()) })) : null;
  if (energyNext) energyNext.dataset["clock"] = "energy";
  return h(
    "div",
    { class: "whud", testid: "world-stats" },
    h(
      "div",
      { class: "whud-me" },
      h("img", { class: "whud-portrait", src: portraitUrl(), alt: "" }),
      h(
        "div",
        null,
        h("b", null, me.name, clan ? h("small", null, ` [${clan.tag}]`) : null),
        h("small", null, `${t("world.rank", { n: me.rank })} · ${t("world.power", { n: fmtNum(me.power) })}`),
      ),
    ),
    h("div", { class: "whud-res" }, h("span", { class: "coin" }), h("b", { testid: "world-gold" }, fmtNum(me.gold))),
    h(
      "div",
      { class: "whud-res energy" },
      h("span", { class: "bolt" }, "⚡"),
      h("div", null, h("b", null, `${me.energy}/${me.energyMax}`), energyNext),
    ),
  );
}

const TAB_ICONS: Record<Tab, string> = { map: "citadel", clan: "fort", rating: "mine", events: "boss" };

function tabs(): HTMLElement {
  const items: Tab[] = ["map", "clan", "rating", "events"];
  return h(
    "div",
    { class: "wtabs", role: "tablist" },
    items.map((id) =>
      h(
        "button",
        {
          class: tab === id ? "wtab active" : "wtab",
          role: "tab",
          testid: `world-tab-${id}`,
          onClick: () => {
            tab = id;
            render();
          },
        },
        icon(TAB_ICONS[id]),
        h("span", null, t(`world.tab.${id}` as I18nKey)),
      ),
    ),
  );
}

// ================= map =================

function mapBlock(v: WorldView, interactive: boolean): HTMLElement {
  return worldMap({
    view: v,
    interactive,
    selected,
    zoomed,
    clanColor: (id) => {
      const c = clanById(id);
      return c ? (CLAN_COLORS[c.color] ?? null) : null;
    },
    onSelect: (id) => {
      selected = selected === id ? null : id;
      render();
    },
    onToggleZoom: () => {
      zoomed = !zoomed;
      resetMapScroll();
      render();
    },
  });
}

function oddsKey(enemy: number, mine: number): I18nKey {
  if (enemy * 1.5 <= mine) return "world.odds.easy";
  if (enemy <= mine * 1.1) return "world.odds.even";
  return "world.odds.hard";
}

function sectorCard(v: WorldView): HTMLElement {
  const me = v.me;
  const s = selected !== null ? v.sectors[selected] : undefined;
  if (!me || !s) return h("div", { class: "card wcard" }, h("p", { class: "fx" }, t("world.tapSector")));
  const rule = SECTOR_RULES[s.kind];
  const clan = clanById(me.clanId);
  const own = s.holder === me.id;
  const allied = own || (!!s.clanId && s.clanId === me.clanId);
  const card = h(
    "div",
    { class: "card wcard", testid: "sector-card" },
    h("h3", null, h("span", { class: "lvl" }, sectorLevel(s)), sectorLabel(s)),
    h("p", { class: "fx" }, t("world.sectorInfo", { income: rule.income, score: rule.score })),
    s.kind === "citadel" ? h("p", { class: "fx" }, t("world.citadelHint")) : null,
    h("p", null, own ? t("world.yours") : allied && clan ? t("world.clanLand", { name: clan.name }) : holderText(s)),
    me.camp === s.id ? h("p", { class: "fx" }, t("world.camp")) : null,
  );
  const ev = v.events.find((e) => e.sector === s.id);
  if (ev) {
    card.append(
      h(
        "p",
        { class: "wevent" },
        ev.kind === "boss" ? t("world.event.boss", { gold: fmtNum(BOSS_REWARD) }) : t("world.event.cache", { gold: fmtNum(CACHE_GOLD) }),
        " ",
        h("small", null, t("world.eventUntil", { day: ev.untilDay })),
      ),
    );
  }
  card.append(h("div", { class: "label" }, t("world.guard")), s.guard.length ? chips(s.guard) : h("p", { class: "fx" }, t("world.guardEmpty")));
  if (!allied) {
    card.append(
      h(
        "p",
        { class: `odds ${oddsKey(s.power, me.power).split(".").pop() ?? ""}` },
        `${t("world.odds", { enemy: fmtNum(s.power), mine: fmtNum(me.power) })} · ${t(oddsKey(s.power, me.power))}`,
      ),
    );
    if (s.reachable) {
      card.append(
        h(
          "button",
          { class: "btn block", testid: "world-attack", disabled: busy || me.energy < 1, onClick: () => void act({ type: "attack", sector: s.id }) },
          `${t("world.attack")} · ⚡1`,
        ),
      );
    } else {
      card.append(h("p", { class: "fx" }, t("world.notReachable")));
    }
  }
  if (own) {
    card.append(
      h(
        "div",
        { class: "row2" },
        h("button", { class: "btn ghost", disabled: busy, onClick: () => void act({ type: "reinforce", sector: s.id }) }, t("world.reinforce")),
        h("button", { class: "btn ghost", disabled: busy, onClick: () => void act({ type: "withdraw", sector: s.id }) }, t("world.withdraw")),
      ),
    );
  }
  if (allied && clan && clan.leader === me.id) {
    card.append(
      h(
        "button",
        { class: "btn ghost block", disabled: busy || (clan.treasury ?? 0) < FORTIFY_COST, onClick: () => void act({ type: "fortify", sector: s.id }) },
        t("world.fortify", { cost: fmtNum(FORTIFY_COST) }),
      ),
    );
  }
  return card;
}

function armyCard(v: WorldView): HTMLElement {
  const me = v.me;
  if (!me) return h("div");
  const recruits = (Object.entries(me.growth) as [UnitId, number][]).filter(([, n]) => n > 0).map(([unit, count]) => ({ unit, count }));
  return h(
    "div",
    { class: "card wcard", testid: "world-army" },
    h("h3", null, t("world.army")),
    me.army.length ? chips(me.army) : h("p", { class: "fx" }, t("world.armyEmpty")),
    recruits.length
      ? [
          h("div", { class: "label" }, t("world.recruits")),
          chips(recruits),
          h("button", { class: "btn block", testid: "world-hire", disabled: busy, onClick: () => void act({ type: "hire" }) }, t("world.hire")),
        ]
      : h("p", { class: "fx" }, t("world.noRecruits")),
  );
}

function joinCard(): HTMLElement {
  const side = (f: PlayableFaction, unit: UnitId): HTMLElement =>
    h(
      "button",
      { class: "wfaction", testid: `world-join-${f}`, disabled: busy, onClick: () => void act({ type: "join", faction: f }) },
      h("img", { src: unitPicUrl(unit), alt: "" }),
      h("b", null, t(`world.faction.${f}` as I18nKey)),
      h("small", null, t(`world.factionDesc.${f}` as I18nKey)),
      h("span", { class: "btn small" }, t("world.join")),
    );
  return h(
    "div",
    { class: "card wcard" },
    h("h3", null, t("world.joinTitle")),
    h("p", { class: "fx" }, t("world.joinText", { energy: ENERGY_MAX })),
    h("div", { class: "row2" }, side("castle", "marksman"), side("necropolis", "lich")),
    view ? h("p", { class: "fx", style: "text-align:center" }, t("world.players", { n: view.players })) : null,
  );
}

// ================= clan =================

function clanTab(v: WorldView): HTMLElement {
  const me = v.me;
  const wrap = h("div", { class: "wtabbody" });
  if (!me) return wrap;
  const mine = clanById(me.clanId);
  if (mine) {
    const amount = h("input", {
      class: "field", placeholder: t("world.clan.amount"), value: donate, maxLength: 9, ariaLabel: t("world.clan.amount"),
      onInput: (e) => { donate = (e.target as HTMLInputElement).value; },
    });
    amount.setAttribute("inputmode", "numeric");
    wrap.append(
      h(
        "div",
        { class: "card wcard", testid: "my-clan" },
        h("h3", null, h("span", { class: "clan-dot", style: `background:${CLAN_COLORS[mine.color] ?? "#fff"}` }), `${mine.name} [${mine.tag}]`),
        h("p", null, t("world.clan.score", { score: fmtNum(mine.score), sectors: mine.sectors })),
        h("p", null, h("span", { class: "coin" }), " ", t("world.clan.treasury", { amount: fmtNum(mine.treasury ?? 0) })),
        h("p", { class: "fx" }, t("world.clan.fortifyHint")),
        h(
          "div",
          { class: "seg", style: "grid-template-columns: 1fr auto" },
          amount,
          h("button", {
            class: "btn ghost", disabled: busy,
            onClick: () => {
              const n = Math.floor(Number(donate));
              if (n > 0) {
                donate = "";
                void act({ type: "donate", amount: n });
              }
            },
          }, t("world.clan.donate")),
        ),
        h("div", { class: "label" }, t("world.clan.members", { n: mine.members.length })),
        h(
          "ol",
          { class: "wlist" },
          mine.members.map((m) => h("li", null, h("span", null, m.name, m.id === mine.leader ? h("small", null, ` · ${t("world.clan.leader")}`) : null), h("b", null, fmtNum(m.score)))),
        ),
        h("button", { class: "btn ghost block", disabled: busy, onClick: () => void act({ type: "leaveClan" }) }, t("world.clan.leave")),
      ),
    );
  } else {
    const name = h("input", {
      class: "field", placeholder: t("world.clan.name"), value: clanName, maxLength: 24, ariaLabel: t("world.clan.name"), testid: "clan-name",
      onInput: (e) => { clanName = (e.target as HTMLInputElement).value; },
    });
    const tag = h("input", {
      class: "field", placeholder: t("world.clan.tag"), value: clanTag, maxLength: 4, ariaLabel: t("world.clan.tag"), testid: "clan-tag",
      onInput: (e) => { clanTag = (e.target as HTMLInputElement).value; },
    });
    wrap.append(
      h(
        "div",
        { class: "card wcard" },
        h("p", { class: "fx" }, t("world.clan.none")),
        name,
        tag,
        h("button", {
          class: "btn block", testid: "clan-create", disabled: busy || me.gold < CLAN_CREATE_COST,
          onClick: () => void act({ type: "createClan", name: clanName.trim(), tag: clanTag.trim() }),
        }, t("world.clan.create", { cost: fmtNum(CLAN_CREATE_COST) })),
      ),
    );
  }
  wrap.append(
    h(
      "div",
      { class: "card wcard" },
      h("h3", null, t("world.clan.list")),
      h(
        "ol",
        { class: "wlist" },
        v.clans.map((c) =>
          h(
            "li",
            null,
            h(
              "span",
              null,
              h("span", { class: "clan-dot", style: `background:${CLAN_COLORS[c.color] ?? "#fff"}` }),
              `${c.name} [${c.tag}]`,
              h("small", null, ` · ${t("world.clan.score", { score: fmtNum(c.score), sectors: c.sectors })}`),
              c.bot ? h("small", { class: "muted" }, ` · ${t("world.clan.raiders")}`) : null,
            ),
            !mine && !c.bot
              ? h("button", { class: "btn small", disabled: busy, onClick: () => void act({ type: "joinClan", clanId: c.id }) }, t("world.clan.join"))
              : null,
          ),
        ),
      ),
    ),
  );
  return wrap;
}

// ================= rating and events =================

function ratingTab(v: WorldView): HTMLElement {
  const me = v.me;
  return h(
    "div",
    { class: "wtabbody" },
    h(
      "div",
      { class: "card wcard" },
      h("h3", null, t("world.rating.clans")),
      h(
        "ol",
        { class: "wlist" },
        v.clans.map((c) =>
          h(
            "li",
            { class: me?.clanId === c.id ? "me" : "" },
            h("span", null, h("span", { class: "clan-dot", style: `background:${CLAN_COLORS[c.color] ?? "#fff"}` }), `${c.name} [${c.tag}]`),
            h("b", null, fmtNum(c.score)),
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "card wcard" },
      h("h3", null, t("world.rating.players")),
      h(
        "ol",
        { class: "wlist" },
        v.rating.map((r) =>
          h("li", { class: me?.id === r.id ? "me" : "" }, h("span", null, r.name, r.clanTag ? h("small", null, ` [${r.clanTag}]`) : null), h("b", null, fmtNum(r.score))),
        ),
      ),
    ),
    h(
      "div",
      { class: "card wcard" },
      h("h3", null, t("world.rating.fame")),
      v.hallOfFame.length
        ? h(
            "ol",
            { class: "wlist" },
            v.hallOfFame.map((f) =>
              h(
                "li",
                null,
                h("span", null, t("world.rating.fameRow", { season: f.season, clan: f.clan ? `${f.clan} [${f.tag ?? ""}]` : t("world.rating.noWinner") })),
                h("b", null, fmtNum(f.score)),
              ),
            ),
          )
        : h("p", { class: "fx" }, t("world.rating.fameEmpty")),
    ),
  );
}

export function logText(v: Pick<WorldView, "sectors">, e: WorldLogEntry): string {
  const sec = e.sector !== undefined ? v.sectors[e.sector] : undefined;
  const sector = sec ? sectorLabel(sec) : "";
  const actor = e.clan && e.kind !== "clanCreated" && e.kind !== "season" ? `${e.actor ?? ""} [${e.clan}]` : (e.actor ?? "");
  switch (e.kind) {
    case "capture":
      return e.target ? t("world.log.captureFrom", { actor, sector, target: e.target }) : t("world.log.capture", { actor, sector });
    case "defend":
      return t("world.log.defend", { actor, target: e.target ?? "", sector });
    case "boss":
      return t("world.log.boss", { sector });
    case "bossKilled":
      return t("world.log.bossKilled", { actor });
    case "cache":
      return t("world.log.cache", { sector });
    case "clanCreated":
      return t("world.log.clanCreated", { clan: e.clan ?? "" });
    case "season":
      return t("world.log.season", { n: e.amount ?? 0, clan: e.clan ?? t("world.rating.noWinner") });
    case "fortify":
      return t("world.log.fortify", { actor, sector });
    default:
      return "";
  }
}

function eventsTab(v: WorldView): HTMLElement {
  return h(
    "div",
    { class: "wtabbody" },
    h(
      "div",
      { class: "card wcard" },
      h("h3", null, t("world.events.active")),
      v.events.length
        ? h(
            "ul",
            { class: "wlist" },
            v.events.map((e) => {
              const s = v.sectors[e.sector];
              return h(
                "li",
                null,
                h(
                  "span",
                  null,
                  h("b", null, s ? sectorLabel(s) : ""),
                  " · ",
                  e.kind === "boss" ? t("world.event.boss", { gold: fmtNum(BOSS_REWARD) }) : t("world.event.cache", { gold: fmtNum(CACHE_GOLD) }),
                ),
                h("button", {
                  class: "btn small ghost",
                  onClick: () => {
                    selected = e.sector;
                    tab = "map";
                    render();
                  },
                }, "⌖"),
              );
            }),
          )
        : h("p", { class: "fx" }, t("world.events.none")),
    ),
    h(
      "div",
      { class: "card wcard" },
      h("h3", null, t("world.events.log")),
      h(
        "ul",
        { class: "wlist log" },
        [...v.log].reverse().map((e) => h("li", null, h("span", null, logText(v, e)), h("small", null, t("world.logDay", { day: e.day })))),
      ),
    ),
  );
}

// ================= battle report =================

function reportModal(v: WorldView, r: WorldBattleReport): HTMLElement {
  const s = v.sectors[r.sector];
  const close = (): void => {
    report = null;
    render();
  };
  return h(
    "div",
    { class: "wmodal", role: "dialog", testid: "world-report", onClick: (e) => { if (e.target === e.currentTarget) close(); } },
    h(
      "div",
      { class: `card wreport ${r.won ? "won" : "lost"}` },
      h("h2", null, r.won ? t("world.report.win") : t("world.report.loss")),
      s ? h("p", { style: "text-align:center" }, h("b", null, sectorLabel(s))) : null,
      r.defenderName ? h("p", { class: "fx", style: "text-align:center" }, t("world.report.vs", { name: r.defenderName })) : null,
      r.captured ? h("p", null, t("world.report.captured")) : null,
      r.bossKilled ? h("p", { class: "wevent" }, t("world.report.bossKilled")) : null,
      r.gold > 0 ? h("p", { class: "gold-line" }, h("span", { class: "coin" }), " ", t("world.report.gold", { gold: fmtNum(r.gold) })) : null,
      h("div", { class: "label" }, t("world.report.yourLosses")),
      r.attackerLost.length ? chips(r.attackerLost) : h("p", { class: "fx" }, t("world.report.none")),
      h("div", { class: "label" }, t("world.report.enemyLosses")),
      r.defenderLost.length ? chips(r.defenderLost) : h("p", { class: "fx" }, t("world.report.none")),
      h("button", { class: "btn block", testid: "world-report-close", onClick: close }, t("common.close")),
    ),
  );
}

/** Drops the cached world (logout). */
export function resetWorldScreen(): void {
  resetMapScroll();
  view = null;
  loadError = "";
  selected = null;
  report = null;
  tab = "map";
}
