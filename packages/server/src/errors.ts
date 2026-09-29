/** An error with an HTTP status, a stable machine code and a player-facing (Russian) message. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON body of every error response. */
export interface ErrorBody {
  error: string;
  code: string;
}
