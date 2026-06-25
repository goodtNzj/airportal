import type { SecurityPlugin, ScanResult, FileMetadata } from './types.js';
import { getConfig } from '../services/config.service.js';

interface HeuristicPattern {
  name: string;
  regex: string;
  weight: number;
  compiled?: RegExp;
}

const DEFAULT_PATTERNS: HeuristicPattern[] = [
  { name: 'code_exec', regex: 'eval\\s*\\(', weight: 30 },
  { name: 'shell_exec', regex: '(exec|passthru|shell_exec|popen)\\s*\\(', weight: 40 },
  { name: 'system_call', regex: '(os\\.system|subprocess|child_process)', weight: 35 },
  { name: 'powershell', regex: '(powershell|Invoke-Expression|IEX\\s*\\(|Start-Process)', weight: 45 },
  { name: 'cmd_exe', regex: 'cmd\\.exe', weight: 40 },
  { name: 'sql_injection', regex: '(DROP\\s+TABLE|UNION\\s+SELECT|--\\s)', weight: 35 },
  { name: 'xss_vector', regex: '(<script|onerror\\s*=|javascript:)', weight: 40 },
  { name: 'destructive_cmd', regex: '(rm\\s+-rf|del\\s+/f|format\\s+c:)', weight: 50 },
  { name: 'base64_decode', regex: '(base64_decode|atob\\s*\\(|fromCharCode)', weight: 25 },
  { name: 'wget_curl_pipe', regex: '((wget|curl)\\s+.*\\|\\s*(sh|bash))', weight: 45 },
  { name: 'reverse_shell', regex: '(nc\\s+-[el]|/dev/tcp|bash\\s+-i\\s+>&)', weight: 50 },
  { name: 'obfuscation', regex: '(unescape\\s*\\(|String\\.fromCharCode|decodeURIComponent)', weight: 20 },
];

export class HeuristicScanner implements SecurityPlugin {
  name = 'heuristic-scanner';
  version = '1.0.0';

  private patterns: HeuristicPattern[] = [];
  private entropyThreshold = 7.5;
  private maxScanSize = 10 * 1024 * 1024; // 10MB
  private rejectThreshold = 70;
  private warnThreshold = 40;

  async initialize(): Promise<void> {
    try {
      const config = getConfig();
      const hConfig = config.security.securityPlugin?.heuristic;
      if (hConfig) {
        this.entropyThreshold = hConfig.entropyThreshold ?? 7.5;
        this.maxScanSize = hConfig.maxScanSize ?? 10 * 1024 * 1024;
        this.rejectThreshold = hConfig.rejectRiskThreshold ?? 70;
        this.warnThreshold = hConfig.warnRiskThreshold ?? 40;
        if (hConfig.patterns && Array.isArray(hConfig.patterns) && hConfig.patterns.length > 0) {
          // Custom patterns supplement defaults rather than replacing them
          this.patterns = [...DEFAULT_PATTERNS, ...hConfig.patterns];
        }
      }
    } catch {
      // Config may not be initialized in tests
    }
    if (this.patterns.length === 0) {
      this.patterns = DEFAULT_PATTERNS;
    }
    // Pre-compile regex patterns
    for (const pattern of this.patterns) {
      try {
        pattern.compiled = new RegExp(pattern.regex, 'im');
      } catch {
        // Skip invalid regex patterns
      }
    }
  }

  async scanFile(buffer: Buffer, metadata: FileMetadata): Promise<ScanResult> {
    const reasons: string[] = [];
    let riskScore = 0;

    // Entropy analysis (only for files up to maxScanSize)
    let entropy = 0;
    if (buffer.length <= this.maxScanSize) {
      entropy = this.calculateEntropy(buffer);
      if (entropy > this.entropyThreshold) {
        riskScore += Math.min(50, Math.round((entropy - this.entropyThreshold) * 20));
        reasons.push(`高信息熵 (${entropy.toFixed(2)})，文件可能被加密或混淆`);
      }
    }

    // Pattern matching — skip for known binary formats to avoid false positives
    // PDF, Office docs (ZIP-based), images etc. contain binary streams that match
    // regex patterns coincidentally (e.g. `eval(` in PDF form fields, `exec` in xref)
    const isBinaryFormat = detectBinaryFormat(buffer);
    if (!isBinaryFormat) {
      const scanSlice = buffer.subarray(0, Math.min(buffer.length, this.maxScanSize));
      const textContent = scanSlice.toString('latin1');
      for (const pattern of this.patterns) {
        try {
          const re = pattern.compiled ?? new RegExp(pattern.regex, 'im');
          if (re.test(textContent)) {
            riskScore += pattern.weight;
            reasons.push(`检测到可疑模式: ${pattern.name}`);
            if (riskScore >= 100) break;
          }
        } catch {
          // Skip invalid regex patterns
        }
      }
    }

    // File extension vs content mismatch
    const extCheck = this.checkExtensionMismatch(buffer, metadata);
    if (extCheck) {
      riskScore += 20;
      reasons.push(extCheck);
    }

    riskScore = Math.min(100, Math.max(0, riskScore));

    let verdict: ScanResult['verdict'] = 'clean';
    if (riskScore >= this.rejectThreshold) {
      verdict = 'malicious';
    } else if (riskScore >= this.warnThreshold) {
      verdict = 'suspicious';
    }

    return {
      verdict,
      riskScore,
      reasons,
      details: { entropy: entropy.toFixed(2), fileSize: buffer.length },
      scannedAt: new Date(),
      duration: 0,
    };
  }

  async shutdown(): Promise<void> {
    this.patterns = [];
  }

  private calculateEntropy(buffer: Buffer): number {
    if (buffer.length === 0) return 0;
    const freq = new Array(256).fill(0);
    for (let i = 0; i < buffer.length; i++) {
      freq[buffer[i]]++;
    }
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (freq[i] === 0) continue;
      const p = freq[i] / buffer.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private checkExtensionMismatch(buffer: Buffer, metadata: FileMetadata): string | null {
    const ext = getLowerExt(metadata.filename);
    if (!ext) return null;

    if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' || ext === 'xml') {
      if (hasExecHeader(buffer)) {
        return `文件声明为 ${ext}，但检测到可执行文件头`;
      }
    }

    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'pdf') {
      if (hasExecHeader(buffer)) {
        return `文件声明为图片/文档格式 (${ext})，但检测到可执行文件头`;
      }
    }

    return null;
  }
}

function getLowerExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.substring(idx + 1).toLowerCase();
}

function hasExecHeader(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // MZ (PE/EXE)
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true; // ELF
  if (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) return true; // Mach-O 64
  if (buffer[0] === 0xce && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) return true; // Mach-O 32
  if (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) return true; // Mach-O fat
  return false;
}

/**
 * Detect known binary file formats via magic bytes.
 * These formats contain binary streams that produce false positives
 * when scanned with text-based regex patterns.
 */
function detectBinaryFormat(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'pdf';
  // ZIP-based Office formats (DOCX, XLSX, PPTX, ODT, etc.)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && (buffer[2] === 0x03 || buffer[2] === 0x05) && buffer[3] === 0x04) return 'zip/office';
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp';
  // WEBP (RIFF....WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
  // OLE2 Compound Document (legacy DOC, XLS, PPT)
  if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) return 'ole2';
  return null;
}

export const heuristicScanner = new HeuristicScanner();
