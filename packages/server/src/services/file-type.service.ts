import { logger } from './logger.service.js';

// 常见文件类型的 Magic Number（文件头签名）
const FILE_SIGNATURES: Record<string, { signature: Buffer; offset: number; mask?: Buffer }> = {
  // 图片
  'image/jpeg': { signature: Buffer.from([0xff, 0xd8, 0xff]), offset: 0 },
  'image/png': { signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), offset: 0 },
  'image/gif': { signature: Buffer.from([0x47, 0x49, 0x46, 0x38]), offset: 0 },
  'image/webp': { signature: Buffer.from([0x52, 0x49, 0x46, 0x46]), offset: 0 }, // RIFF, 需要额外检查
  'image/bmp': { signature: Buffer.from([0x42, 0x4d]), offset: 0 },
  'image/svg+xml': { signature: Buffer.from('<?xml'), offset: 0 },

  // 文档
  'application/pdf': { signature: Buffer.from('%PDF'), offset: 0 },
  'application/zip': { signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset: 0 },
  'application/x-rar-compressed': { signature: Buffer.from([0x52, 0x61, 0x72, 0x21]), offset: 0 },
  'application/x-7z-compressed': { signature: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), offset: 0 },

  // Office 文档
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset: 0 }, // xlsx (zip)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset: 0 }, // docx (zip)

  // 视频
  'video/mp4': { signature: Buffer.from([0x00, 0x00, 0x00]), offset: 0 }, // 需要额外检查 ftyp
  'video/webm': { signature: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), offset: 0 },
  'video/quicktime': { signature: Buffer.from([0x00, 0x00, 0x00]), offset: 0 }, // moov/mp4

  // 音频
  'audio/mpeg': { signature: Buffer.from([0xff, 0xfb]), offset: 0 }, // MP3
  'audio/wav': { signature: Buffer.from('RIFF'), offset: 0 },
  'audio/ogg': { signature: Buffer.from('OggS'), offset: 0 },

  // 可执行文件（危险）
  'application/x-msdos-program': { signature: Buffer.from('MZ'), offset: 0 }, // exe
  'application/x-executable': { signature: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), offset: 0 }, // ELF
  'application/java-archive': { signature: Buffer.from('PK'), offset: 0 }, // jar (zip)
};

// 危险文件类型列表
const DANGEROUS_MIME_TYPES = [
  'application/x-msdos-program', // exe, dll
  'application/x-executable',    // Linux 可执行文件
  'application/java-archive',    // jar
  'application/x-shockwave-flash', // swf
];

export interface FileValidationResult {
  valid: boolean;
  detectedMimeType?: string;
  declaredMimeType: string;
  reason?: string;
  isDangerous: boolean;
}

export class FileValidationService {
  /**
   * 检测文件真实类型
   */
  detectMimeType(buffer: Buffer): string | null {
    // 检查文件头
    for (const [mimeType, { signature, offset }] of Object.entries(FILE_SIGNATURES)) {
      if (buffer.length >= offset + signature.length) {
        const slice = buffer.slice(offset, offset + signature.length);
        if (slice.equals(signature)) {
          // 特殊处理：WebP 需要 WEBP 标识
          if (mimeType === 'image/webp' && buffer.length >= 12) {
            const webpMarker = buffer.slice(8, 12).toString('ascii');
            if (webpMarker === 'WEBP') {
              return mimeType;
            }
            continue;
          }
          // 特殊处理：MP4 需要 ftyp
          if (mimeType === 'video/mp4' && buffer.length >= 12) {
            const ftypMarker = buffer.slice(4, 8).toString('ascii');
            if (ftypMarker === 'ftyp') {
              return mimeType;
            }
            continue;
          }
          return mimeType;
        }
      }
    }

    // 检查文本文件
    if (this.isTextFile(buffer)) {
      // 检查是否是 SVG
      const content = buffer.slice(0, 100).toString('utf-8').toLowerCase();
      if (content.includes('<svg')) {
        return 'image/svg+xml';
      }
      return 'text/plain';
    }

    return null;
  }

  /**
   * 检查是否为文本文件
   */
  private isTextFile(buffer: Buffer): boolean {
    // 空文件视为文本
    if (buffer.length === 0) return true;

    // 检查前 512 字节是否为可打印字符
    const sampleSize = Math.min(buffer.length, 512);
    const sample = buffer.slice(0, sampleSize);

    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      // 允许的控制字符：换行、回车、制表符
      if (byte === 0x0a || byte === 0x0d || byte === 0x09) continue;
      // 可打印 ASCII 范围：32-126，以及扩展 ASCII 和 UTF-8
      if (byte < 32 && byte !== 0x09) {
        nonPrintable++;
      }
    }

    // 如果非打印字符超过 5%，可能不是文本文件
    return nonPrintable / sampleSize < 0.05;
  }

  /**
   * 验证文件安全性
   */
  validateFile(buffer: Buffer, declaredMimeType: string, filename: string): FileValidationResult {
    const detectedMimeType = this.detectMimeType(buffer);
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // 检查是否是危险文件类型（通过 magic bytes 或扩展名）
    const isDangerousByMagic = detectedMimeType && DANGEROUS_MIME_TYPES.includes(detectedMimeType);
    const isDangerousByExtension = this.isDangerousExtension(ext);

    if (isDangerousByMagic || (!detectedMimeType && isDangerousByExtension)) {
      logger.warn('Dangerous file detected', { filename, detectedMimeType, declaredMimeType, ext });
      return {
        valid: false,
        detectedMimeType: detectedMimeType ?? undefined,
        declaredMimeType,
        reason: '检测到危险的文件类型',
        isDangerous: true,
      };
    }

    // 检查 MIME 类型是否匹配
    if (detectedMimeType && declaredMimeType !== detectedMimeType) {
      // 某些类型可能是同源的（如 docx 和 zip）
      if (!this.isCompatibleMimeType(detectedMimeType, declaredMimeType)) {
        logger.warn('MIME type mismatch', { filename, detectedMimeType, declaredMimeType });
        return {
          valid: false,
          detectedMimeType,
          declaredMimeType,
          reason: `文件类型不匹配：声明的类型 ${declaredMimeType}，实际类型 ${detectedMimeType}`,
          isDangerous: false,
        };
      }
    }

    // 检查扩展名与内容是否匹配
    const extMismatch = this.checkExtensionMismatch(ext, detectedMimeType, declaredMimeType);
    if (extMismatch) {
      logger.warn('Extension mismatch', { filename, ext, detectedMimeType, declaredMimeType });
      // 不阻止上传，但记录警告
    }

    return {
      valid: true,
      detectedMimeType: detectedMimeType || declaredMimeType,
      declaredMimeType,
      isDangerous: false,
    };
  }

  /**
   * 检查 MIME 类型是否兼容（如 docx 实际是 zip）
   */
  private isCompatibleMimeType(detected: string, declared: string): boolean {
    // Office 文档实际是 ZIP 格式
    const zipBasedTypes = [
      'application/zip',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    if (zipBasedTypes.includes(detected) && zipBasedTypes.includes(declared)) {
      return true;
    }

    // 文本类型兼容
    const textTypes = ['text/plain', 'application/json', 'text/html', 'text/css', 'text/javascript'];
    if (detected === 'text/plain' && textTypes.includes(declared)) {
      return true;
    }

    return detected === declared;
  }

  /**
   * 检查扩展名是否对应危险文件类型
   */
  private isDangerousExtension(ext: string): boolean {
    const dangerousExts = ['exe', 'dll', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'msi', 'jar', 'elf', 'bin', 'com'];
    return dangerousExts.includes(ext);
  }

  /**
   * 检查扩展名与内容是否匹配
   */
  private checkExtensionMismatch(ext: string, detectedMimeType: string | null, _declaredMimeType: string): boolean {
    const extToMime: Record<string, string[]> = {
      'jpg': ['image/jpeg'],
      'jpeg': ['image/jpeg'],
      'png': ['image/png'],
      'gif': ['image/gif'],
      'webp': ['image/webp'],
      'pdf': ['application/pdf'],
      'zip': ['application/zip', 'application/x-zip-compressed'],
      'mp4': ['video/mp4'],
      'mp3': ['audio/mpeg'],
    };

    if (extToMime[ext] && detectedMimeType) {
      return !extToMime[ext].includes(detectedMimeType);
    }

    return false;
  }
}

export const fileValidationService = new FileValidationService();
