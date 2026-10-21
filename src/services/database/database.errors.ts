/**
 * PPEye Supabase Database Service — Typed Database Errors
 */

export type DatabaseErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'QUERY_FAILED'
  | 'CONNECTION_ERROR';

export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly originalError?: unknown;
  readonly details?: Record<string, any>;

  constructor(
    code: DatabaseErrorCode,
    message: string,
    options?: { originalError?: unknown; details?: Record<string, any> }
  ) {
    super(`[DatabaseError: ${code}] ${message}`);
    this.name = 'DatabaseError';
    this.code = code;
    this.originalError = options?.originalError;
    this.details = options?.details;
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

/**
 * Normalizes PostgreSQL / Supabase PostgREST errors into typed DatabaseError.
 */
export function toDatabaseError(err: unknown, defaultMessage = 'Database operation failed'): DatabaseError {
  if (err instanceof DatabaseError) {
    return err;
  }

  const anyErr = err as any;
  const message = anyErr?.message ?? defaultMessage;
  const pgCode = anyErr?.code;

  // PostgreSQL unique violation
  if (pgCode === '23505' || message.includes('duplicate key') || message.includes('violates unique constraint')) {
    return new DatabaseError('CONFLICT', message, { originalError: err, details: { pgCode } });
  }

  // Row Level Security violation
  if (pgCode === '42501' || message.includes('row-level security') || message.includes('permission denied')) {
    return new DatabaseError('PERMISSION_DENIED', message, { originalError: err, details: { pgCode } });
  }

  // Foreign key violation
  if (pgCode === '23503' || message.includes('foreign key constraint')) {
    return new DatabaseError('VALIDATION_ERROR', `Referenced entity does not exist: ${message}`, {
      originalError: err,
      details: { pgCode },
    });
  }

  // Not null violation
  if (pgCode === '23502' || message.includes('null value in column')) {
    return new DatabaseError('VALIDATION_ERROR', `Required field is missing: ${message}`, {
      originalError: err,
      details: { pgCode },
    });
  }

  // PGRST116: JSON object requested, multiple (or no) rows returned
  if (pgCode === 'PGRST116') {
    return new DatabaseError('NOT_FOUND', 'Requested record was not found', { originalError: err, details: { pgCode } });
  }

  return new DatabaseError('QUERY_FAILED', message, { originalError: err, details: { pgCode } });
}
