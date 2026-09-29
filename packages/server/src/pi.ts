import { z } from "zod";

/** Pi Platform API client (https://github.com/pi-apps/pi-platform-docs/blob/master/platform_API.md). */

export interface PiUser {
  uid: string;
  username: string;
}

export interface PiPaymentStatus {
  developer_approved: boolean;
  transaction_verified: boolean;
  developer_completed: boolean;
  cancelled: boolean;
  user_cancelled: boolean;
}

export interface PiTransaction {
  txid: string;
  verified: boolean;
  _link?: string;
}

/** PaymentDTO as returned by the Pi Platform API. */
export interface PiPayment {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  status: PiPaymentStatus;
  transaction: PiTransaction | null;
  from_address?: string;
  to_address?: string;
  direction?: string;
  created_at?: string;
  network?: string;
}

export type PiErrorKind = "unauthorized" | "not_found" | "http" | "timeout" | "network" | "bad_response" | "not_configured";

export class PiApiError extends Error {
  override name = "PiApiError";
  constructor(
    readonly kind: PiErrorKind,
    message: string,
    /** HTTP status of the Pi response, when there was one. */
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const userSchema = z.object({
  uid: z.string().min(1),
  username: z.string().optional(),
});

const paymentSchema = z.object({
  identifier: z.string().min(1),
  user_uid: z.string(),
  amount: z.number(),
  memo: z.string().catch(""),
  metadata: z.unknown().transform((m): Record<string, unknown> =>
    typeof m === "object" && m !== null && !Array.isArray(m) ? (m as Record<string, unknown>) : {}),
  status: z.object({
    developer_approved: z.boolean(),
    transaction_verified: z.boolean(),
    developer_completed: z.boolean(),
    cancelled: z.boolean(),
    user_cancelled: z.boolean(),
  }),
  transaction: z
    .object({ txid: z.string(), verified: z.boolean(), _link: z.string().optional() })
    .nullable()
    .optional()
    .transform((t) => t ?? null),
  from_address: z.string().optional(),
  to_address: z.string().optional(),
  direction: z.string().optional(),
  created_at: z.string().optional(),
  network: z.string().optional(),
});

export interface PiClientOptions {
  apiBase: string;
  /** Server API key; payment calls fail with `not_configured` without it. */
  apiKey: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The subset of the Pi API the server uses (lets tests pass a fake). */
export interface PiApi {
  readonly paymentsEnabled: boolean;
  me(accessToken: string): Promise<PiUser>;
  getPayment(paymentId: string): Promise<PiPayment>;
  approvePayment(paymentId: string): Promise<PiPayment>;
  completePayment(paymentId: string, txid: string): Promise<PiPayment>;
  cancelPayment(paymentId: string): Promise<PiPayment>;
}

export class PiClient implements PiApi {
  private readonly base: string;
  private readonly apiKey: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: PiClientOptions) {
    this.base = opts.apiBase.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  get paymentsEnabled(): boolean {
    return this.apiKey !== null;
  }

  /** GET /v2/me with the user's access token: who the token belongs to. */
  async me(accessToken: string): Promise<PiUser> {
    const body = await this.request("GET", "/v2/me", `Bearer ${accessToken}`);
    const parsed = userSchema.safeParse(body);
    if (!parsed.success) throw new PiApiError("bad_response", "Pi /v2/me returned an unexpected body");
    const { uid, username } = parsed.data;
    return { uid, username: username && username.length > 0 ? username : `pi-${uid.slice(0, 8)}` };
  }

  getPayment(paymentId: string): Promise<PiPayment> {
    return this.payment("GET", paymentId, "");
  }

  approvePayment(paymentId: string): Promise<PiPayment> {
    return this.payment("POST", paymentId, "/approve");
  }

  completePayment(paymentId: string, txid: string): Promise<PiPayment> {
    return this.payment("POST", paymentId, "/complete", { txid });
  }

  cancelPayment(paymentId: string): Promise<PiPayment> {
    return this.payment("POST", paymentId, "/cancel");
  }

  private async payment(method: "GET" | "POST", paymentId: string, suffix: string, body?: unknown): Promise<PiPayment> {
    if (this.apiKey === null) throw new PiApiError("not_configured", "PI_API_KEY is not configured");
    const path = `/v2/payments/${encodeURIComponent(paymentId)}${suffix}`;
    const json = await this.request(method, path, `Key ${this.apiKey}`, body);
    const parsed = paymentSchema.safeParse(json);
    if (!parsed.success) throw new PiApiError("bad_response", `Pi ${method} ${path} returned an unexpected payment body`);
    return parsed.data;
  }

  private async request(method: "GET" | "POST", path: string, authorization: string, body?: unknown): Promise<unknown> {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = { Authorization: authorization, Accept: "application/json" };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new PiApiError("timeout", `Pi ${method} ${path} timed out after ${this.timeoutMs} ms`);
      }
      throw new PiApiError("network", `Pi ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    let text = "";
    try {
      text = await res.text();
    } catch (err) {
      throw new PiApiError("network", `Pi ${method} ${path}: could not read the response: ${String(err)}`, res.status);
    }
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const detail = describePiError(json) ?? text.slice(0, 200);
      const kind: PiErrorKind = res.status === 401 ? "unauthorized" : res.status === 404 ? "not_found" : "http";
      throw new PiApiError(kind, `Pi ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    }
    if (json === null) throw new PiApiError("bad_response", `Pi ${method} ${path} returned a non-JSON body`, res.status);
    return json;
  }
}

function describePiError(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const parts = [o["error"], o["error_message"], o["message"]].filter((x): x is string => typeof x === "string");
  return parts.length > 0 ? parts.join(": ") : null;
}
