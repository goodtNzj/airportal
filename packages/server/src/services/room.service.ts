import crypto from 'crypto';
import { logger } from './logger.service.js';
import { discoveryService, type PeerInfo } from './discovery.service.js';

export interface Room {
  id: string;
  name?: string;
  createdAt: Date;
  createdBy: string;
  peers: Set<string>; // socketIds
  expirySeconds: number;
}

class RoomService {
  private rooms: Map<string, Room> = new Map();
  private peerRooms: Map<string, string> = new Map(); // socketId -> roomId

  /**
   * Generate a short room code (4 characters, easy to share)
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars: 0O1I
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[crypto.randomInt(chars.length)];
    }
    return code;
  }

  /**
   * Create a new room
   */
  createRoom(creatorSocketId: string, name?: string, expirySeconds: number = 1800): Room {
    // Leave existing room first
    this.leaveRoom(creatorSocketId);

    // Generate unique room ID
    let roomId = this.generateRoomCode();
    while (this.rooms.has(roomId)) {
      roomId = this.generateRoomCode();
    }

    const room: Room = {
      id: roomId,
      name,
      createdAt: new Date(),
      createdBy: creatorSocketId,
      peers: new Set([creatorSocketId]),
      expirySeconds: Math.max(60, Math.min(expirySeconds, 86400)),
    };

    this.rooms.set(roomId, room);
    this.peerRooms.set(creatorSocketId, roomId);

    logger.info('Room created', { roomId, creatorSocketId, name });

    // Set expiry timeout
    this.setRoomExpiry(roomId);

    return room;
  }

  /**
   * Join an existing room
   */
  joinRoom(socketId: string, roomId: string): { success: boolean; room?: Room; error?: string } {
    // Leave existing room first
    this.leaveRoom(socketId);

    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    room.peers.add(socketId);
    this.peerRooms.set(socketId, roomId.toUpperCase());

    logger.info('Peer joined room', { socketId, roomId });

    // Notify other peers in the room
    this.broadcastRoomUpdate(roomId.toUpperCase(), socketId);

    // Notify about new peer joining
    const peer = discoveryService.getPeer(socketId);
    if (peer) {
      for (const peerId of room.peers) {
        if (peerId !== socketId) {
          discoveryService.sendToPeer(peerId, {
            type: 'room-peer-joined',
            roomId: room.id,
            peer: {
              socketId: peer.socketId,
              deviceName: peer.deviceName,
              status: peer.status,
            },
          });
        }
      }
    }

    return { success: true, room };
  }

  /**
   * Leave current room
   */
  leaveRoom(socketId: string): void {
    const roomId = this.peerRooms.get(socketId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      room.peers.delete(socketId);

      // Notify other peers
      for (const peerId of room.peers) {
        discoveryService.sendToPeer(peerId, {
          type: 'room-peer-left',
          roomId,
          socketId,
        });
      }

      // Delete room if empty
      if (room.peers.size === 0) {
        this.rooms.delete(roomId);
        logger.info('Room deleted (empty)', { roomId });
      }
    }

    this.peerRooms.delete(socketId);
    logger.info('Peer left room', { socketId, roomId });
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  /**
   * Get room that a peer is in
   */
  getPeerRoom(socketId: string): Room | undefined {
    const roomId = this.peerRooms.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  /**
   * Get all peers in the same room as a peer
   */
  getRoomPeers(socketId: string): PeerInfo[] {
    const room = this.getPeerRoom(socketId);
    if (!room) return [];

    const peers: PeerInfo[] = [];
    for (const peerId of room.peers) {
      if (peerId !== socketId) {
        const peer = discoveryService.getPeer(peerId);
        if (peer) {
          peers.push(peer);
        }
      }
    }

    return peers;
  }

  /**
   * Check if two peers are in the same room
   */
  areInSameRoom(socketId1: string, socketId2: string): boolean {
    const room1 = this.peerRooms.get(socketId1);
    const room2 = this.peerRooms.get(socketId2);
    return room1 !== undefined && room1 === room2;
  }

  /**
   * Broadcast room update to all peers in room
   */
  private broadcastRoomUpdate(roomId: string, excludeSocketId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const peerList: Array<{ socketId: string; deviceName: string; status: string }> = [];
    for (const peerId of room.peers) {
      const peer = discoveryService.getPeer(peerId);
      if (peer) {
        peerList.push({
          socketId: peer.socketId,
          deviceName: peer.deviceName,
          status: peer.status,
        });
      }
    }

    for (const peerId of room.peers) {
      if (peerId === excludeSocketId) continue;

      const filteredList = peerList.filter((p) => p.socketId !== peerId);
      discoveryService.sendToPeer(peerId, {
        type: 'room-peer-list',
        roomId,
        peers: filteredList,
      });
    }
  }

  /**
   * Set room expiry timeout
   */
  private setRoomExpiry(roomId: string): void {
    const room = this.rooms.get(roomId);
    const timeoutMs = (room?.expirySeconds ?? 1800) * 1000;
    setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (room) {
        for (const peerId of room.peers) {
          discoveryService.sendToPeer(peerId, {
            type: 'room-expired',
            roomId,
          });
          this.peerRooms.delete(peerId);
        }
        this.rooms.delete(roomId);
        logger.info('Room expired', { roomId });
      }
    }, timeoutMs);
  }

  /**
   * Get room count
   */
  getRoomCount(): number {
    return this.rooms.size;
  }
}

export const roomService = new RoomService();
