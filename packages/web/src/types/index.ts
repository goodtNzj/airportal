export interface TransferResult {
  pickupCode: string;
  expiresAt: string;
  expiresIn: number;
}

export interface TextTransfer {
  contentType: 'text';
  textContent: string;
  expiresAt: string;
}

export interface FileTransfer {
  contentType: 'file';
  fileName: string;
  fileSize: number;
  expiresAt: string;
}

export type TransferContent = TextTransfer | FileTransfer;

export interface User {
  id: number;
  username: string;
  createdAt: string;
}

export interface UserPayload {
  userId: number;
  username: string;
}

export interface Config {
  maxFileSize: number;
  maxTextLength: number;
  defaultExpiry: number;
  maxExpiry: number;
  folderUploadEnabled: boolean;
}

export interface UploadOptions {
  expiresIn?: number;
  maxDownloads?: number;
  ownerOnly?: boolean;
}

export interface FolderTransferResult extends TransferResult {
  fileCount: number;
  folderName: string;
}
