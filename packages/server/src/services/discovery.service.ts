import WebSocket from 'ws';
import { logger } from './logger.service.js';

export interface PeerInfo {
  socketId: string;
  ipAddress: string;
  deviceName: string;
  joinedAt: Date;
  status: 'available' | 'transferring';
}

class DiscoveryService {
  private peers: Map<string, PeerInfo> = new Map();
  private connections: Map<string, WebSocket> = new Map();

  private generateSocketId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  }

  addPeer(ip: string, deviceName: string, ws: WebSocket): string {
    const socketId = this.generateSocketId();

    const peer: PeerInfo = {
      socketId,
      ipAddress: ip,
      deviceName: deviceName || 'Unknown Device',
      joinedAt: new Date(),
      status: 'available',
    };

    this.peers.set(socketId, peer);
    this.connections.set(socketId, ws);

    logger.info('Peer joined', { socketId, ip, deviceName });

    return socketId;
  }

  removePeer(socketId: string): void {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    this.peers.delete(socketId);
    this.connections.delete(socketId);

    logger.info('Peer left', { socketId, ip: peer.ipAddress });
  }

  getPeer(socketId: string): PeerInfo | undefined {
    return this.peers.get(socketId);
  }

  getConnection(socketId: string): WebSocket | undefined {
    return this.connections.get(socketId);
  }

  updatePeerStatus(socketId: string, status: 'available' | 'transferring'): void {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.status = status;
    }
  }

  sendToPeer(socketId: string, message: object): boolean {
    const ws = this.connections.get(socketId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  getPeerCount(): number {
    return this.peers.size;
  }
}

export const discoveryService = new DiscoveryService();
