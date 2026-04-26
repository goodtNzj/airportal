import { describe, it, expect } from 'vitest';
import { CodeService } from '../../src/services/code.service.js';

describe('CodeService', () => {
  describe('generate', () => {
    it('should generate a 6-character code', () => {
      const code = CodeService.generate();
      expect(code).toHaveLength(6);
    });

    it('should only contain allowed characters', () => {
      const code = CodeService.generate();
      // 只包含 A-H, J-N, P-Z, 2-9（不含 0OIl1）
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/i);
    });

    it('should generate different codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(CodeService.generate());
      }
      // 100 个码应该都不同
      expect(codes.size).toBe(100);
    });
  });

  describe('validate', () => {
    it('should return true for valid codes', () => {
      expect(CodeService.validate('ABCDEF')).toBe(true);
      expect(CodeService.validate('XYZ234')).toBe(true);
      expect(CodeService.validate('A3X9K2')).toBe(true);
    });

    it('should return false for invalid length', () => {
      expect(CodeService.validate('ABCDE')).toBe(false);
      expect(CodeService.validate('ABCDEFG')).toBe(false);
      expect(CodeService.validate('')).toBe(false);
    });

    it('should return false for codes with 0 or 1', () => {
      expect(CodeService.validate('ABC0EF')).toBe(false); // 包含 0
      expect(CodeService.validate('ABC1EF')).toBe(false); // 包含 1
    });

    it('should return true for lowercase codes (case insensitive)', () => {
      expect(CodeService.validate('abcdef')).toBe(true);
    });
  });
});
