import { describe, it, expect, beforeEach } from 'vitest';
import { HeuristicScanner } from '../../src/plugins/heuristic-scanner.js';

describe('HeuristicScanner', () => {
  let scanner: HeuristicScanner;

  beforeEach(async () => {
    scanner = new HeuristicScanner();
    await scanner.initialize();
  });

  describe('scanFile', () => {
    it('should return clean for a plain text file', async () => {
      const result = await scanner.scanFile(Buffer.from('Hello World'), {
        filename: 'test.txt',
        mimetype: 'text/plain',
        size: 11,
      });

      expect(result.verdict).toBe('clean');
      expect(result.riskScore).toBeLessThan(40);
    });

    it('should detect eval() as suspicious code execution', async () => {
      const content = 'eval("malicious code here")';
      const result = await scanner.scanFile(Buffer.from(content), {
        filename: 'script.js',
        mimetype: 'application/javascript',
        size: content.length,
      });

      expect(result.riskScore).toBeGreaterThanOrEqual(30);
      expect(result.reasons.some((r) => r.includes('code_exec'))).toBe(true);
    });

    it('should detect shell exec patterns', async () => {
      const content = 'shell_exec("rm -rf /")';
      const result = await scanner.scanFile(Buffer.from(content), {
        filename: 'bad.php',
        mimetype: 'text/plain',
        size: content.length,
      });

      expect(result.riskScore).toBeGreaterThanOrEqual(40);
      expect(result.reasons.some((r) => r.includes('shell_exec'))).toBe(true);
    });

    it('should detect destructive commands', async () => {
      const content = 'rm -rf /home/user';
      const result = await scanner.scanFile(Buffer.from(content), {
        filename: 'evil.sh',
        mimetype: 'text/plain',
        size: content.length,
      });

      expect(result.riskScore).toBeGreaterThanOrEqual(50);
      expect(result.reasons.some((r) => r.includes('destructive_cmd'))).toBe(true);
    });

    it('should flag high-entropy content', async () => {
      const highEntropy = Buffer.alloc(4096);
      // Fill with random-like data
      for (let i = 0; i < highEntropy.length; i++) {
        highEntropy[i] = (i * 17 + 31) % 256;
      }

      const result = await scanner.scanFile(highEntropy, {
        filename: 'encrypted.bin',
        mimetype: 'application/octet-stream',
        size: highEntropy.length,
      });

      expect(result.reasons.some((r) => r.includes('熵'))).toBe(true);
    });

    it('should flag executable header pretending to be .txt', async () => {
      const execHeader = Buffer.alloc(64);
      // MZ header (PE executable)
      execHeader[0] = 0x4d; // 'M'
      execHeader[1] = 0x5a; // 'Z'

      const result = await scanner.scanFile(execHeader, {
        filename: 'readme.txt',
        mimetype: 'text/plain',
        size: execHeader.length,
      });

      expect(result.reasons.some((r) => r.includes('可执行文件头'))).toBe(true);
    });

    it('should detect XSS vectors', async () => {
      const content = '<script>alert("xss")</script>';
      const result = await scanner.scanFile(Buffer.from(content), {
        filename: 'page.html',
        mimetype: 'text/html',
        size: content.length,
      });

      expect(result.riskScore).toBeGreaterThanOrEqual(40);
      expect(result.reasons.some((r) => r.includes('xss_vector'))).toBe(true);
    });

    it('should cap risk score at 100', async () => {
      // Content that matches many patterns
      const content = 'eval(\'bad\'); exec("evil"); shell_exec("hack"); cmd.exe; powershell; <script>; rm -rf /';
      const result = await scanner.scanFile(Buffer.from(content), {
        filename: 'malicious.txt',
        mimetype: 'text/plain',
        size: content.length,
      });

      expect(result.riskScore).toBeLessThanOrEqual(100);
      expect(result.verdict).toBe('malicious');
    });

    it('should scan large files up to maxScanSize', async () => {
      const largeContent = 'Hello World\n'.repeat(1000);
      const result = await scanner.scanFile(Buffer.from(largeContent), {
        filename: 'large.txt',
        mimetype: 'text/plain',
        size: largeContent.length,
      });

      expect(result.verdict).toBe('clean');
    });

    it('should include entropy and fileSize in details', async () => {
      const result = await scanner.scanFile(Buffer.from('hello'), {
        filename: 'hello.txt',
        mimetype: 'text/plain',
        size: 5,
      });

      expect(result.details?.entropy).toBeDefined();
      expect(result.details?.fileSize).toBe(5);
    });
  });

  describe('shutdown', () => {
    it('should clear patterns', async () => {
      await scanner.shutdown();
      // After shutdown, rescanning should still work (just no patterns)
      const result = await scanner.scanFile(Buffer.from('eval()'), {
        filename: 't.txt',
        mimetype: 'text/plain',
        size: 6,
      });
      // High-entropy check still works, patterns are cleared so no pattern matches
      expect(result.riskScore).toBeLessThanOrEqual(30);
    });
  });
});
