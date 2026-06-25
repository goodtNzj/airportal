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

  describe('binary format detection (skip regex scan)', () => {
    it('should NOT flag eval() embedded in a real PDF buffer', async () => {
      // Build a buffer that starts with PDF magic bytes and contains eval(
      const pdf = Buffer.alloc(512);
      pdf.write('%PDF-1.4', 0); // PDF magic bytes
      pdf.write('eval(event.value)', 100); // typical PDF form field JS
      pdf.write('exec', 200); // typical xref stream byte sequence

      const result = await scanner.scanFile(pdf, {
        filename: 'form.pdf',
        mimetype: 'application/pdf',
        size: pdf.length,
      });

      // Regex scan should be skipped for PDF format
      expect(result.reasons.some((r) => r.includes('code_exec'))).toBe(false);
      expect(result.reasons.some((r) => r.includes('shell_exec'))).toBe(false);
      // Should not be marked malicious
      expect(result.verdict).not.toBe('malicious');
    });

    it('should NOT flag patterns in a ZIP/Office buffer', async () => {
      const zip = Buffer.alloc(256);
      zip[0] = 0x50; zip[1] = 0x4B; zip[2] = 0x03; zip[3] = 0x04; // PK magic
      zip.write('eval("xss")', 50);
      zip.write('<script>alert(1)</script>', 100);

      const result = await scanner.scanFile(zip, {
        filename: 'report.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: zip.length,
      });

      expect(result.reasons.some((r) => r.includes('code_exec'))).toBe(false);
      expect(result.reasons.some((r) => r.includes('xss_vector'))).toBe(false);
    });

    it('should NOT flag patterns in a PNG buffer', async () => {
      const png = Buffer.alloc(256);
      png[0] = 0x89; png[1] = 0x50; png[2] = 0x4E; png[3] = 0x47; // PNG magic
      png.write('eval()', 50);

      const result = await scanner.scanFile(png, {
        filename: 'image.png',
        mimetype: 'image/png',
        size: png.length,
      });

      expect(result.reasons.some((r) => r.includes('code_exec'))).toBe(false);
    });

    it('should still flag eval() when buffer has NO recognized magic bytes', async () => {
      // Buffer without any known magic bytes — regex scan should proceed
      const buf = Buffer.alloc(256);
      buf.write('eval("alert(1)")', 50);

      const result = await scanner.scanFile(buf, {
        filename: 'document.pdf', // filename is ignored; magic bytes are checked
        mimetype: 'application/pdf',
        size: buf.length,
      });

      // No magic bytes → regex scan runs → eval detected
      expect(result.reasons.some((r) => r.includes('code_exec'))).toBe(true);
    });

    it('should still run entropy analysis on binary formats', async () => {
      // High-entropy PDF-like buffer
      const pdf = Buffer.alloc(4096);
      pdf.write('%PDF-1.4', 0);
      for (let i = 10; i < pdf.length; i++) {
        pdf[i] = (i * 17 + 31) % 256;
      }

      const result = await scanner.scanFile(pdf, {
        filename: 'encrypted.pdf',
        mimetype: 'application/pdf',
        size: pdf.length,
      });

      // Entropy check still applies even for binary formats
      expect(result.details?.entropy).toBeDefined();
    });

    it('should still detect extension mismatch for binary formats', async () => {
      // MZ (PE executable) header pretending to be PDF
      const fake = Buffer.alloc(64);
      fake[0] = 0x4D; fake[1] = 0x5A; // MZ

      const result = await scanner.scanFile(fake, {
        filename: 'invoice.pdf',
        mimetype: 'application/pdf',
        size: fake.length,
      });

      expect(result.reasons.some((r) => r.includes('可执行文件头'))).toBe(true);
    });
  });

  describe('binary content detection (non-binary formats)', () => {
    it('should detect eval pattern in non-binary buffer', async () => {
      const buf = Buffer.alloc(256);
      buf.write('eval("alert(1)")', 50);
      const result = await scanner.scanFile(buf, {
        filename: 'script.js',
        mimetype: 'application/javascript',
        size: buf.length,
      });
      expect(result.reasons.some((r) => r.includes('code_exec'))).toBe(true);
    });

    it('should detect powershell in non-binary buffer', async () => {
      const buf = Buffer.alloc(512);
      buf.write('powershell -Command Invoke-Expression', 100);
      const result = await scanner.scanFile(buf, {
        filename: 'script.ps1',
        mimetype: 'text/plain',
        size: buf.length,
      });
      expect(result.reasons.some((r) => r.includes('powershell'))).toBe(true);
    });

    it('should not flag clean non-binary buffer', async () => {
      const buf = Buffer.alloc(1024);
      for (let i = 0; i < 1024; i++) {
        buf[i] = i % 256;
      }
      const result = await scanner.scanFile(buf, {
        filename: 'random.bin',
        mimetype: 'application/octet-stream',
        size: buf.length,
      });
      expect(result.riskScore).toBeLessThan(70);
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
