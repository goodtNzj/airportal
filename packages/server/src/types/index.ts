export interface CreateTransferInput {
  contentType: 'file' | 'text' | 'folder';
  textContent?: string;
  fileName?: string;
  fileSize?: number;
  filePath?: string;
  fileMimeType?: string;
  expiresIn?: number;
  userId?: number;
  fileCount?: number;
  folderName?: string;
  maxDownloads?: number;
  ownerOnly?: boolean;
}

export interface TransferResult {
  pickupCode: string;
  expiresAt: Date;
  expiresIn: number;
  fileCount?: number;
  folderName?: string;
}

export interface FolderMetadata {
  fileCount: number;
  folderName: string;
  estimatedUncompressedSize: number;
}

export interface ZipValidationConfig {
  maxUncompressedSize: number;
  maxCompressionRatio: number;
  maxEntries: number;
  maxFileNameLength: number;
}

export interface ZipValidationResult {
  valid: boolean;
  reason?: string;
  entryCount?: number;
  estimatedUncompressedSize?: number;
}

export interface UserPayload {
  userId: number;
  username: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ConfigResponse {
  maxFileSize: number;
  maxFolderUncompressedSize: number;
  maxFolderCompressedSize: number;
  maxTextLength: number;
  defaultExpiry: number;
  maxExpiry: number;
  folderUploadEnabled: boolean;
}

export type { FileMetadata, ScanResult, SecurityPlugin } from '../plugins/types.js';
