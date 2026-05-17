/**
 * Typed application errors. All exposed to the API as JSON:
 *   { error: { code, message, details? } }
 *
 * NEVER leak internal stack traces or DB errors to clients. Map at the boundary.
 */

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INSUFFICIENT_FUNDS'
  | 'WALLET_FROZEN'
  | 'KYC_REQUIRED'
  | 'KYC_LIMIT_EXCEEDED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_INVALID_SIGNATURE'
  | 'QUOTE_ALREADY_CONSUMED'
  | 'RISK_REJECTED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const ValidationError       = (msg: string, details?: unknown) => new AppError('VALIDATION_ERROR', msg, 400, details);
export const AuthRequired          = (msg = 'Authentication required')        => new AppError('AUTH_REQUIRED', msg, 401);
export const AuthInvalid           = (msg = 'Invalid credentials')            => new AppError('AUTH_INVALID',  msg, 401);
export const AuthExpired           = (msg = 'Session expired')                => new AppError('AUTH_EXPIRED',  msg, 401);
export const Forbidden             = (msg = 'Forbidden')                      => new AppError('FORBIDDEN',     msg, 403);
export const NotFound              = (msg = 'Not found')                      => new AppError('NOT_FOUND',     msg, 404);
export const Conflict              = (msg: string)                            => new AppError('CONFLICT',      msg, 409);
export const RateLimited           = (msg = 'Too many requests')              => new AppError('RATE_LIMITED',  msg, 429);
export const IdempotencyMismatch   = ()                                        => new AppError('IDEMPOTENCY_MISMATCH', 'Idempotency key reused with a different request body', 409);
export const InsufficientFunds     = ()                                        => new AppError('INSUFFICIENT_FUNDS', 'Insufficient funds', 422);
export const WalletFrozen          = ()                                        => new AppError('WALLET_FROZEN', 'Wallet is frozen', 423);
export const KycRequired           = (tier: string)                            => new AppError('KYC_REQUIRED', `KYC tier ${tier} required`, 403, { tier });
export const KycLimitExceeded      = ()                                        => new AppError('KYC_LIMIT_EXCEEDED', 'Transaction limit exceeded for current KYC tier', 403);
export const QuoteExpired          = ()                                        => new AppError('QUOTE_EXPIRED', 'Quote has expired', 410);
export const QuoteInvalidSignature = ()                                        => new AppError('QUOTE_INVALID_SIGNATURE', 'Quote signature is invalid', 400);
export const QuoteAlreadyConsumed  = ()                                        => new AppError('QUOTE_ALREADY_CONSUMED', 'Quote has already been used', 409);
export const RiskRejected          = (reason: string)                          => new AppError('RISK_REJECTED', reason, 403);
export const ProviderError         = (provider: string, msg: string)           => new AppError('PROVIDER_ERROR', `${provider}: ${msg}`, 502);
export const InternalError         = (msg = 'Internal server error')           => new AppError('INTERNAL_ERROR', msg, 500);
