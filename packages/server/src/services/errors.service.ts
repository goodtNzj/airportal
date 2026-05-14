export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ErrorCodes = {
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_BLOCKED: 'FILE_TYPE_BLOCKED',
  STORAGE_EXCEEDED: 'STORAGE_EXCEEDED',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
  TRANSFER_EXPIRED: 'TRANSFER_EXPIRED',
  MAX_DOWNLOADS: 'MAX_DOWNLOADS',
  OWNER_ONLY: 'OWNER_ONLY',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  USER_EXISTS: 'USER_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  CODE_GENERATION_FAILED: 'CODE_GENERATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
} as const;

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : '未知错误';
  return new AppError('INTERNAL_ERROR', message, 500);
}
