import { SignJWT, jwtVerify } from "jose";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Who a session token belongs to. */
export interface Session {
  uid: string;
  username: string;
}

/** Guest accounts (`POST /api/auth/guest`) get uids with this prefix; Pi uids never have it. */
export const GUEST_UID_PREFIX = "guest:";

export function isGuestSession(session: Session): boolean {
  return session.uid.startsWith(GUEST_UID_PREFIX);
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = "korony-pustoshi";
const AUDIENCE = "korony-session";
const ALG = "HS256";

export interface SessionAuth {
  sign(session: Session): Promise<string>;
  /** The session inside a valid token, or null (bad signature, expired, malformed). */
  verify(token: string): Promise<Session | null>;
}

export function createSessionAuth(secret: string, ttlSeconds = SESSION_TTL_SECONDS): SessionAuth {
  const key = new TextEncoder().encode(secret);
  return {
    async sign(session) {
      return new SignJWT({ username: session.username })
        .setProtectedHeader({ alg: ALG, typ: "JWT" })
        .setSubject(session.uid)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key);
    },
    async verify(token) {
      if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: [ALG], issuer: ISSUER, audience: AUDIENCE });
        const uid = payload.sub;
        const username = payload["username"];
        if (typeof uid !== "string" || uid.length === 0 || typeof username !== "string") return null;
        return { uid, username };
      } catch {
        return null;
      }
    },
  };
}

/** Token from an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

/** Express middleware: rejects requests without a valid session with 401 and stores the session in res.locals. */
export function requireSession(auth: SessionAuth): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req.get("authorization"));
    const session = token ? await auth.verify(token) : null;
    if (!session) {
      res.status(401).json({ error: "Нужно войти заново", code: "unauthorized" });
      return;
    }
    res.locals["session"] = session;
    next();
  };
}

/** The session stored by requireSession. */
export function sessionOf(res: Response): Session {
  const s = res.locals["session"] as Session | undefined;
  if (!s) throw new Error("sessionOf() used on a route without requireSession()");
  return s;
}
