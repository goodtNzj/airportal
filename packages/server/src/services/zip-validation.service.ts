import type { ZipValidationConfig, ZipValidationResult } from '../types/index.js';

/**
 * ZIP archive security validation service.
 * Parses the ZIP central directory WITHOUT decompression to detect:
 * - Path traversal attacks (../, absolute paths, null bytes, drive letters)
 * - ZIP bombs (high compression ratio)
 * - Excessive entry counts
 * - Excessive uncompressed sizes
 * - Malformed archives
 */
export class ZipValidationService {
  private readonly ZIP_LOCAL_FILE_HEADER = 0x04034b50;
  private readonly ZIP_CENTRAL_DIRECTORY = 0x02014b50;
  private readonly ZIP_END_OF_CENTRAL_DIR = 0x06054b50;
  private readonly ZIP64_END_OF_CENTRAL_DIR = 0x06064b50;

  validateZipArchive(buffer: Buffer, config: ZipValidationConfig): ZipValidationResult {
    if (buffer.length < 22) {
      return { valid: false, reason: '文件太小，不是有效的 ZIP 文件' };
    }

    // 1. Verify magic bytes (PK\x03\x04)
    if (buffer.readUInt32LE(0) !== this.ZIP_LOCAL_FILE_HEADER) {
      return { valid: false, reason: '不是有效的 ZIP 文件' };
    }

    // 2. Find End of Central Directory Record
    const eocdOffset = this.findEOCD(buffer);
    if (eocdOffset === -1) {
      return { valid: false, reason: '损坏的 ZIP 文件（无法找到中央目录）' };
    }

    // 3. Read total entry count from EOCD
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
    const cdSize = buffer.readUInt32LE(eocdOffset + 12);

    // Check for ZIP64 (if central directory offset is 0xFFFFFFFF)
    let actualTotalEntries = totalEntries;
    let actualCdOffset = cdOffset;

    if (totalEntries === 0xFFFF || cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
      const zip64Result = this.findZip64EOCD(buffer, eocdOffset);
      if (zip64Result) {
        actualTotalEntries = zip64Result.totalEntries;
        actualCdOffset = zip64Result.cdOffset;
      }
    }

    if (actualTotalEntries > config.maxEntries) {
      return {
        valid: false,
        reason: `ZIP 包含 ${actualTotalEntries} 个条目，超过最大限制 ${config.maxEntries}`,
        entryCount: actualTotalEntries,
      };
    }

    // 4. Parse central directory entries
    let estimatedCompressed = 0;
    let estimatedUncompressed = 0;
    let pos = actualCdOffset;
    let entriesProcessed = 0;

    // Collect entry offsets so we can verify local headers
    const entries: { localHeaderOffset: number; compressedSize: number; uncompressedSize: number; compressionMethod: number; fileName: string }[] = [];

    for (let i = 0; i < actualTotalEntries && pos + 46 <= buffer.length; i++) {
      const signature = buffer.readUInt32LE(pos);
      if (signature !== this.ZIP_CENTRAL_DIRECTORY) {
        // May have hit a digital signature or extra data
        break;
      }

      const compressionMethod = buffer.readUInt16LE(pos + 10);
      const compressedSize = buffer.readUInt32LE(pos + 20);
      const uncompressedSize = buffer.readUInt32LE(pos + 24);
      const fileNameLength = buffer.readUInt16LE(pos + 28);
      const extraFieldLength = buffer.readUInt16LE(pos + 30);
      const commentLength = buffer.readUInt16LE(pos + 32);
      const localHeaderOffset = buffer.readUInt32LE(pos + 42);

      // Validate filename length
      if (fileNameLength > config.maxFileNameLength) {
        return {
          valid: false,
          reason: `文件名过长 (${fileNameLength} 字节)，最大允许 ${config.maxFileNameLength}`,
        };
      }

      // Read filename
      const fileNameStart = pos + 46;
      const fileNameEnd = fileNameStart + fileNameLength;
      if (fileNameEnd > buffer.length) {
        return { valid: false, reason: 'ZIP 文件结构异常' };
      }

      const fileName = buffer.toString('utf-8', fileNameStart, fileNameEnd);

      // Path traversal check
      if (this.isPathTraversal(fileName)) {
        return {
          valid: false,
          reason: `检测到路径遍历攻击: ${fileName.substring(0, 50)}`,
        };
      }

      estimatedCompressed += compressedSize;
      estimatedUncompressed += uncompressedSize;

      entries.push({
        localHeaderOffset,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        fileName,
      });

      entriesProcessed++;
      pos += 46 + fileNameLength + extraFieldLength + commentLength;
    }

    // Empty archive check
    if (entriesProcessed === 0) {
      return { valid: false, reason: 'ZIP 文件为空或无法解析' };
    }

    // 5. Verify local file headers for stored entries to prevent CD size forgery.
    //    An attacker can set small compressedSize in the CD but store massive data
    //    in the local file entries. We cross-check: sum of local header sizes must
    //    not exceed the actual file size, and for stored entries the local header
    //    size must match the CD size.
    let verifiedLocalSize = 0;
    for (const entry of entries) {
      const lhPos = entry.localHeaderOffset;
      if (lhPos + 30 > buffer.length) {
        return { valid: false, reason: 'ZIP 文件结构异常（本地文件头越界）' };
      }

      const lhSignature = buffer.readUInt32LE(lhPos);
      if (lhSignature !== this.ZIP_LOCAL_FILE_HEADER) {
        return { valid: false, reason: 'ZIP 文件本地文件头损坏' };
      }

      const lhCompressedSize = buffer.readUInt32LE(lhPos + 18);
      const lhFileNameLength = buffer.readUInt16LE(lhPos + 26);
      const lhExtraFieldLength = buffer.readUInt16LE(lhPos + 28);

      // For stored (no compression) entries, the local header compressed size
      // must match the central directory claim
      if (entry.compressionMethod === 0 && lhCompressedSize !== entry.compressedSize) {
        return {
          valid: false,
          reason: `文件 "${entry.fileName}" 的声明大小与实际大小不一致`,
        };
      }

      // Verify that the entry's data range is within the buffer
      const dataStart = lhPos + 30 + lhFileNameLength + lhExtraFieldLength;
      const dataEnd = dataStart + lhCompressedSize;
      if (dataEnd > buffer.length) {
        return {
          valid: false,
          reason: `文件 "${entry.fileName.substring(0, 50)}" 的数据超出缓冲区范围`,
        };
      }

      verifiedLocalSize += lhCompressedSize;
    }

    // Check that the actual data portions fit within the file
    if (verifiedLocalSize > buffer.length) {
      return {
        valid: false,
        reason: 'ZIP 文件声明大小超出实际文件大小',
      };
    }

    // 6. Check uncompressed size limit
    if (estimatedUncompressed > config.maxUncompressedSize) {
      const sizeMB = (estimatedUncompressed / 1024 / 1024).toFixed(1);
      const limitMB = (config.maxUncompressedSize / 1024 / 1024).toFixed(0);
      return {
        valid: false,
        reason: `ZIP 解压后约 ${sizeMB}MB，超过限制 ${limitMB}MB`,
        estimatedUncompressedSize: estimatedUncompressed,
        entryCount: entriesProcessed,
      };
    }

    // 7. Check compression ratio (ZIP bomb detection)
    if (estimatedCompressed > 0) {
      const ratio = estimatedUncompressed / estimatedCompressed;
      if (ratio > config.maxCompressionRatio) {
        return {
          valid: false,
          reason: `检测到可疑的压缩比 ${ratio.toFixed(1)}:1（可能是 ZIP 炸弹）`,
          estimatedUncompressedSize: estimatedUncompressed,
          entryCount: entriesProcessed,
        };
      }
    }

    return {
      valid: true,
      entryCount: entriesProcessed,
      estimatedUncompressedSize: estimatedUncompressed,
    };
  }

  /**
   * Search backwards from the end of the buffer for the EOCD signature.
   */
  private findEOCD(buffer: Buffer): number {
    const maxCommentLength = 65535;
    const searchStart = Math.max(0, buffer.length - maxCommentLength - 22);
    for (let i = buffer.length - 22; i >= searchStart; i--) {
      if (buffer.readUInt32LE(i) === this.ZIP_END_OF_CENTRAL_DIR) {
        // Additional sanity check: comment length should not exceed remaining bytes
        const commentLength = buffer.readUInt16LE(i + 20);
        if (i + 22 + commentLength <= buffer.length) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Attempt to locate and parse ZIP64 End of Central Directory Locator + Record.
   */
  private findZip64EOCD(
    buffer: Buffer,
    eocdOffset: number
  ): { totalEntries: number; cdOffset: number } | null {
    // ZIP64 EOCD Locator is 20 bytes before the regular EOCD
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset < 0) return null;

    const locatorSignature = buffer.readUInt32LE(locatorOffset);
    if (locatorSignature !== 0x07064b50) return null;

    const zip64EocdOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
    if (zip64EocdOffset < 0 || zip64EocdOffset + 56 > buffer.length) return null;

    const zip64Signature = buffer.readUInt32LE(zip64EocdOffset);
    if (zip64Signature !== this.ZIP64_END_OF_CENTRAL_DIR) return null;

    const totalEntries = Number(buffer.readBigUInt64LE(zip64EocdOffset + 32));
    const cdOffset = Number(buffer.readBigUInt64LE(zip64EocdOffset + 48));

    return { totalEntries, cdOffset };
  }

  /**
   * Check a file path inside the ZIP for traversal attacks.
   */
  private isPathTraversal(filePath: string): boolean {
    // Normalize backslashes to forward slashes
    const normalized = filePath.replace(/\\/g, '/');

    // Null bytes indicate path truncation attacks
    if (normalized.includes('\x00')) return true;

    // Absolute paths
    if (normalized.startsWith('/')) return true;

    // Parent directory traversal
    if (normalized.includes('..')) return true;

    // Windows drive letters (e.g., C:)
    if (/^[a-zA-Z]:/.test(normalized)) return true;

    // Home directory expansion
    if (normalized.startsWith('~')) return true;

    return false;
  }
}

export const zipValidationService = new ZipValidationService();
