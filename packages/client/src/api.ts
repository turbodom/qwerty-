import { SHOP_ITEMS } from "@korony/shared";
import type { AuthResponse, PlayerLoadout, ShopItem } from "@korony/shared";
import { apiUrl } from "./config";
import { t } from "./i18n";
import { STORAGE_KEYS, readItem, removeItem, writeItem } from "./storage";

export type User = AuthResponse["user"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ================= session token =================

let token: string | null = readItem(STORAGE_KEYS.session);

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null): void {
  token = value;
  if (value) writeItem(STORAGE_KEYS.session, value);
  else removeItem(STORAGE_KEYS.session);
}

// ================= transport =================

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["error", "message"]) {
      const v = o[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return t("error.server", { status });
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(0, t("error.network"));
  }
  let data: unknown = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.status === 401) {
    setToken(null);
    throw new ApiError(401, t("error.unauthorized"));
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status));
  return data as T;
}

function asUser(x: unknown): User | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const u = (o["user"] && typeof o["user"] === "object" ? o["user"] : o) as Record<string, unknown>;
  if (typeof u["uid"] !== "string" || typeof u["username"] !== "string") return null;
  return {
    uid: u["uid"],
    username: u["username"],
    premiumUntil: typeof u["premiumUntil"] === "number" ? u["premiumUntil"] : null,
    banner: typeof u["banner"] === "string" ? u["banner"] : null,
    owned: Array.isArray(u["owned"]) ? u["owned"].filter((s): s is string => typeof s === "string") : [],
  };
}

function asAuth(x: unknown): AuthResponse {
  const o = (x ?? {}) as Record<string, unknown>;
  const user = asUser(o["user"]);
  if (typeof o["token"] !== "string" || !user) throw new ApiError(500, t("error.server", { status: 500 }));
  return { token: o["token"], user };
}

function isShopItem(x: unknown): x is ShopItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o["id"] === "string" && typeof o["name"] === "string" && typeof o["pricePi"] === "number";
}

// ================= loadout =================

/**
 * Start bonuses from purchased items (same rules the server applies): the most expensive owned
 * starting artifact, the summed starting gold and the chosen (or last owned) banner.
 */
export function loadoutFromOwned(owned: readonly string[], chosenBanner: string | null = null): PlayerLoadout {
  const out: PlayerLoadout = {};
  let artifactPrice = -1;
  let gold = 0;
  let banner: string | undefined;
  for (const item of SHOP_ITEMS) {
    if (!owned.includes(item.id)) continue;
    const g = item.grants;
    if (g.startArtifact && item.pricePi > artifactPrice) {
      artifactPrice = item.pricePi;
      out.startArtifact = g.startArtifact;
    }
    if (g.startGold) gold += g.startGold;
    if (g.banner) banner = g.banner;
  }
  if (gold > 0) out.startGold = gold;
  const b = chosenBanner ?? banner;
  if (b) out.banner = b;
  return out;
}

// ================= endpoints =================

export const api = {
  async loginPi(accessToken: string): Promise<AuthResponse> {
    const res = asAuth(await request<unknown>("POST", "/api/auth/pi", { accessToken }));
    setToken(res.token);
    return res;
  },

  /** Guest login by name (normal browser). A 404 means the server allows Pi login only. */
  async loginGuest(username: string): Promise<AuthResponse> {
    let data: unknown;
    try {
      data = await request<unknown>("POST", "/api/auth/guest", { username });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw new ApiError(404, t("login.guestDisabled"));
      throw e;
    }
    const res = asAuth(data);
    setToken(res.token);
    return res;
  },

  logout(): void {
    setToken(null);
  },

  async me(): Promise<User> {
    const u = asUser(await request<unknown>("GET", "/api/me"));
    if (!u) throw new ApiError(500, t("error.server", { status: 500 }));
    return u;
  },

  /** Catalog with server prices (accepts a bare array or `{ items }`). */
  async shop(): Promise<ShopItem[]> {
    const data = await request<unknown>("GET", "/api/shop");
    const list = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
        ? (data as { items: unknown[] }).items
        : [];
    return list.filter(isShopItem);
  },

  /** The player's starting loadout; derived from purchases when the server has no endpoint for it. */
  async loadout(user?: User | null): Promise<PlayerLoadout> {
    try {
      const data = await request<unknown>("GET", "/api/loadout");
      if (data && typeof data === "object") {
        const o = data as Record<string, unknown>;
        const src = (o["loadout"] && typeof o["loadout"] === "object" ? o["loadout"] : o) as Record<string, unknown>;
        const out: PlayerLoadout = {};
        if (typeof src["startArtifact"] === "string") out.startArtifact = src["startArtifact"] as PlayerLoadout["startArtifact"];
        if (typeof src["startGold"] === "number") out.startGold = src["startGold"];
        if (typeof src["banner"] === "string") out.banner = src["banner"];
        return out;
      }
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e;
    }
    const u = user ?? (await api.me());
    return loadoutFromOwned(u.owned, u.banner);
  },

  approvePayment(paymentId: string): Promise<unknown> {
    return request("POST", "/api/payments/approve", { paymentId });
  },

  completePayment(paymentId: string, txid: string): Promise<unknown> {
    return request("POST", "/api/payments/complete", { paymentId, txid });
  },

  incompletePayment(payment: unknown): Promise<unknown> {
    return request("POST", "/api/payments/incomplete", { payment });
  },
};
