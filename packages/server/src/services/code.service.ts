import { customAlphabet } from 'nanoid';

// 自定义字母表，排除易混淆字符（0OIl1）
const PICKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateCode = customAlphabet(PICKUP_ALPHABET, 6);

export class CodeService {
  private static CODE_LENGTH = 6;

  static generate(): string {
    return generateCode();
  }

  static validate(code: string): boolean {
    if (!code || code.length !== this.CODE_LENGTH) {
      return false;
    }
    // 允许大写字母和数字，排除易混淆字符
    return /^[A-HJ-NP-Z2-9]+$/i.test(code);
  }
}
