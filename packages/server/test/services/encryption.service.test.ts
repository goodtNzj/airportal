import { describe, it, expect, beforeAll } from 'vitest';
import { initConfig } from '../../src/services/config.service.js';
import { encrypt, decrypt } from '../../src/services/encryption.service.js';

beforeAll(async () => {
  await initConfig();
});

describe('encryption', () => {
  it('should encrypt and decrypt text', () => {
    const plaintext = 'Hello World';
    const cipherhex = encrypt(plaintext);
    expect(cipherhex).not.toBe(plaintext);
    expect(decrypt(cipherhex)).toBe(plaintext);
  });

  it('should handle long text', () => {
    const plaintext = 'A'.repeat(10000);
    const cipherhex = encrypt(plaintext);
    expect(decrypt(cipherhex)).toBe(plaintext);
  });

  it('should handle unicode characters', () => {
    const plaintext = '你好世界 🔐 安全传输';
    const cipherhex = encrypt(plaintext);
    expect(decrypt(cipherhex)).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same text';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('should fail on tampered ciphertext', () => {
    const plaintext = 'test data';
    const cipherhex = encrypt(plaintext);
    const corrupted = cipherhex.substring(0, cipherhex.length - 4) + 'dead';
    expect(() => decrypt(corrupted)).toThrow();
  });

  it('should fail on truncated ciphertext', () => {
    const cipherhex = encrypt('test');
    expect(() => decrypt(cipherhex.substring(0, 20))).toThrow();
  });
});
