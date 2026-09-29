import { shopItem } from "@korony/shared";
import type { ShopItem } from "@korony/shared";
import type { Session } from "./auth";
import { HttpError } from "./errors";
import { PiApiError } from "./pi";
import type { PiApi, PiPayment } from "./pi";
import { alreadyOwned, applyGrant, publicUser, restoreGrant, sameAmount } from "./shop";
import type { PublicUser } from "./shop";
import { PaymentStateError } from "./store";
import type { PaymentRecord, PaymentStatus, Store, UserRecord } from "./store";

/** Response of the payment endpoints. */
export interface PaymentOutcome {
  ok: true;
  paymentId: string;
  status: PaymentStatus;
  /** Present after completion (and cancellation): the user with the purchase applied. */
  user?: PublicUser;
  /** False when the purchase had already been granted earlier (idempotent repeat). */
  granted?: boolean;
}

export interface PaymentServiceDeps {
  store: Store;
  pi: PiApi;
  now: () => number;
}

const E = {
  foreign: () => new HttpError(403, "foreign_payment", "Это платёж другого игрока"),
  cancelled: () => new HttpError(409, "payment_cancelled", "Платёж отменён"),
  completed: () => new HttpError(409, "payment_completed", "Платёж уже завершён"),
  owned: () => new HttpError(409, "already_owned", "Этот товар уже куплен"),
  unknownItem: () => new HttpError(400, "unknown_item", "Такого товара нет в лавке"),
  itemMismatch: () => new HttpError(400, "item_mismatch", "Товар в платеже не совпадает с одобренным"),
  amount: () => new HttpError(400, "amount_mismatch", "Сумма платежа не совпадает с ценой товара"),
  txid: () => new HttpError(400, "txid_mismatch", "Номер транзакции не совпадает с платежом"),
  notVerified: () => new HttpError(409, "tx_not_verified", "Транзакция ещё не подтверждена, попробуйте чуть позже"),
};

function fromPiError(err: unknown): HttpError {
  if (err instanceof PiApiError) {
    switch (err.kind) {
      case "not_found":
        return new HttpError(404, "payment_not_found", "Платёж не найден");
      case "not_configured":
        return new HttpError(503, "payments_disabled", "Платежи сейчас недоступны");
      default:
        return new HttpError(502, "pi_unavailable", "Сервер Pi не ответил, попробуйте позже");
    }
  }
  if (err instanceof HttpError) return err;
  throw err;
}

function fromStateError(err: unknown): never {
  if (err instanceof PaymentStateError) throw err.status === "cancelled" ? E.cancelled() : E.completed();
  throw err;
}

/**
 * Server side of Pi U2A payments. Amounts and items come only from SHOP_ITEMS; the client's view of a
 * payment is never trusted (every decision re-reads the payment from the Pi API). Calls for the same
 * payment are serialized, and granting goes through Store.completePayment, which grants at most once.
 */
export class PaymentService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: PaymentServiceDeps) {}

  /** onReadyForServerApproval: validate the payment against the catalog and the session, then approve it. */
  approve(session: Session, paymentId: string): Promise<PaymentOutcome> {
    return this.serialized(paymentId, async () => {
      const { store, pi } = this.deps;
      this.checkLocal(await store.getPayment(paymentId), session, true);
      const p = await this.fetch(paymentId);
      if (p.user_uid !== session.uid) throw E.foreign();
      const item = resolveItem(p, null);
      if (p.status.cancelled || p.status.user_cancelled) throw E.cancelled();
      if (p.status.developer_completed) throw E.completed();
      if (!p.status.developer_approved && alreadyOwned(await store.getUser(session.uid), item)) throw E.owned();
      await store
        .recordApproved({ paymentId, uid: session.uid, itemId: item.id, amount: item.pricePi })
        .catch(fromStateError);
      if (!p.status.developer_approved) await this.callPi(() => pi.approvePayment(paymentId));
      return { ok: true, paymentId, status: "approved" };
    });
  }

  /** onReadyForServerCompletion: check the transaction, complete the payment with Pi and grant the item once. */
  complete(session: Session, paymentId: string, txid: string): Promise<PaymentOutcome> {
    return this.serialized(paymentId, async () => {
      const { store } = this.deps;
      const local = await store.getPayment(paymentId);
      this.checkLocal(local, session, false);
      if (local?.status === "completed") {
        if (local.txid !== txid) throw E.txid();
        return this.alreadyDone(session, paymentId);
      }
      const p = await this.fetch(paymentId);
      if (p.user_uid !== session.uid) throw E.foreign();
      const item = resolveItem(p, local);
      if (p.status.cancelled || p.status.user_cancelled) throw E.cancelled();
      if (!p.transaction || p.transaction.txid !== txid) throw E.txid();
      if (!p.status.transaction_verified) throw E.notVerified();
      return this.finish(session, p, local, item, txid);
    });
  }

  /**
   * onIncompletePaymentFound: a payment with a verified transaction is completed (and granted once);
   * anything else is cancelled on the Pi side so the player can buy again.
   */
  incomplete(session: Session, paymentId: string): Promise<PaymentOutcome> {
    return this.serialized(paymentId, async () => {
      const { store, pi } = this.deps;
      const local = await store.getPayment(paymentId);
      if (local && local.uid !== session.uid) throw E.foreign();
      if (local?.status === "completed") return this.alreadyDone(session, paymentId);
      const p = await this.fetch(paymentId);
      if (p.user_uid !== session.uid) throw E.foreign();
      const cancelled = p.status.cancelled || p.status.user_cancelled;
      const tx = p.transaction;
      if (!cancelled && tx && (p.status.transaction_verified || p.status.developer_completed)) {
        return this.finish(session, p, local, resolveItem(p, local), tx.txid);
      }
      if (!cancelled) await this.callPi(() => pi.cancelPayment(paymentId));
      const metaItem = p.metadata["itemId"];
      await store
        .cancelPayment({
          paymentId,
          uid: session.uid,
          itemId: local?.itemId ?? (typeof metaItem === "string" ? metaItem.slice(0, 64) : ""),
          amount: local?.amount ?? p.amount,
        })
        .catch(fromStateError);
      return { ok: true, paymentId, status: "cancelled", user: publicUser(await this.userOf(session)) };
    });
  }

  private async finish(
    session: Session,
    p: PiPayment,
    local: PaymentRecord | null,
    item: ShopItem,
    txid: string,
  ): Promise<PaymentOutcome> {
    const { store, pi, now } = this.deps;
    // Only this server completes payments with Pi. Completed there but unknown here means the local record
    // was lost (e.g. a restart of the in-memory store) and the item was most likely granted already, so it
    // is restored without counting premium from now, which would hand out free days on every replay.
    const restoring = p.status.developer_completed && local === null;
    if (!p.status.developer_completed) await this.callPi(() => pi.completePayment(p.identifier, txid));
    await store.upsertUser(session.uid, session.username);
    const res = await store
      .completePayment(
        { paymentId: p.identifier, uid: session.uid, itemId: item.id, amount: p.amount, txid },
        (u) => (restoring ? restoreGrant(u, item, paidAt(p), now()) : applyGrant(u, item, now())),
      )
      .catch(fromStateError);
    return { ok: true, paymentId: p.identifier, status: "completed", user: publicUser(res.user), granted: res.granted };
  }

  private async alreadyDone(session: Session, paymentId: string): Promise<PaymentOutcome> {
    return { ok: true, paymentId, status: "completed", user: publicUser(await this.userOf(session)), granted: false };
  }

  private checkLocal(local: PaymentRecord | null, session: Session, approving: boolean): void {
    if (!local) return;
    if (local.uid !== session.uid) throw E.foreign();
    if (local.status === "cancelled") throw E.cancelled();
    if (approving && local.status === "completed") throw E.completed();
  }

  private async userOf(session: Session): Promise<UserRecord> {
    return (await this.deps.store.getUser(session.uid)) ?? (await this.deps.store.upsertUser(session.uid, session.username));
  }

  private async fetch(paymentId: string): Promise<PiPayment> {
    return this.callPi(() => this.deps.pi.getPayment(paymentId));
  }

  private async callPi<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw fromPiError(err);
    }
  }

  /** Runs calls for the same payment one after another. */
  private async serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

/** When the payment was made, from Pi's created_at; null when absent or unparseable. */
function paidAt(p: PiPayment): number | null {
  if (p.created_at === undefined) return null;
  const t = Date.parse(p.created_at);
  return Number.isFinite(t) ? t : null;
}

/**
 * The catalog item a payment is for. The amount must equal the catalog price, or, for a payment we
 * already approved, the amount recorded at approval (so a later price change cannot strand a paid purchase).
 */
function resolveItem(p: PiPayment, local: PaymentRecord | null): ShopItem {
  const itemId = p.metadata["itemId"];
  const item = typeof itemId === "string" ? shopItem(itemId) : undefined;
  if (!item) throw E.unknownItem();
  if (local && local.itemId !== item.id) throw E.itemMismatch();
  if (!sameAmount(p.amount, local ? local.amount : item.pricePi)) throw E.amount();
  return item;
}
