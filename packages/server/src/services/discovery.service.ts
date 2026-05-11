import WebSocket from 'ws';
import { logger } from './logger.service.js';

export interface PeerInfo {
  socketId: string;
  ipAddress: string;
  deviceName: string;
  joinedAt: Date;
  status: 'available' | 'transferring';
}

const MAX_CONNECTIONS = 200;
const MAX_CONNECTIONS_PER_IP = 5;

class DiscoveryService {
  private peers: Map<string, PeerInfo> = new Map();
  private connections: Map<string, WebSocket> = new Map();
  private ipConnectionCounts: Map<string, number> = new Map();

  private generateSocketId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  }

  canAcceptConnection(ip: string): { allowed: boolean; reason?: string } {
    if (this.peers.size >= MAX_CONNECTIONS) {
      return { allowed: false, reason: 'Server connection limit reached' };
    }
    const ipCount = this.ipConnectionCounts.get(ip) ?? 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
      return { allowed: false, reason: 'IP connection limit reached' };
    }
    return { allowed: true };
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
    this.ipConnectionCounts.set(ip, (this.ipConnectionCounts.get(ip) ?? 0) + 1);

    logger.info('Peer joined', { socketId, ip, deviceName });

    return socketId;
  }

  removePeer(socketId: string): void {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    this.peers.delete(socketId);
    this.connections.delete(socketId);

    const ipCount = this.ipConnectionCounts.get(peer.ipAddress) ?? 1;
    if (ipCount <= 1) {
      this.ipConnectionCounts.delete(peer.ipAddress);
    } else {
      this.ipConnectionCounts.set(peer.ipAddress, ipCount - 1);
    }

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
