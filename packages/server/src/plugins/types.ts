export interface FileMetadata {
  filename: string;
  mimetype: string;
  size: number;
  ip?: string;
  userId?: number;
}

export interface ScanResult {
  verdict: 'clean' | 'suspicious' | 'malicious';
  riskScore: number; // 0-100
  reasons: string[];
  details?: Record<string, unknown>;
  scannedAt: Date;
  duration: number; // ms
}

export interface SecurityPlugin {
  name: string;
  version: string;
  initialize(): Promise<void>;
  scanFile(buffer: Buffer, metadata: FileMetadata): Promise<ScanResult>;
  scanText?(content: string, metadata?: Record<string, unknown>): Promise<ScanResult>;
  shutdown(): Promise<void>;
}
