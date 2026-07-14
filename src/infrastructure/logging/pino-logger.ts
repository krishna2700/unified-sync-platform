import pino, { type Logger as Pino } from 'pino';
import type { Logger } from '../../domain/ports/logger.port.js';

/** Thin adapter so the rest of the codebase depends on the `Logger` port, not Pino directly. */
export class PinoLogger implements Logger {
  private constructor(private readonly pino: Pino) {}

  static create(level: string): PinoLogger {
    const transport =
      process.env['NODE_ENV'] === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          };
    return new PinoLogger(pino({ level, transport }));
  }

  static fromPino(instance: Pino): PinoLogger {
    return new PinoLogger(instance);
  }

  /** Escape hatch for the composition root to hand the same underlying pino instance to
   * Fastify's own `logger` option, so app logs and per-request access logs share one hierarchy. */
  get raw(): Pino {
    return this.pino;
  }

  debug(message: string, context: Record<string, unknown> = {}): void {
    this.pino.debug(context, message);
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.pino.info(context, message);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.pino.warn(context, message);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.pino.error(context, message);
  }

  child(bindings: Record<string, unknown>): Logger {
    return PinoLogger.fromPino(this.pino.child(bindings));
  }
}
