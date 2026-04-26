import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fileValidationService } from '../../src/services/file-type.service.js';

// 模拟 logger
vi.mock('../../src/services/logger.service.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('FileValidationService', () => {
  describe('detectMimeType', () => {
    it('should detect PNG files', () => {
      // PNG 文件头
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(fileValidationService.detectMimeType(pngHeader)).toBe('image/png');
    });

    it('should detect JPEG files', () => {
      // JPEG 文件头
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(fileValidationService.detectMimeType(jpegHeader)).toBe('image/jpeg');
    });

    it('should detect GIF files', () => {
      // GIF 文件头
      const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38]);
      expect(fileValidationService.detectMimeType(gifHeader)).toBe('image/gif');
    });

    it('should detect PDF files', () => {
      const pdfHeader = Buffer.from('%PDF-1.4');
      expect(fileValidationService.detectMimeType(pdfHeader)).toBe('application/pdf');
    });

    it('should detect ZIP files', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      expect(fileValidationService.detectMimeType(zipHeader)).toBe('application/zip');
    });

    it('should detect text files', () => {
      const textContent = Buffer.from('Hello, World!');
      expect(fileValidationService.detectMimeType(textContent)).toBe('text/plain');
    });

    it('should detect EXE files (dangerous)', () => {
      const exeHeader = Buffer.from('MZ'); // DOS header
      expect(fileValidationService.detectMimeType(exeHeader)).toBe('application/x-msdos-program');
    });

    it('should return null for unknown binary', () => {
      const unknownBinary = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(fileValidationService.detectMimeType(unknownBinary)).toBeNull();
    });
  });

  describe('validateFile', () => {
    it('should pass valid PNG file', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const result = fileValidationService.validateFile(pngHeader, 'image/png', 'test.png');
      expect(result.valid).toBe(true);
      expect(result.isDangerous).toBe(false);
    });

    it('should fail when MIME type mismatch', () => {
      const textContent = Buffer.from('This is text, not an image');
      const result = fileValidationService.validateFile(textContent, 'image/png', 'fake.png');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('不匹配');
    });

    it('should detect dangerous files', () => {
      const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ header
      const result = fileValidationService.validateFile(exeHeader, 'application/octet-stream', 'test.exe');
      expect(result.valid).toBe(false);
      expect(result.isDangerous).toBe(true);
    });

    it('should allow compatible MIME types (docx as zip)', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const result = fileValidationService.validateFile(
        zipHeader,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'test.docx'
      );
      expect(result.valid).toBe(true);
    });
  });
});
