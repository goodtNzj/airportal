export interface CreateTransferInput {
  contentType: 'file' | 'text';
  textContent?: string;
  fileName?: string;
  fileSize?: number;
  filePath?: string;
  fileMimeType?: string;
  expiresIn?: number;
  userId?: number;
}

export interface TransferResult {
  pickupCode: string;
  expiresAt: Date;
  expiresIn: number;
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
  maxTextLength: number;
  defaultExpiry: number;
  maxExpiry: number;
}
