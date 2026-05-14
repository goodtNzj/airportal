import { describe, it, expect } from 'vitest';
import { AppError, ErrorCodes } from '../../src/services/errors.service.js';

describe('AppError', () => {
  it('should create with code and message', () => {
    const err = new AppError('TEST_ERROR', 'test message');
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('test message');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('AppError');
  });

  it('should set custom status code', () => {
    const err = new AppError('NOT_FOUND', 'not found', 404);
    expect(err.statusCode).toBe(404);
  });

  it('should set details', () => {
    const err = new AppError('ERR', 'msg', 400, { key: 'value' });
    expect(err.details).toEqual({ key: 'value' });
  });

  it('should be instanceof Error', () => {
    expect(new AppError('X', 'msg')).toBeInstanceOf(Error);
    expect(new AppError('X', 'msg')).toBeInstanceOf(AppError);
  });
});

describe('ErrorCodes', () => {
  it('should define all error codes', () => {
    expect(ErrorCodes.TEXT_TOO_LONG).toBe('TEXT_TOO_LONG');
    expect(ErrorCodes.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE');
    expect(ErrorCodes.PATH_TRAVERSAL).toBe('PATH_TRAVERSAL');
    expect(ErrorCodes.TRANSFER_NOT_FOUND).toBe('TRANSFER_NOT_FOUND');
    expect(ErrorCodes.TRANSFER_EXPIRED).toBe('TRANSFER_EXPIRED');
    expect(ErrorCodes.MAX_DOWNLOADS).toBe('MAX_DOWNLOADS');
    expect(ErrorCodes.OWNER_ONLY).toBe('OWNER_ONLY');
    expect(ErrorCodes.LOGIN_REQUIRED).toBe('LOGIN_REQUIRED');
    expect(ErrorCodes.USER_EXISTS).toBe('USER_EXISTS');
    expect(ErrorCodes.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(ErrorCodes.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
    expect(ErrorCodes.CODE_GENERATION_FAILED).toBe('CODE_GENERATION_FAILED');
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCodes.ACCOUNT_LOCKED).toBe('ACCOUNT_LOCKED');
    expect(ErrorCodes.STORAGE_EXCEEDED).toBe('STORAGE_EXCEEDED');
    expect(ErrorCodes.FILE_TYPE_BLOCKED).toBe('FILE_TYPE_BLOCKED');
  });
});
