/** Routes throw this for anything with a specific intended HTTP status (404, 401, 409, ...); the
 * error-handler plugin is the only place that turns any error into an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
