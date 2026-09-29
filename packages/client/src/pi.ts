/**
 * Typed wrapper over the Pi SDK (`window.Pi`, loaded by index.html from sdk.minepi.com).
 * Pi login and payments are used only inside Pi Browser (or the Developer Portal sandbox). In a normal browser
 * the SDK is never initialised, `isPiBrowser()` is false and the login screen offers the guest login instead.
 */
import { api, getToken } from "./api";
import { PI_SANDBOX } from "./config";

export interface PiUser {
  uid: string;
  username?: string;
}

export interface PiAuthResult {
  accessToken: string;
  user: PiUser;
}

/** Payment DTO as the SDK passes it to callbacks (only the fields the client reads are typed). */
export interface PiPayment {
  identifier: string;
  user_uid?: string;
  amount?: number;
  memo?: string;
  metadata?: unknown;
  transaction?: { txid: string; verified?: boolean } | null;
  [key: string]: unknown;
}

export interface PiPaymentData {
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
}

export interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment?: PiPayment) => void;
}

export interface PiSdk {
  init(config: { version: string; sandbox?: boolean }): unknown;
  authenticate(scopes: string[], onIncompletePaymentFound: (payment: PiPayment) => void): Promise<PiAuthResult>;
  createPayment(data: PiPaymentData, callbacks: PiPaymentCallbacks): unknown;
}

declare global {
  interface Window {
    Pi?: PiSdk;
    /** Set by the onload/onerror attributes of the SDK script tag in index.html. */
    __piSdkState?: "loaded" | "failed";
  }
}

const SDK_WAIT_MS = 4000;
const AUTH_TIMEOUT_MS = 45000;

let sdk: PiSdk | null = null;
let initPromise: Promise<boolean> | null = null;
let usable = false;
let authenticated = false;
const pendingIncomplete: PiPayment[] = [];

function waitForSdk(timeoutMs: number): Promise<PiSdk | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const start = Date.now();
    const tick = (): void => {
      if (window.Pi) {
        resolve(window.Pi);
        return;
      }
      if (window.__piSdkState || Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * True where Pi login can work: Pi Browser, whose user agent carries `PiBrowser/<version>`, or the
 * Developer Portal sandbox, which shows the app in a frame (only with VITE_PI_SANDBOX=true).
 * A normal browser also loads the SDK script, but `Pi.authenticate` never answers there.
 */
export function inPiEnvironment(userAgent?: string, framed?: boolean): boolean {
  const ua = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (/\bPiBrowser\//i.test(ua)) return true;
  return PI_SANDBOX && (framed ?? (typeof window !== "undefined" && isFramed()));
}

/**
 * Outside the Pi environment resolves to false at once; otherwise waits for the SDK script and calls
 * `Pi.init`. Resolves to `isPiBrowser()`. Safe to call many times.
 */
export function initPi(): Promise<boolean> {
  initPromise ??= (async () => {
    if (!inPiEnvironment()) return false;
    const pi = await waitForSdk(SDK_WAIT_MS);
    if (!pi) return false;
    try {
      await Promise.resolve(pi.init({ version: "2.0", sandbox: PI_SANDBOX }));
      sdk = pi;
      usable = true;
    } catch {
      usable = false;
    }
    return usable;
  })();
  return initPromise;
}

/** Pi SDK present and initialised (the app is running where Pi login and payments work). */
export function isPiBrowser(): boolean {
  return usable && sdk !== null;
}

/** Marks Pi as unusable in this page (e.g. authentication never answered outside Pi Browser). */
export function disablePi(): void {
  usable = false;
}

function onIncompletePaymentFound(payment: PiPayment): void {
  if (getToken()) {
    api.incompletePayment(payment).catch(() => undefined);
  } else {
    pendingIncomplete.push(payment);
  }
}

/** Sends incomplete payments reported before we had a session (call after login). */
export function flushIncompletePayments(): void {
  while (pendingIncomplete.length > 0) {
    const p = pendingIncomplete.shift();
    if (p) api.incompletePayment(p).catch(() => undefined);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
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

/** `Pi.authenticate(["username","payments"])`; incomplete payments go to the server. */
export async function authenticate(): Promise<PiAuthResult> {
  if (!(await initPi()) || !sdk) throw new Error("Pi SDK is not available");
  const res = await withTimeout(
    sdk.authenticate(["username", "payments"], onIncompletePaymentFound),
    AUTH_TIMEOUT_MS,
    "Pi authentication timed out",
  );
  authenticated = true;
  return res;
}

export type PurchaseResult =
  | { status: "completed"; paymentId: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Buys a shop item with Pi (U2A). The amount comes from the server catalog (`/api/shop`); the server
 * checks it again on approval. Approval and completion are done by the server endpoints.
 */
export async function purchase(itemId: string): Promise<PurchaseResult> {
  if (!isPiBrowser() || !sdk) return { status: "error", message: "Pi Browser required" };
  try {
    if (!authenticated) await authenticate();
    const catalog = await api.shop();
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return { status: "error", message: `unknown item ${itemId}` };
    const pi = sdk;
    return await new Promise<PurchaseResult>((resolve) => {
      let done = false;
      const finish = (r: PurchaseResult): void => {
        if (!done) {
          done = true;
          resolve(r);
        }
      };
      try {
        pi.createPayment(
          { amount: item.pricePi, memo: item.name, metadata: { itemId: item.id } },
          {
            onReadyForServerApproval: (paymentId) => {
              api.approvePayment(paymentId).catch((e: unknown) => {
                finish({ status: "error", message: e instanceof Error ? e.message : String(e) });
              });
            },
            onReadyForServerCompletion: (paymentId, txid) => {
              api.completePayment(paymentId, txid).then(
                () => finish({ status: "completed", paymentId }),
                (e: unknown) => finish({ status: "error", message: e instanceof Error ? e.message : String(e) }),
              );
            },
            onCancel: () => finish({ status: "cancelled" }),
            onError: (error) => finish({ status: "error", message: error?.message || "Pi payment error" }),
          },
        );
      } catch (e) {
        finish({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
