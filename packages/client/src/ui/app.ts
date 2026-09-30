import Phaser from "phaser";
import { QUESTS, SHOP_ITEMS, income } from "@korony/shared";
import type { ActiveBattle, GameAction, GameEvent, PlayerView, Seat, ShopItem, SpellId } from "@korony/shared";
import { ApiError, api, getToken, loadoutFromOwned, setToken } from "../api";
import type { User } from "../api";
import { sfx, unlockAudio } from "../audio";
import { IS_DEV } from "../config";
import { artUrl, unitPicUrl } from "../gfx/artUrls";
import { bridge } from "../game/bridge";
import type { BattleBarState, UiHooks } from "../game/bridge";
import { Director } from "../game/director";
import { mePlayer, myBattle, myHero, objectAtView, ownerColor, weekDay } from "../game/helpers";
import { feedbackFromEvents } from "../game/toasts";
import { fmtNum, onLangChange, t } from "../i18n";
import { engineText } from "../i18n/catalog";
import type { ActionResultLike, GameConnection } from "../net/connection";
import { LocalGame } from "../net/local";
import { OnlineGame } from "../net/online";
import { authenticate, disablePi, flushIncompletePayments, inPiEnvironment, initPi } from "../pi";
import { BattleScene } from "../scenes/BattleScene";
import { BootScene } from "../scenes/BootScene";
import { MapScene } from "../scenes/MapScene";
import { STORAGE_KEYS, writeItem } from "../storage";
import { byId, clear, h } from "./dom";
import { castlePanel } from "./panels/castle";
import { armyChips, heroPanel } from "./panels/hero";
import { levelUpPanel } from "./panels/levelup";
import { confirmPanel, menuPanel, resultPanel } from "./panels/misc";
import { questsPanel } from "./panels/quests";
import { shopPanel } from "./panels/shop";
import { spellbookPanel } from "./panels/spellbook";
import type { AppApi, PanelFactory } from "./panels/types";
import { chosenAiMap, lobbyScreen, loginScreen, waitingScreen } from "./screens";
import type { ScreenApi } from "./screens";
import { resetWorldScreen, worldScreen } from "./world";

type Screen = "login" | "lobby" | "waiting" | "game" | "world";

const END_DAY_COOLDOWN_MS = 700;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** The whole client: screens, in-game bars and panels, the Phaser game and the current connection. */
export class App implements AppApi, ScreenApi, UiHooks {
  private readonly top = byId("topbar");
  private readonly hintEl = byId("hint");
  private readonly screenEl = byId("screen");
  private readonly overlay = byId("overlay");
  private readonly toasts = byId("toasts");
  private readonly bar = byId("actionbar");
  private readonly gameParent = byId("game");

  private readonly game: Phaser.Game;
  private readonly director: Director;
  private screen: Screen = "login";
  private conn: GameConnection | null = null;
  private unsubscribe: (() => void) | null = null;
  private currentView: PlayerView | null = null;
  private panel: PanelFactory | null = null;
  private battleBar: BattleBarState | null = null;
  private currentUser: User | null = null;
  private pi: "checking" | "available" | "unavailable" = inPiEnvironment() ? "checking" : "unavailable";
  private shopItems: readonly ShopItem[] = SHOP_ITEMS;
  private shopFromServer = false;
  private shopLoading = false;
  private pendingOnline: OnlineGame | null = null;
  private waitingCode: string | undefined;
  private waitingStatus: "connecting" | "waiting" | "reconnecting" = "connecting";
  private seenLevelChoices = 0;
  private resultShown = false;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  /** Bumped whenever the player starts, cancels or leaves an online attempt; stale async results are dropped. */
  private onlineAttempt = 0;
  /** The spellbook panel currently open (closed when its battle ends). */
  private spellbookFactory: PanelFactory | null = null;
  /** End day is ignored until this time (double taps must not end two days). */
  private endDayLockUntil = 0;

  constructor() {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    bridge.dpr = dpr;
    bridge.ui = this;
    const w = Math.max(1, this.gameParent.clientWidth);
    const hgt = Math.max(1, this.gameParent.clientHeight);
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.gameParent,
      backgroundColor: "#0b0c10",
      banner: false,
      audio: { noAudio: true },
      disableContextMenu: true,
      scale: { mode: Phaser.Scale.NONE, width: Math.round(w * dpr), height: Math.round(hgt * dpr), zoom: 1 / dpr },
      render: { antialias: true, roundPixels: false },
      input: { activePointers: 2 },
      scene: [BootScene, MapScene, BattleScene],
    });
    this.director = new Director(this.game, (view, events) => this.onProcessed(view, events));
    const ro = new ResizeObserver(() => this.resizeGame());
    ro.observe(this.gameParent);
    document.addEventListener("pointerdown", () => unlockAudio(), { once: true, capture: true });
    this.fillAsh();
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && this.panelClosable()) this.closePanel();
    });
    onLangChange(() => this.renderAll());
    if (IS_DEV) this.exposeTestHooks();
  }

  /** Falling ash over the game canvas (a fixed dozen CSS particles, see .game-fx). */
  private fillAsh(): void {
    const fx = document.getElementById("game-fx");
    if (!fx) return;
    for (let i = 0; i < 16; i++) {
      const e = h("i");
      e.style.setProperty("--x", `${(i * 41 + 7) % 110}%`);
      e.style.setProperty("--d", `${9 + ((i * 5) % 9)}s`);
      e.style.setProperty("--delay", `${-((i * 1.7) % 12)}s`);
      e.style.setProperty("--s", `${2 + (i % 3)}px`);
      fx.append(e);
    }
  }

  // ================= startup =================

  async start(): Promise<void> {
    const token = getToken();
    this.renderScreen(token ? "lobby" : "login");
    void initPi().then((ok) => {
      this.pi = ok ? "available" : "unavailable";
      if (this.screen === "login") this.renderScreen("login");
    });
    if (token) {
      try {
        this.currentUser = await api.me();
        flushIncompletePayments();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setToken(null);
        this.currentUser = null;
      }
      if (this.screen === "lobby") this.renderScreen("lobby");
      if (this.currentUser && OnlineGame.savedReconnect()) this.resumeOnline();
    }
  }

  private resizeGame(): void {
    const w = Math.max(1, this.gameParent.clientWidth);
    const hgt = Math.max(1, this.gameParent.clientHeight);
    const dpr = bridge.dpr;
    const W = Math.round(w * dpr);
    const H = Math.round(hgt * dpr);
    if (this.game.scale.width !== W || this.game.scale.height !== H) this.game.scale.resize(W, H);
  }

  // ================= screens =================

  private renderScreen(s: Screen): void {
    this.screen = s;
    clear(this.screenEl);
    if (s === "login") this.screenEl.append(loginScreen(this));
    else if (s === "lobby") this.screenEl.append(lobbyScreen(this));
    else if (s === "waiting") this.screenEl.append(waitingScreen(this, this.waitingCode, this.waitingStatus));
    else if (s === "world") {
      this.screenEl.append(worldScreen({ back: () => this.renderScreen("lobby"), toast: (text, kind) => this.toast(text, kind) }));
    }
    this.screenEl.classList.toggle("wide", s === "world");
    this.hintEl.hidden = s !== "game";
    this.renderTop();
    this.renderBar();
  }

  private renderAll(): void {
    document.title = t("app.title");
    if (this.screen !== "game") this.renderScreen(this.screen);
    else {
      this.renderTop();
      this.renderBar();
    }
    this.renderPanel();
  }

  rerender(): void {
    if (this.screen !== "game") this.renderScreen(this.screen);
    this.renderPanel();
  }

  // ScreenApi
  user(): User | null {
    return this.currentUser;
  }

  piState(): "checking" | "available" | "unavailable" {
    return this.pi;
  }

  savedLocalDay(): number | null {
    return LocalGame.savedDay();
  }

  hasOnlineResume(): boolean {
    return OnlineGame.savedReconnect() !== null;
  }

  async loginPi(): Promise<void> {
    try {
      const auth = await authenticate();
      const res = await api.loginPi(auth.accessToken);
      this.currentUser = res.user;
      flushIncompletePayments();
      this.renderScreen("lobby");
    } catch (e) {
      if (e instanceof Error && /timed out/i.test(e.message)) {
        disablePi();
        this.pi = "unavailable";
      }
      throw e;
    }
  }

  async loginGuest(username: string): Promise<void> {
    const res = await api.loginGuest(username);
    writeItem(STORAGE_KEYS.guestName, username);
    this.currentUser = res.user;
    flushIncompletePayments();
    this.renderScreen("lobby");
  }

  continueAsGuest(): void {
    this.renderScreen("lobby");
  }

  logout(): void {
    api.logout();
    this.currentUser = null;
    resetWorldScreen();
    this.renderScreen("login");
  }

  goLogin(): void {
    this.closePanel();
    if (this.screen === "game") this.leaveGame();
    this.renderScreen("login");
  }

  playAi(fresh: boolean): void {
    if (fresh && LocalGame.savedDay() !== null) {
      this.openPanel(confirmPanel(t("lobby.newGameConfirm"), () => void this.startLocal(true)));
      return;
    }
    void this.startLocal(fresh);
  }

  playOnline(code?: string): void {
    void this.startOnline(code);
  }

  resumeOnline(): void {
    const attempt = ++this.onlineAttempt;
    void (async () => {
      this.waitingCode = OnlineGame.savedReconnect()?.code;
      this.waitingStatus = "reconnecting";
      this.renderScreen("waiting");
      const game = await OnlineGame.resume().catch(() => null);
      if (attempt !== this.onlineAttempt || this.screen !== "waiting") {
        // cancelled meanwhile: step away again without giving the match up
        game?.suspend();
        return;
      }
      if (!game) {
        this.toast(t("online.connectionLost"), "error");
        this.renderScreen("lobby");
        return;
      }
      this.watchOnline(game);
    })();
  }

  openShop(): void {
    this.openPanel(shopPanel);
  }

  openWorld(): void {
    if (!getToken() || !this.currentUser) {
      this.toast(t("world.needsLogin"), "error");
      this.renderScreen("login");
      return;
    }
    this.closePanel();
    this.renderScreen("world");
  }

  cancelOnline(): void {
    this.onlineAttempt++;
    this.pendingOnline?.leave();
    this.pendingOnline = null;
    this.renderScreen("lobby");
  }

  // ================= starting / leaving games =================

  private async startLocal(fresh: boolean): Promise<void> {
    this.closePanel();
    let game = fresh ? null : LocalGame.load();
    if (!game) {
      const user = this.currentUser;
      let loadout = user ? loadoutFromOwned(user.owned, user.banner) : undefined;
      if (user && getToken()) loadout = await withTimeout(api.loadout(user), 1500).catch(() => loadout);
      const mapId = chosenAiMap();
      game = LocalGame.create(user ? { name: user.username, mapId, ...(loadout ? { loadout } : {}) } : { mapId });
    }
    this.attach(game);
  }

  private async startOnline(code?: string): Promise<void> {
    const token = getToken();
    if (!token || !this.currentUser) {
      this.toast(t("lobby.onlineNeedsLogin"), "error");
      this.renderScreen("login");
      return;
    }
    const attempt = ++this.onlineAttempt;
    this.waitingCode = code;
    this.waitingStatus = "connecting";
    this.renderScreen("waiting");
    try {
      const game = await OnlineGame.join(code ? { token, code } : { token });
      if (attempt !== this.onlineAttempt || this.screen !== "waiting") {
        game.leave();
        return;
      }
      this.watchOnline(game);
    } catch (e) {
      if (attempt !== this.onlineAttempt) return;
      this.toast(t("online.joinFailed", { message: e instanceof Error ? e.message : String(e) }), "error");
      this.renderScreen("lobby");
    }
  }

  private watchOnline(game: OnlineGame): void {
    this.pendingOnline = game;
    game.onError((msg) => {
      if (this.conn === game || this.pendingOnline === game) this.toast(engineText(msg), "error");
    });
    game.onStatus((s) => {
      // only a game that is still wanted (waiting for it, or on screen) may take the screen
      if (this.conn !== game && this.pendingOnline !== game) return;
      if (s === "playing" && this.conn !== game) {
        this.pendingOnline = null;
        this.attach(game);
      } else if (s === "closed" && this.conn === game && this.currentView?.state.winner === null) {
        this.toast(t("online.connectionLost"), "error");
      } else if (s === "reconnecting") {
        this.toast(t("online.reconnecting"));
      }
      this.renderTop();
    });
    if (game.view) {
      this.pendingOnline = null;
      this.attach(game);
    } else {
      this.waitingStatus = "waiting";
      this.renderScreen("waiting");
    }
  }

  private attach(conn: GameConnection): void {
    this.leaveGame();
    this.conn = conn;
    bridge.conn = conn;
    this.currentView = null;
    this.seenLevelChoices = 0;
    this.resultShown = false;
    this.battleBar = null;
    this.renderScreen("game");
    this.hint(t("hint.map"));
    this.unsubscribe = conn.subscribe((view, events) => {
      if (!this.currentView) this.currentView = view;
      this.director.push(view, events);
    });
    this.timerHandle = setInterval(() => this.updateTimer(), 1000);
  }

  /** Detaches the current game; `suspend` steps out of an online match keeping the seat instead of forfeiting. */
  private leaveGame(how: "leave" | "suspend" = "leave"): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = null;
    const conn = this.conn;
    // cleared first, so the connection's own "closed" status is not reported as a lost connection
    this.conn = null;
    bridge.conn = null;
    this.onlineAttempt++;
    if (conn) {
      if (how === "suspend" && conn instanceof OnlineGame) conn.suspend();
      else conn.leave();
    }
    this.currentView = null;
    this.battleBar = null;
    this.director.reset();
  }

  // AppApi
  view(): PlayerView | null {
    return this.currentView;
  }

  /** Panel actions: a second tap while the first action is still on its way is ignored. */
  act(action: GameAction): Promise<ActionResultLike> {
    if (bridge.inFlight > 0) return Promise.resolve({ ok: false, events: [] });
    return bridge.act(action);
  }

  isLocal(): boolean {
    return this.conn?.kind === "local";
  }

  toLobby(): void {
    const view = this.currentView;
    const me = view ? mePlayer(view) : undefined;
    // an online match still running is only stepped out of: the seat stays reserved and the lobby offers the way back
    const stepAway = this.conn?.kind === "online" && !!view && view.state.winner === null && !!me && !me.defeated;
    this.closePanel();
    this.leaveGame(stepAway ? "suspend" : "leave");
    this.renderScreen("lobby");
    if (stepAway) this.toast(t("menu.stepAway"));
  }

  surrender(): void {
    this.openPanel(
      confirmPanel(t("menu.surrenderConfirm"), () => {
        if (this.conn?.kind !== "online") return;
        this.leaveGame("leave");
        this.renderScreen("lobby");
        this.toast(t("menu.surrendered"));
      }),
    );
  }

  newLocalGame(): void {
    this.closePanel();
    this.leaveGame();
    void this.startLocal(true);
  }

  shopCatalog(): { items: readonly ShopItem[]; fromServer: boolean } {
    return { items: this.shopItems, fromServer: this.shopFromServer };
  }

  loadShop(): void {
    if (this.shopFromServer || this.shopLoading) return;
    this.shopLoading = true;
    api
      .shop()
      .then((items) => {
        if (items.length > 0) {
          this.shopItems = items;
          this.shopFromServer = true;
          this.rerender();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.shopLoading = false;
      });
  }

  async refreshUser(): Promise<void> {
    if (!getToken()) return;
    this.currentUser = await api.me();
  }

  // ================= processed updates =================

  private onProcessed(view: PlayerView, events: GameEvent[]): void {
    this.currentView = view;
    const fb = feedbackFromEvents(events, view.you, view.state);
    for (const s of fb.sounds) sfx(s);
    fb.toasts.forEach((text, i) => this.toast(text, fb.rewards[i] ? "reward" : "info"));
    const me = mePlayer(view);
    const inBattle = !!myBattle(view);

    if (!inBattle && me) {
      const nd = [...events].reverse().find((e): e is Extract<GameEvent, { type: "newDay" }> => e.type === "newDay");
      if (nd) {
        const wd = weekDay(nd.day);
        this.hint(t("hint.newDay", { week: wd.week, day: wd.day, gold: fmtNum(income(view.state, view.you)) }));
      } else if (me.endedDay && this.conn?.kind === "online") {
        this.hint(t("hint.dayEnded"));
      }
    }

    this.renderTop();
    this.renderBar();

    if (view.state.winner !== null && !this.resultShown) {
      this.resultShown = true;
      const won = view.state.winner === view.you;
      sfx(won ? "win" : "lose");
      if (this.conn?.kind === "local") LocalGame.clearSave();
      this.openPanel(resultPanel(won));
      return;
    }

    const choices = me?.levelChoices.length ?? 0;
    if (choices > this.seenLevelChoices && !inBattle && (!this.panel || this.panel === heroPanel)) {
      this.openPanel(levelUpPanel);
    }
    this.seenLevelChoices = choices;

    // arriving at the own castle opens it, as in the prototype
    const hero = myHero(view);
    const mv = events.find((e): e is Extract<GameEvent, { type: "moved" }> => e.type === "moved" && e.heroId === hero?.id);
    if (!this.panel && hero && mv && !inBattle) {
      const last = mv.path[mv.path.length - 1];
      const o = last ? objectAtView(view.state, last.x, last.y) : undefined;
      if (o && o.kind === "castle" && o.owner === view.you && hero.x === last?.x && hero.y === last?.y) this.openPanel(castlePanel);
    }
    if (this.panel) this.renderPanel();
  }

  // ================= top bar / action bar =================

  private renderTop(): void {
    clear(this.top);
    const view = this.currentView;
    const me = view ? mePlayer(view) : undefined;
    if (this.screen !== "game" || !view || !me) {
      this.top.append(h("div", { class: "brand" }, t("app.title")));
      if (this.screen === "game") {
        this.top.append(h("button", { class: "icon-btn", ariaLabel: t("top.menu"), onClick: () => this.openPanel(menuPanel) }, "☰"));
      }
      return;
    }
    const wd = weekDay(view.state.day);
    const showTimer = this.timerRunning();
    this.top.classList.toggle("with-timer", showTimer);
    this.top.append(
      h(
        "div",
        { class: "res", testid: "gold" },
        h("span", { class: "coin" }),
        fmtNum(me.gold),
        h("small", null, t("top.income", { amount: fmtNum(income(view.state, view.you)) })),
      ),
      h("span", { class: "day", testid: "day" }, t("top.day", { week: wd.week, day: wd.day })),
    );
    if (showTimer) this.top.append(h("span", { class: "timer", id: "timer", title: t("top.timerLabel") }, this.timerText()));
    this.top.append(
      h("button", { class: "icon-btn", ariaLabel: t("top.menu"), testid: "menu", onClick: () => this.openPanel(menuPanel) }, "☰"),
    );
  }

  /** The online day timer is shown only while the match is on (the server stops it when the game ends). */
  private timerRunning(): boolean {
    const view = this.currentView;
    const me = view ? mePlayer(view) : undefined;
    return !!this.conn?.timerEndsAt && !!view && view.state.winner === null && !!me && !me.defeated;
  }

  private timerText(): string {
    const end = this.conn?.timerEndsAt;
    if (!end) return "";
    const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  private updateTimer(): void {
    const el = document.getElementById("timer");
    const end = this.conn?.timerEndsAt;
    if (!end || !this.timerRunning()) {
      if (el) this.renderTop();
      return;
    }
    if (!el) {
      this.renderTop();
      return;
    }
    el.textContent = this.timerText();
    el.classList.toggle("low", end - Date.now() < 15000);
  }

  private renderBar(): void {
    clear(this.bar);
    const view = this.currentView;
    if (this.screen !== "game" || !view) {
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    const bb = this.battleBar;
    if (bb) {
      const battle = (): BattleScene | null => this.director.battleScene;
      this.bar.append(
        h(
          "div",
          { class: "turn-queue", testid: "turn-queue" },
          ...bb.queue.map((q, i) =>
            h(
              "div",
              { class: `tq ${q.mine ? "mine" : "foe"}${i === 0 ? " now" : ""}` },
              h("img", { src: unitPicUrl(q.unit), alt: "" }),
              h("span", null, fmtNum(q.count)),
            ),
          ),
        ),
        h(
          "div",
          { class: "actions battle" },
          h(
            "button",
            { class: "btn ghost", testid: "bar-defend", disabled: !bb.myTurn, onClick: () => { this.closeSpellbook(); battle()?.defend(); } },
            t("bar.defend"),
          ),
          h(
            "button",
            { class: `btn ghost${bb.spellMode ? " on" : ""}`, testid: "bar-magic", disabled: !bb.myTurn || !bb.canCast, onClick: () => battle()?.magic() },
            t("bar.magic"),
          ),
          h("button", { class: "btn ghost", testid: "bar-auto", onClick: () => { this.closeSpellbook(); battle()?.auto(); } }, t("bar.auto")),
          h("span", { class: "round", testid: "round" }, t("bar.round", { n: bb.round })),
        ),
      );
      return;
    }
    const me = mePlayer(view);
    const hero = myHero(view);
    if (!me) return;
    const color = ownerColor(view.state, view.you);
    if (hero) {
      this.bar.append(
        h(
          "div",
          { class: "info" },
          h("img", {
            class: `portrait ${color === "red" ? "red" : "blue"}`,
            src: artUrl(color === "red" ? "portrait-enemy" : "portrait-player"),
            alt: "",
          }),
          h(
            "div",
            { style: "white-space:nowrap" },
            h("b", null, hero.name),
            ` · ${t("bar.level", { n: hero.level })} · `,
            h("b", { testid: "mp" }, t("bar.steps", { n: hero.mp })),
          ),
          h("div", { class: "army" }, armyChips(view.state, view.you, hero.army, true)),
        ),
      );
    }
    const questsDone = QUESTS.filter((q) => me.quests[q.id]).length;
    const over = view.state.winner !== null || me.defeated;
    const inBattle = !!myBattle(view);
    this.bar.append(
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { class: "btn ghost", testid: "bar-hero", onClick: () => this.openPanel(heroPanel) },
          t("bar.hero"),
          hero && hero.bag.length > 0 ? h("span", { class: "count" }, `+${hero.bag.length}`) : null,
        ),
        h("button", { class: "btn ghost", testid: "bar-castle", onClick: () => this.openPanel(castlePanel) }, t("bar.castle")),
        h(
          "button",
          { class: "btn ghost", testid: "bar-quests", onClick: () => this.openPanel(questsPanel) },
          t("bar.quests"),
          h("span", { class: "count" }, `${questsDone}/${QUESTS.length}`),
        ),
        h(
          "button",
          {
            class: "btn",
            testid: "bar-endday",
            disabled: over || inBattle || me.endedDay,
            onClick: () => void this.endDay(),
          },
          me.endedDay ? t("bar.waiting") : t("bar.endDay"),
        ),
      ),
    );
  }

  private async endDay(): Promise<void> {
    if (bridge.inFlight > 0 || Date.now() < this.endDayLockUntil) return;
    this.endDayLockUntil = Infinity;
    try {
      this.closePanel();
      if (this.conn?.kind === "local") this.hint(t("hint.aiTurn"));
      const res = await bridge.act({ type: "endDay" });
      if (res.ok && this.conn?.kind === "online") this.hint(t("hint.dayEnded"));
    } finally {
      // the second tap of a double tap lands on the next day's button: ignore it
      this.endDayLockUntil = Date.now() + END_DAY_COOLDOWN_MS;
    }
  }

  // ================= panels =================

  openPanel(factory: PanelFactory): void {
    this.panel = factory;
    if (factory !== this.spellbookFactory) this.spellbookFactory = null;
    this.renderPanel(true);
  }

  closePanel(): void {
    this.panel = null;
    this.spellbookFactory = null;
    this.renderPanel();
  }

  private closeSpellbook(): void {
    if (this.panel && this.panel === this.spellbookFactory) this.closePanel();
  }

  private panelClosable(): boolean {
    if (!this.panel) return true;
    try {
      return this.panel(this).closable !== false;
    } catch {
      return true;
    }
  }

  private renderPanel(fresh = false): void {
    const factory = this.panel;
    const oldBody = this.overlay.querySelector(".panel-body");
    const scroll = !fresh && oldBody ? oldBody.scrollTop : 0;
    clear(this.overlay);
    // toasts go to the bottom while a panel is open, so they never cover its title and close button
    this.toasts.classList.toggle("low", !!factory);
    if (!factory) {
      this.overlay.hidden = true;
      return;
    }
    const spec = factory(this);
    this.overlay.hidden = false;
    this.overlay.className = `overlay${spec.center ? " center" : ""}`;
    const body = h("div", { class: "panel-body" }, spec.body);
    const panel = h(
      "section",
      { class: `panel${spec.center ? " center" : ""}${spec.className ? ` ${spec.className}` : ""}`, role: "dialog", testid: `panel-${spec.id}` },
      h(
        "div",
        { class: "panel-head" },
        h("h2", null, spec.title),
        spec.closable === false
          ? null
          : h("button", { class: "icon-btn", ariaLabel: t("common.close"), testid: "panel-close", onClick: () => this.closePanel() }, "✕"),
      ),
      body,
    );
    this.overlay.append(panel);
    if (scroll) body.scrollTop = scroll;
  }

  // ================= UiHooks (for scenes) =================

  hint(text: string): void {
    this.hintEl.textContent = text;
  }

  toast(text: string, kind: "info" | "error" | "reward" = "info"): void {
    if (kind === "error") sfx("error");
    const el = h(
      "div",
      { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" },
      h("span", { class: "toast-ico" }, kind === "error" ? "!" : kind === "reward" ? "★" : "i"),
      h("span", null, engineText(text)),
    );
    this.toasts.append(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add("hide"), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  openHero(): void {
    this.openPanel(heroPanel);
  }

  openCastle(): void {
    this.openPanel(castlePanel);
  }

  openSpellbook(ab: ActiveBattle, side: Seat, onPick: (spell: SpellId) => void): void {
    const factory = spellbookPanel(ab, side, onPick);
    this.spellbookFactory = factory;
    this.openPanel(factory);
  }

  setBattleBar(state: BattleBarState | null): void {
    // a battle bar only exists while a battle scene runs; a late update from a finished battle is ignored
    if (state && !this.director.battleScene && !this.director.startingBattle) return;
    if (!state) this.closeSpellbook();
    this.battleBar = state;
    this.renderBar();
  }

  // ================= dev / test hooks =================

  private exposeTestHooks(): void {
    const hooks = {
      /** Client (CSS px) coordinates of a map tile centre. */
      tileClient: (x: number, y: number): { x: number; y: number } | null => {
        const map = this.director.mapScene();
        const canvas = this.gameParent.querySelector("canvas");
        if (!map || !canvas) return null;
        const p = map.tileToCanvas(x, y);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + p.x / bridge.dpr, y: r.top + p.y / bridge.dpr };
      },
      view: (): PlayerView | null => this.currentView,
      inBattle: (): boolean => this.director.inBattle,
      screen: (): Screen => this.screen,
    };
    (window as unknown as { __korony?: typeof hooks }).__korony = hooks;
  }
}
