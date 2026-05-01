import WebSocket from 'ws';
import { logger } from './logger.service.js';

export interface PeerInfo {
  socketId: string;
  ipAddress: string;
  subnet: string;
  deviceName: string;
  joinedAt: Date;
  status: 'available' | 'transferring';
}

class DiscoveryService {
  private peers: Map<string, PeerInfo> = new Map();
  private connections: Map<string, WebSocket> = new Map();

  /**
   * Extract /24 subnet from IPv4 address
   * For IPv6, returns the first 4 segments (/64 equivalent)
   */
  getSubnet(ip: string): string {
    if (ip.includes(':')) {
      // IPv6: use first 4 segments
      const segments = ip.split(':');
      return segments.slice(0, 4).join(':');
    }
    // IPv4: use first 3 octets
    const octets = ip.split('.');
    return octets.slice(0, 3).join('.');
  }

  /**
   * Generate a unique socket ID
   */
  private generateSocketId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Add a peer when WebSocket connects
   */
  addPeer(ip: string, deviceName: string, ws: WebSocket): string {
    const socketId = this.generateSocketId();
    const subnet = this.getSubnet(ip);

    const peer: PeerInfo = {
      socketId,
      ipAddress: ip,
      subnet,
      deviceName: deviceName || 'Unknown Device',
      joinedAt: new Date(),
      status: 'available',
    };

    this.peers.set(socketId, peer);
    this.connections.set(socketId, ws);

    logger.info('Peer joined', { socketId, ip, subnet, deviceName });

    // Broadcast updated peer list to all peers in the same subnet
    this.broadcastPeerUpdate(subnet);

    return socketId;
  }

  /**
   * Remove a peer when WebSocket disconnects
   */
  removePeer(socketId: string): void {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    const subnet = peer.subnet;
    this.peers.delete(socketId);
    this.connections.delete(socketId);

    logger.info('Peer left', { socketId, ip: peer.ipAddress });

    // Broadcast updated peer list to remaining peers in the same subnet
    this.broadcastPeerUpdate(subnet);
  }

  /**
   * Get all peers in the same subnet as the given socket
   */
  getLocalPeers(socketId: string): PeerInfo[] {
    const peer = this.peers.get(socketId);
    if (!peer) return [];

    const peers: PeerInfo[] = [];
    for (const [id, p] of this.peers) {
      // Exclude self and only include peers in the same subnet
      if (id !== socketId && p.subnet === peer.subnet) {
        peers.push({
          socketId: p.socketId,
          ipAddress: p.ipAddress,
          subnet: p.subnet,
          deviceName: p.deviceName,
          joinedAt: p.joinedAt,
          status: p.status,
        });
      }
    }

    return peers;
  }

  /**
   * Get peer info by socket ID
   */
  getPeer(socketId: string): PeerInfo | undefined {
    return this.peers.get(socketId);
  }

  /**
   * Get WebSocket connection by socket ID
   */
  getConnection(socketId: string): WebSocket | undefined {
    return this.connections.get(socketId);
  }

  /**
   * Update peer status
   */
  updatePeerStatus(socketId: string, status: 'available' | 'transferring'): void {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.status = status;
      this.broadcastPeerUpdate(peer.subnet);
    }
  }

  /**
   * Check if two peers are in the same subnet
   */
  areInSameSubnet(socketId1: string, socketId2: string): boolean {
    const peer1 = this.peers.get(socketId1);
    const peer2 = this.peers.get(socketId2);

    if (!peer1 || !peer2) return false;

    return peer1.subnet === peer2.subnet;
  }

  /**
   * Broadcast peer list update to all peers in a subnet
   */
  broadcastPeerUpdate(subnet: string): void {
    const message = {
      type: 'peer-list',
      peers: [] as Array<{
        socketId: string;
        deviceName: string;
        status: string;
      }>,
    };

    // Collect all peers in the subnet
    for (const [_id, peer] of this.peers) {
      if (peer.subnet === subnet) {
        message.peers.push({
          socketId: peer.socketId,
          deviceName: peer.deviceName,
          status: peer.status,
        });
      }
    }


    // Send to all peers in the subnet
    for (const [id, peer] of this.peers) {
      if (peer.subnet === subnet) {
        const ws = this.connections.get(id);
        if (ws && ws.readyState === WebSocket.OPEN) {
          // Send full peer list (excluding self for each recipient)
          const filteredMessage = {
            type: 'peer-list',
            peers: message.peers.filter((p) => p.socketId !== id),
          };
          ws.send(JSON.stringify(filteredMessage));
        }
      }
    }
  }

  /**
   * Send a message to a specific peer
   */
  sendToPeer(socketId: string, message: object): boolean {
    const ws = this.connections.get(socketId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Get total number of connected peers
   */
  getPeerCount(): number {
    return this.peers.size;
  }
}

export const discoveryService = new DiscoveryService();
