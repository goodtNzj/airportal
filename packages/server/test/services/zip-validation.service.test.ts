import { describe, it, expect } from 'vitest';
import { ZipValidationService } from '../../src/services/zip-validation.service.js';

const defaultConfig = {
  maxUncompressedSize: 100 * 1024 * 1024, // 100MB
  maxCompressionRatio: 100,
  maxEntries: 1000,
  maxFileNameLength: 512,
};

function createMinimalZip(entries: Array<{ name: string; content: Buffer }>): Buffer {
  // Build a minimal ZIP file manually
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const localHeader = Buffer.alloc(30 + nameBuf.length + entry.content.length);
    let pos = 0;
    localHeader.writeUInt32LE(0x04034b50, pos); pos += 4; // signature
    localHeader.writeUInt16LE(20, pos); pos += 2; // version needed
    localHeader.writeUInt16LE(0, pos); pos += 2; // flags
    localHeader.writeUInt16LE(0, pos); pos += 2; // compression (stored)
    localHeader.writeUInt16LE(0, pos); pos += 2; // mod time
    localHeader.writeUInt16LE(0, pos); pos += 2; // mod date
    localHeader.writeUInt32LE(0, pos); pos += 4; // crc32
    localHeader.writeUInt32LE(entry.content.length, pos); pos += 4; // compressed size
    localHeader.writeUInt32LE(entry.content.length, pos); pos += 4; // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, pos); pos += 2; // file name length
    localHeader.writeUInt16LE(0, pos); pos += 2; // extra field length
    nameBuf.copy(localHeader, pos); pos += nameBuf.length;
    entry.content.copy(localHeader, pos); pos += entry.content.length;

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    pos = 0;
    centralHeader.writeUInt32LE(0x02014b50, pos); pos += 4;
    centralHeader.writeUInt16LE(20, pos); pos += 2; // version made by
    centralHeader.writeUInt16LE(20, pos); pos += 2; // version needed
    centralHeader.writeUInt16LE(0, pos); pos += 2; // flags
    centralHeader.writeUInt16LE(0, pos); pos += 2; // compression
    centralHeader.writeUInt16LE(0, pos); pos += 2; // mod time
    centralHeader.writeUInt16LE(0, pos); pos += 2; // mod date
    centralHeader.writeUInt32LE(0, pos); pos += 4; // crc32
    centralHeader.writeUInt32LE(entry.content.length, pos); pos += 4; // compressed size
    centralHeader.writeUInt32LE(entry.content.length, pos); pos += 4; // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, pos); pos += 2; // file name length
    centralHeader.writeUInt16LE(0, pos); pos += 2; // extra field length
    centralHeader.writeUInt16LE(0, pos); pos += 2; // comment length
    centralHeader.writeUInt16LE(0, pos); pos += 2; // disk number start
    centralHeader.writeUInt16LE(0, pos); pos += 2; // internal attributes
    centralHeader.writeUInt32LE(0, pos); pos += 4; // external attributes
    centralHeader.writeUInt32LE(offset, pos); pos += 4; // local header offset
    nameBuf.copy(centralHeader, pos);

    localHeaders.push(localHeader);
    centralHeaders.push(centralHeader);
    offset += localHeader.length;
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(centralHeaders);

  // EOCD
  const eocd = Buffer.alloc(22);
  let pos = 0;
  eocd.writeUInt32LE(0x06054b50, pos); pos += 4; // signature
  eocd.writeUInt16LE(0, pos); pos += 2; // disk number
  eocd.writeUInt16LE(0, pos); pos += 2; // disk with cd
  eocd.writeUInt16LE(entries.length, pos); pos += 2; // entries on disk
  eocd.writeUInt16LE(entries.length, pos); pos += 2; // total entries
  eocd.writeUInt32LE(cdBuf.length, pos); pos += 4; // cd size
  eocd.writeUInt32LE(cdOffset, pos); pos += 4; // cd offset
  eocd.writeUInt16LE(0, pos); // comment length

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

describe('ZipValidationService', () => {
  const service = new ZipValidationService();

  describe('validateZipArchive', () => {
    it('should accept a valid ZIP file', () => {
      const zip = createMinimalZip([
        { name: 'hello.txt', content: Buffer.from('Hello World') },
      ]);

      const result = service.validateZipArchive(zip, defaultConfig);
      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(1);
    });

    it('should accept ZIP with multiple entries', () => {
      const zip = createMinimalZip([
        { name: 'a.txt', content: Buffer.from('a') },
        { name: 'b.txt', content: Buffer.from('bb') },
        { name: 'dir/c.txt', content: Buffer.from('ccc') },
      ]);

      const result = service.validateZipArchive(zip, defaultConfig);
      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(3);
    });

    it('should reject non-ZIP files', () => {
      const buf = Buffer.from('This is not a ZIP file');
      const result = service.validateZipArchive(buf, defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('不是有效的 ZIP 文件');
    });

    it('should reject empty buffer', () => {
      const result = service.validateZipArchive(Buffer.alloc(0), defaultConfig);
      expect(result.valid).toBe(false);
    });

    it('should reject small buffer', () => {
      const result = service.validateZipArchive(Buffer.alloc(4, 0), defaultConfig);
      expect(result.valid).toBe(false);
    });

    it('should detect path traversal with ../', () => {
      const zip = createMinimalZip([
        { name: '../etc/passwd', content: Buffer.from('evil') },
      ]);

      const result = service.validateZipArchive(zip, defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('路径遍历');
    });

    it('should detect absolute paths', () => {
      const zip = createMinimalZip([
        { name: '/etc/passwd', content: Buffer.from('evil') },
      ]);

      const result = service.validateZipArchive(zip, defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('路径遍历');
    });

    it('should detect Windows drive letters', () => {
      const zip = createMinimalZip([
        { name: 'C:\\Windows\\evil.exe', content: Buffer.from('evil') },
      ]);

      const result = service.validateZipArchive(zip, defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('路径遍历');
    });

    it('should reject too many entries', () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        name: `file${i}.txt`,
        content: Buffer.from(`content${i}`),
      }));

      const zip = createMinimalZip(entries);
      const config = { ...defaultConfig, maxEntries: 2 };
      const result = service.validateZipArchive(zip, config);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('条目');
    });

    it('should reject empty archive', () => {
      const zip = createMinimalZip([]);
      const result = service.validateZipArchive(zip, defaultConfig);
      expect(result.valid).toBe(false);
    });

    it('should detect corrupted ZIP', () => {
      const zip = createMinimalZip([
        { name: 'test.txt', content: Buffer.from('ok') },
      ]);
      // Corrupt the buffer by truncating it
      const corrupted = zip.subarray(0, zip.length - 10);

      const result = service.validateZipArchive(corrupted, defaultConfig);
      expect(result.valid).toBe(false);
    });
  });
});
