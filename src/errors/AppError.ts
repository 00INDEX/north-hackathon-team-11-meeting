/**
 * Structured application error contract.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * All API validation and domain failures are returned through this stable body.
 */
export type ConflictType =
  | 'room'
  | 'resource'
  | 'rule'
  | 'reservation'
  | 'version'
  | 'time';

export interface ConflictDetail {
  type: ConflictType;
  id: string;
  name: string;
  start?: string;
  end?: string;
  reason?: string;
}

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'OUTSIDE_OPEN_HOURS'
  | 'RULE_BLOCKED'
  | 'RESERVATION_CONFLICT'
  | 'NOT_FOUND'
  | 'FORCE_REASON_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR';

export interface AppErrorBody {
  error: {
    code: AppErrorCode;
    message: string;
    conflicts?: ConflictDetail[];
  };
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly conflicts?: ConflictDetail[];
  readonly status: number;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { status?: number; conflicts?: ConflictDetail[] } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.conflicts = options.conflicts;
    this.status = options.status ?? defaultStatusForCode(code);
  }

  toJSON(): AppErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        conflicts: this.conflicts,
      },
    };
  }
}

function defaultStatusForCode(code: AppErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORCE_REASON_REQUIRED':
    case 'VALIDATION_ERROR':
    case 'OUTSIDE_OPEN_HOURS':
    case 'RULE_BLOCKED':
    case 'RESERVATION_CONFLICT':
    case 'VERSION_CONFLICT':
      return 409;
    case 'IDEMPOTENCY_CONFLICT':
      return 409;
    default:
      return 500;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
