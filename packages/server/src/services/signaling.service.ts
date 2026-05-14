import { discoveryService } from './discovery.service.js';
import { roomService } from './room.service.js';
import { logger } from './logger.service.js';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'transfer-request' | 'transfer-accept' | 'transfer-reject';
  from: string;
  to: string;
  payload?: unknown;
}

export interface TransferMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
}

export interface PendingTransfer {
  id: string;
  fromSocketId: string;
  toSocketId: string;
  metadata: TransferMetadata;
  createdAt: Date;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

class SignalingService {
  private pendingTransfers: Map<string, PendingTransfer> = new Map();
  private requestTimeout: number = 60000; // 60 seconds
  private maxPendingTransfers = 500;

  /**
   * Generate a unique transfer ID
   */
  private generateTransferId(): string {
    return `transfer-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Handle incoming signaling message
   */
  handleMessage(fromSocketId: string, message: SignalingMessage): void {
    // Validate that from matches the actual sender
    if (message.from !== fromSocketId) {
      logger.warn('Signaling message with mismatched from field', {
        actualFrom: fromSocketId,
        claimedFrom: message.from,
      });
      return;
    }

    // Verify both peers are in the same room
    const inSameRoom = roomService.areInSameRoom(message.from, message.to);

    if (!inSameRoom) {
      logger.warn('Signaling message between peers not in same room', {
        from: message.from,
        to: message.to,
      });
      discoveryService.sendToPeer(message.from, {
        type: 'error',
        code: 'PEER_NOT_REACHABLE',
        message: 'Cannot communicate with this peer - not in the same room',
      });
      return;
    }

    switch (message.type) {
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.forwardSignaling(message);
        break;

      case 'transfer-request':
        this.handleTransferRequest(message);
        break;

      case 'transfer-accept':
        this.handleTransferAccept(message);
        break;

      case 'transfer-reject':
        this.handleTransferReject(message);
        break;

      default:
        logger.warn('Unknown signaling message type', { type: message.type });
    }
  }

  /**
   * Forward WebRTC signaling messages (offer, answer, ice-candidate)
   */
  private forwardSignaling(message: SignalingMessage): void {
    const success = discoveryService.sendToPeer(message.to, message);
    if (!success) {
      logger.warn('Failed to forward signaling message', {
        type: message.type,
        from: message.from,
        to: message.to,
      });
      // Notify sender that recipient is unavailable
      discoveryService.sendToPeer(message.from, {
        type: 'error',
        code: 'PEER_UNAVAILABLE',
        message: 'The target peer is no longer available',
      });
    }
  }

  /**
   * Handle transfer request
   */
  private handleTransferRequest(message: SignalingMessage): void {
    const { to, payload } = message;
    const metadata = payload as TransferMetadata;

    // Validate metadata
    if (!metadata || !metadata.fileName || typeof metadata.fileSize !== 'number') {
      logger.warn('Invalid transfer request metadata', { from: message.from, payload });
      discoveryService.sendToPeer(message.from, {
        type: 'error',
        code: 'INVALID_REQUEST',
        message: 'Invalid transfer request metadata',
      });
      return;
    }

    const transferId = this.generateTransferId();

    // Reject if too many pending transfers
    if (this.pendingTransfers.size >= this.maxPendingTransfers) {
      logger.warn('Too many pending transfers, rejecting', { from: message.from });
      discoveryService.sendToPeer(message.from, {
        type: 'error',
        code: 'SERVER_BUSY',
        message: 'Too many pending transfers, try again later',
      });
      return;
    }

    // Create pending transfer
    const pendingTransfer: PendingTransfer = {
      id: transferId,
      fromSocketId: message.from,
      toSocketId: to,
      metadata,
      createdAt: new Date(),
      status: 'pending',
    };

    this.pendingTransfers.set(transferId, pendingTransfer);

    // Get sender info
    const sender = discoveryService.getPeer(message.from);

    // Forward request to recipient
    const success = discoveryService.sendToPeer(to, {
      type: 'transfer-request',
      transferId,
      from: message.from,
      fromPeer: sender
        ? {
            socketId: sender.socketId,
            deviceName: sender.deviceName,
          }
        : null,
      metadata,
      expiresAt: new Date(Date.now() + this.requestTimeout).toISOString(),
    });

    if (!success) {
      logger.warn('Failed to send transfer request', {
        transferId,
        from: message.from,
        to,
      });
      this.pendingTransfers.delete(transferId);
      discoveryService.sendToPeer(message.from, {
        type: 'error',
        code: 'PEER_UNAVAILABLE',
        message: 'The target peer is no longer available',
      });
      return;
    }

    // Set timeout for request expiration
    setTimeout(() => {
      const transfer = this.pendingTransfers.get(transferId);
      if (transfer && transfer.status === 'pending') {
        transfer.status = 'expired';
        this.pendingTransfers.delete(transferId);

        // Notify both parties
        discoveryService.sendToPeer(message.from, {
          type: 'transfer-expired',
          transferId,
        });
        discoveryService.sendToPeer(to, {
          type: 'transfer-expired',
          transferId,
        });

        logger.info('Transfer request expired', { transferId });
      }
    }, this.requestTimeout);

    logger.info('Transfer request created', {
      transferId,
      from: message.from,
      to,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
    });
  }

  /**
   * Handle transfer acceptance
   */
  private handleTransferAccept(message: SignalingMessage): void {
    const { from, to, payload } = message;
    const { transferId } = (payload || {}) as { transferId?: string };

    if (!transferId) {
      logger.warn('Transfer accept without transfer ID', { from, to });
      return;
    }

    const transfer = this.pendingTransfers.get(transferId);
    if (!transfer) {
      logger.warn('Transfer not found for acceptance', { transferId });
      discoveryService.sendToPeer(from, {
        type: 'error',
        code: 'TRANSFER_NOT_FOUND',
        message: 'Transfer request not found or expired',
      });
      return;
    }

    // Verify the accept is from the correct recipient
    if (transfer.toSocketId !== from) {
      logger.warn('Transfer accept from wrong peer', {
        transferId,
        expectedFrom: transfer.toSocketId,
        actualFrom: from,
      });
      return;
    }

    // Verify the transfer is still pending
    if (transfer.status !== 'pending') {
      logger.warn('Transfer accept for non-pending transfer', {
        transferId,
        status: transfer.status,
      });
      discoveryService.sendToPeer(from, {
        type: 'error',
        code: 'TRANSFER_NOT_PENDING',
        message: `Transfer is ${transfer.status}`,
      });
      return;
    }

    // Update transfer status
    transfer.status = 'accepted';

    // Update peer statuses
    discoveryService.updatePeerStatus(transfer.fromSocketId, 'transferring');
    discoveryService.updatePeerStatus(transfer.toSocketId, 'transferring');

    // Notify sender that transfer was accepted (single message with proper fields)
    discoveryService.sendToPeer(transfer.fromSocketId, {
      type: 'transfer-accepted',
      transferId,
      from: from,
      to: transfer.fromSocketId,
    });

    logger.info('Transfer accepted', { transferId, from, to: transfer.fromSocketId });
  }

  /**
   * Handle transfer rejection
   */
  private handleTransferReject(message: SignalingMessage): void {
    const { from, to, payload } = message;
    const { transferId } = (payload || {}) as { transferId?: string };

    if (!transferId) {
      logger.warn('Transfer reject without transfer ID', { from, to });
      return;
    }

    const transfer = this.pendingTransfers.get(transferId);
    if (!transfer) {
      logger.warn('Transfer not found for rejection', { transferId });
      return;
    }

    // Verify the reject is from the correct recipient
    if (transfer.toSocketId !== from) {
      logger.warn('Transfer reject from wrong peer', {
        transferId,
        expectedFrom: transfer.toSocketId,
        actualFrom: from,
      });
      return;
    }

    // Update transfer status
    transfer.status = 'rejected';
    this.pendingTransfers.delete(transferId);

    // Notify sender that transfer was rejected
    discoveryService.sendToPeer(transfer.fromSocketId, {
      type: 'transfer-rejected',
      transferId,
      from,
    });

    logger.info('Transfer rejected', { transferId, from, to: transfer.fromSocketId });
  }

  /**
   * Mark transfer as completed (called when file transfer finishes)
   */
  completeTransfer(transferId: string): void {
    const transfer = this.pendingTransfers.get(transferId);
    if (transfer) {
      this.pendingTransfers.delete(transferId);

      // Reset peer statuses
      discoveryService.updatePeerStatus(transfer.fromSocketId, 'available');
      discoveryService.updatePeerStatus(transfer.toSocketId, 'available');

      logger.info('Transfer completed', { transferId });
    }
  }

  /**
   * Get pending transfer by ID
   */
  getPendingTransfer(transferId: string): PendingTransfer | undefined {
    return this.pendingTransfers.get(transferId);
  }

  /**
   * Set request timeout
   */
  setRequestTimeout(timeoutMs: number): void {
    this.requestTimeout = timeoutMs;
  }
}

export const signalingService = new SignalingService();
