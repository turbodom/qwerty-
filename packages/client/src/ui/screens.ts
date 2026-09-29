/** Full-stage screens: login, lobby and the online waiting room. */
import { ROOM_CODE_MAX } from "@korony/shared";
import type { User } from "../api";
import { t } from "../i18n";
import { STORAGE_KEYS, readItem } from "../storage";
import { artUrl } from "../gfx/artUrls";
import { h } from "./dom";
import { settingsBlock } from "./panels/misc";

export interface ScreenApi {
  user(): User | null;
  piState(): "checking" | "available" | "unavailable";
  savedLocalDay(): number | null;
  hasOnlineResume(): boolean;
  loginPi(): Promise<void>;
  loginGuest(username: string): Promise<void>;
  continueAsGuest(): void;
  logout(): void;
  goLogin(): void;
  playAi(fresh: boolean): void;
  playOnline(code?: string): void;
  resumeOnline(): void;
  openShop(): void;
  cancelOnline(): void;
  rerender(): void;
}

const CODE_RE = new RegExp(`^[A-Za-z0-9]{1,${ROOM_CODE_MAX}}$`);
const NAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u;

function crest(): HTMLElement {
  return h("img", { class: "crest", src: artUrl("logo"), alt: "" });
}

function header(): HTMLElement[] {
  return [crest(), h("h1", null, t("app.title")), h("p", { class: "sub" }, t("app.subtitle"))];
}

let loginBusy = false;
let loginError = "";

export function loginScreen(api: ScreenApi): HTMLElement {
  const inner = h("div", { class: "inner" }, header());
  const card = h("div", { class: "card" }, h("h2", null, t("login.title")));
  const pi = api.piState();
  if (pi === "checking") {
    card.append(h("div", { class: "spinner" }), h("p", { class: "fx" }, t("login.piChecking")));
  } else if (pi === "available") {
    card.append(
      h("p", { class: "fx" }, t("login.piHint")),
      h(
        "button",
        {
          class: "btn block",
          testid: "login-pi",
          disabled: loginBusy,
          onClick: async () => {
            loginBusy = true;
            loginError = "";
            api.rerender();
            try {
              await api.loginPi();
            } catch (e) {
              loginError = t("login.piFailed", { message: e instanceof Error ? e.message : String(e) });
            } finally {
              loginBusy = false;
              api.rerender();
            }
          },
        },
        loginBusy ? t("login.inProgress") : t("login.piButton"),
      ),
    );
  } else {
    const input = h("input", {
      class: "field",
      placeholder: t("login.username"),
      maxLength: 20,
      autocomplete: "nickname",
      testid: "guest-name",
      ariaLabel: t("login.username"),
      value: readItem(STORAGE_KEYS.guestName) ?? "",
    });
    const submit = async (): Promise<void> => {
      const name = input.value.trim();
      if (!NAME_RE.test(name)) {
        loginError = t("login.usernameInvalid");
        api.rerender();
        return;
      }
      loginBusy = true;
      loginError = "";
      api.rerender();
      try {
        await api.loginGuest(name);
      } catch (e) {
        loginError = e instanceof Error ? e.message : String(e);
      } finally {
        loginBusy = false;
        api.rerender();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submit();
    });
    card.append(
      h("p", { class: "fx" }, t("login.guestLoginHint")),
      input,
      h(
        "button",
        { class: "btn block", testid: "login-guest", disabled: loginBusy, onClick: () => void submit() },
        loginBusy ? t("login.inProgress") : t("login.guestButton"),
      ),
    );
  }
  if (loginError) card.append(h("p", { class: "error-text", role: "alert" }, loginError));
  inner.append(card);
  inner.append(
    h(
      "div",
      { class: "card" },
      h("button", { class: "btn ghost block", testid: "no-login", onClick: () => api.continueAsGuest() }, t("login.noLogin")),
      h("p", { class: "fx" }, t("login.noLoginHint")),
    ),
  );
  inner.append(h("div", { class: "card" }, settingsBlock(() => api.rerender())));
  return inner;
}

let codeError = "";

export function lobbyScreen(api: ScreenApi): HTMLElement {
  const user = api.user();
  const inner = h("div", { class: "inner" }, header());

  // account
  const premium = user?.premiumUntil && user.premiumUntil > Date.now();
  inner.append(
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h(
          "div",
          null,
          user
            ? h("b", { testid: "greeting" }, t("lobby.greeting", { name: user.username }))
            : h("span", { class: "muted" }, t("lobby.guest")),
          premium ? h("span", { class: "badge", style: "margin-left:6px" }, t("lobby.premium")) : null,
        ),
        user
          ? h("button", { class: "btn ghost small", onClick: () => api.logout() }, t("lobby.logout"))
          : h("button", { class: "btn ghost small", testid: "lobby-login", onClick: () => api.goLogin() }, t("lobby.login")),
      ),
    ),
  );

  // vs AI
  const saved = api.savedLocalDay();
  inner.append(
    h(
      "div",
      { class: "card" },
      h("button", { class: "btn block", testid: "play-ai", onClick: () => api.playAi(true) }, t("lobby.playAi")),
      saved !== null
        ? h(
            "button",
            { class: "btn ghost block", testid: "continue-ai", onClick: () => api.playAi(false) },
            t("lobby.continueAi", { day: saved }),
          )
        : null,
      h("p", { class: "fx" }, t("lobby.playAiHint")),
    ),
  );

  // online
  const online = h("div", { class: "card" }, h("h2", null, t("lobby.online")));
  if (user) {
    if (api.hasOnlineResume()) {
      online.append(h("button", { class: "btn block", testid: "resume-online", onClick: () => api.resumeOnline() }, t("lobby.reconnect")));
    }
    const code = h("input", {
      class: "field",
      placeholder: t("lobby.codePlaceholder"),
      maxLength: ROOM_CODE_MAX,
      autocomplete: "off",
      testid: "room-code",
      ariaLabel: t("lobby.codePlaceholder"),
    });
    const join = (): void => {
      const v = code.value.trim();
      if (!CODE_RE.test(v)) {
        codeError = t("lobby.codeInvalid");
        api.rerender();
        return;
      }
      codeError = "";
      api.playOnline(v.toUpperCase());
    };
    code.addEventListener("keydown", (e) => {
      if (e.key === "Enter") join();
    });
    online.append(
      h("button", { class: "btn ghost block", testid: "quick-match", onClick: () => api.playOnline() }, t("lobby.quickMatch")),
      h("button", { class: "btn ghost block", testid: "friend-create", onClick: () => api.playOnline(makeRoomCode()) }, t("lobby.friendCreate")),
      h("div", { class: "seg", style: "grid-template-columns: 1fr auto" }, code, h("button", { class: "btn ghost", onClick: join }, t("lobby.friendJoin"))),
    );
    if (codeError) online.append(h("p", { class: "error-text" }, codeError));
  } else {
    online.append(
      h("p", { class: "fx" }, t("lobby.onlineNeedsLogin")),
      h("button", { class: "btn ghost block", onClick: () => api.goLogin() }, t("lobby.login")),
    );
  }
  inner.append(online);

  inner.append(
    h(
      "div",
      { class: "card" },
      h("button", { class: "btn ghost block", testid: "open-shop", onClick: () => api.openShop() }, t("lobby.shop")),
      settingsBlock(() => api.rerender()),
    ),
  );

  const helpKeys = ["help.1", "help.2", "help.3", "help.4", "help.5", "help.6", "help.7", "help.8"] as const;
  inner.append(
    h(
      "div",
      { class: "card" },
      h("details", { class: "help" }, h("summary", null, t("lobby.howTo")), h("ul", null, helpKeys.map((k) => h("li", null, t(k))))),
    ),
  );
  return inner;
}

export function waitingScreen(api: ScreenApi, code: string | undefined, status: "connecting" | "waiting" | "reconnecting"): HTMLElement {
  const inner = h("div", { class: "inner" }, header());
  const card = h("div", { class: "card", testid: "waiting" }, h("div", { class: "spinner" }));
  card.append(
    h(
      "p",
      { style: "text-align:center" },
      status === "connecting" ? t("online.connecting") : status === "reconnecting" ? t("online.reconnecting") : code ? t("online.waiting") : t("online.searching"),
    ),
  );
  if (code) {
    card.append(h("div", { class: "code-box", testid: "room-code-box" }, code), h("p", { class: "fx", style: "text-align:center" }, t("online.codeHint")));
  }
  card.append(h("button", { class: "btn ghost block", onClick: () => api.cancelOnline() }, t("common.cancel")));
  inner.append(card);
  return inner;
}

/** Six characters without look-alikes (0/O, 1/I), from the platform CSPRNG. */
export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => alphabet[n % alphabet.length] ?? "A").join("");
}
