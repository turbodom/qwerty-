/**
 * Persistence behind an async interface so that a PostgreSQL implementation can replace MemoryStore.
 * Every method returns copies: callers never hold references into the store.
 */

export interface UserRecord {
  uid: string;
  username: string;
  /** Unix ms, or null when the user never had premium. */
  premiumUntil: number | null;
  /** Active banner id (from a shop item's `grants.banner`). */
  banner: string | null;
  /** Ids of shop items the user owns, in purchase order. */
  owned: string[];
  createdAt: number;
}

export type PaymentStatus = "approved" | "completed" | "cancelled";

export interface PaymentRecord {
  paymentId: string;
  uid: string;
  itemId: string;
  amount: number;
  status: PaymentStatus;
  txid: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentInput {
  paymentId: string;
  uid: string;
  itemId: string;
  amount: number;
}

export interface CompleteResult {
  payment: PaymentRecord;
  user: UserRecord;
  /** False when the payment had already been completed: nothing was granted this time. */
  granted: boolean;
}

/** Thrown when a payment is in a state that forbids the requested transition. */
export class PaymentStateError extends Error {
  override name = "PaymentStateError";
  constructor(readonly status: PaymentStatus, message: string) {
    super(message);
  }
}

export interface Store {
  getUser(uid: string): Promise<UserRecord | null>;
  /** Finds the user by uid or creates one; updates the username when it changed. */
  upsertUser(uid: string, username: string): Promise<UserRecord>;
  getPayment(paymentId: string): Promise<PaymentRecord | null>;
  listPayments(uid: string): Promise<PaymentRecord[]>;
  /**
   * Records a payment as approved (insert, or refresh an approved one).
   * Throws PaymentStateError when it is already completed or cancelled.
   */
  recordApproved(input: PaymentInput): Promise<PaymentRecord>;
  /**
   * Atomically marks the payment completed with `txid` and applies `grant` to its user, exactly once.
   * Completing an already completed payment grants nothing (`granted: false`).
   * Throws PaymentStateError when the payment was cancelled.
   */
  completePayment(input: PaymentInput & { txid: string }, grant: (user: UserRecord) => UserRecord): Promise<CompleteResult>;
  /** Marks the payment cancelled (inserting it when unknown). Throws PaymentStateError when it is completed. */
  cancelPayment(input: PaymentInput): Promise<PaymentRecord>;
}

const clone = <T>(x: T): T => structuredClone(x);

export class MemoryStore implements Store {
  private readonly users = new Map<string, UserRecord>();
  private readonly payments = new Map<string, PaymentRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async getUser(uid: string): Promise<UserRecord | null> {
    const u = this.users.get(uid);
    return u ? clone(u) : null;
  }

  async upsertUser(uid: string, username: string): Promise<UserRecord> {
    let u = this.users.get(uid);
    if (!u) {
      u = { uid, username, premiumUntil: null, banner: null, owned: [], createdAt: this.now() };
      this.users.set(uid, u);
    } else if (u.username !== username) {
      u.username = username;
    }
    return clone(u);
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    const p = this.payments.get(paymentId);
    return p ? clone(p) : null;
  }

  async listPayments(uid: string): Promise<PaymentRecord[]> {
    return [...this.payments.values()].filter((p) => p.uid === uid).map(clone);
  }

  async recordApproved(input: PaymentInput): Promise<PaymentRecord> {
    const t = this.now();
    const existing = this.payments.get(input.paymentId);
    if (existing && existing.status !== "approved") {
      throw new PaymentStateError(existing.status, `payment ${input.paymentId} is already ${existing.status}`);
    }
    const rec: PaymentRecord = {
      ...input, status: "approved", txid: null, createdAt: existing?.createdAt ?? t, updatedAt: t,
    };
    this.payments.set(input.paymentId, rec);
    return clone(rec);
  }

  async completePayment(input: PaymentInput & { txid: string }, grant: (user: UserRecord) => UserRecord): Promise<CompleteResult> {
    // No await between the checks and the writes: this block is atomic on the event loop.
    const t = this.now();
    const existing = this.payments.get(input.paymentId);
    if (existing?.status === "cancelled") {
      throw new PaymentStateError("cancelled", `payment ${input.paymentId} was cancelled`);
    }
    const user = this.users.get(input.uid) ?? {
      uid: input.uid, username: input.uid, premiumUntil: null, banner: null, owned: [], createdAt: t,
    };
    if (existing?.status === "completed") {
      return { payment: clone(existing), user: clone(user), granted: false };
    }
    const payment: PaymentRecord = {
      paymentId: input.paymentId, uid: input.uid, itemId: input.itemId, amount: input.amount,
      status: "completed", txid: input.txid, createdAt: existing?.createdAt ?? t, updatedAt: t,
    };
    const updated = grant(clone(user));
    this.users.set(updated.uid, clone(updated));
    this.payments.set(payment.paymentId, payment);
    return { payment: clone(payment), user: clone(updated), granted: true };
  }

  async cancelPayment(input: PaymentInput): Promise<PaymentRecord> {
    const t = this.now();
    const existing = this.payments.get(input.paymentId);
    if (existing?.status === "completed") {
      throw new PaymentStateError("completed", `payment ${input.paymentId} is already completed`);
    }
    const rec: PaymentRecord = existing
      ? { ...existing, status: "cancelled", updatedAt: t }
      : { ...input, status: "cancelled", txid: null, createdAt: t, updatedAt: t };
    this.payments.set(input.paymentId, rec);
    return clone(rec);
  }
}
