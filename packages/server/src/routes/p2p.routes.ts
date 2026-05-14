/// <reference types="@fastify/websocket" />
import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { discoveryService } from '../services/discovery.service.js';
import { signalingService } from '../services/signaling.service.js';
import { roomService } from '../services/room.service.js';
import { logger } from '../services/logger.service.js';
import { ipBlacklistService } from '../services/ip-blacklist.service.js';
import { authService } from '../services/auth.service.js';
import { getConfig } from '../config/index.js';

interface WebSocketQuery {
  deviceName?: string;
  roomId?: string;
  token?: string;
}

/**
 * Extract device name from User-Agent or use query parameter
 */
function getDeviceName(req: FastifyRequest): string {
  const query = req.query as WebSocketQuery;
  if (query.deviceName) {
    return query.deviceName.substring(0, 50); // Limit length
  }

  // Parse User-Agent for a friendly name
  const ua = req.headers['user-agent'] || 'Unknown';

  // Simple user agent parsing
  if (ua.includes('Chrome') && ua.includes('Android')) {
    return 'Android Chrome';
  }
  if (ua.includes('Chrome')) {
    const match = ua.match(/Chrome\/(\d+)/);
    return match ? `Chrome ${match[1]}` : 'Chrome';
  }
  if (ua.includes('Firefox')) {
    const match = ua.match(/Firefox\/(\d+)/);
    return match ? `Firefox ${match[1]}` : 'Firefox';
  }
  if (ua.includes('Safari') && !ua.includes('Chrome')) {
    const match = ua.match(/Version\/(\d+)/);
    return match ? `Safari ${match[1]}` : 'Safari';
  }
  if (ua.includes('Edge')) {
    const match = ua.match(/Edge\/(\d+)/);
    return match ? `Edge ${match[1]}` : 'Edge';
  }

  return 'Unknown Device';
}

export async function p2pRoutes(app: FastifyInstance) {
  // Register WebSocket support
  await app.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB max message size
      clientTracking: false, // We handle our own tracking
    },
  });

  // WebSocket endpoint for signaling and presence
  app.get<{ Querystring: WebSocketQuery }>(
    '/ws',
    { websocket: true },
    (socket: WebSocket, req) => {
      const config = getConfig();
      const ip = req.ip;

      if (config.security.ipBlacklist.enabled && ipBlacklistService.isBlocked(ip)) {
        logger.warn('Blocked IP attempted P2P WebSocket connection', { ip });
        socket.close(4001, 'Access denied');
        return;
      }

      // Origin 校验 — 浏览器 WS 连接必带 Origin，缺失则拒绝
      const origin = req.headers.origin;
      if (!origin) {
        logger.warn('P2P WebSocket rejected: missing Origin', { ip });
        socket.close(4001, 'Origin required');
        return;
      }

      const allowedOrigins = config.cors.origins;
      try {
        const originHost = new URL(origin).host;
        const requestHost = req.headers.host;
        const isSameOrigin = originHost === requestHost;
        const isWhitelisted = allowedOrigins.includes(origin);
        if (!isSameOrigin && !isWhitelisted) {
          logger.warn('P2P WebSocket rejected: disallowed origin', { origin, ip });
          socket.close(4001, 'Origin not allowed');
          return;
        }
      } catch {
        logger.warn('P2P WebSocket rejected: invalid origin', { origin, ip });
        socket.close(4001, 'Invalid origin');
        return;
      }

      const query = req.query as WebSocketQuery;

      // 可选的 token 认证 — 从 Cookie 或查询参数验证 JWT 有效性
      const authToken = req.cookies?.token || query.token;
      if (authToken) {
        try {
          authService.verifyToken(authToken);
        } catch {
          logger.warn('P2P WebSocket rejected: invalid token', { ip });
          socket.close(4001, 'Invalid token');
          return;
        }
      }

      // Connection limit check
      const connCheck = discoveryService.canAcceptConnection(ip);
      if (!connCheck.allowed) {
        logger.warn('P2P connection rejected', { ip, reason: connCheck.reason });
        socket.close(4003, connCheck.reason || 'Connection limit reached');
        return;
      }

      const deviceName = getDeviceName(req);

      const socketId = discoveryService.addPeer(ip, deviceName, socket);

      // Auto-join room if roomId provided in query
      let currentRoom: { id: string; name?: string } | null = null;
      if (query.roomId) {
        const result = roomService.joinRoom(socketId, query.roomId);
        if (result.success && result.room) {
          currentRoom = { id: result.room.id, name: result.room.name };
        }
      }

      // Send initial peer list (room peers only)
      const roomPeers = roomService.getRoomPeers(socketId);

      socket.send(
        JSON.stringify({
          type: 'init',
          socketId,
          room: currentRoom,
          roomPeers: roomPeers.map((p) => ({
            socketId: p.socketId,
            deviceName: p.deviceName,
            status: p.status,
            source: 'room' as const,
          })),
        })
      );

      logger.info('WebSocket connection established', { socketId, ip, deviceName, room: currentRoom?.id });

      // Handle incoming messages
      socket.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle room-related messages
          if (message.type === 'create-room') {
            const room = roomService.createRoom(socketId, message.name, message.expirySeconds);
            socket.send(JSON.stringify({
              type: 'room-created',
              room: { id: room.id, name: room.name },
            }));
            return;
          }

          if (message.type === 'join-room') {
            const result = roomService.joinRoom(socketId, message.roomId);
            if (result.success && result.room) {
              socket.send(JSON.stringify({
                type: 'room-joined',
                room: { id: result.room.id, name: result.room.name },
                peers: roomService.getRoomPeers(socketId).map((p) => ({
                  socketId: p.socketId,
                  deviceName: p.deviceName,
                  status: p.status,
                })),
              }));
            } else {
              socket.send(JSON.stringify({
                type: 'room-error',
                code: 'JOIN_FAILED',
                message: result.error || 'Failed to join room',
              }));
            }
            return;
          }

          if (message.type === 'leave-room') {
            roomService.leaveRoom(socketId);
            socket.send(JSON.stringify({ type: 'room-left' }));
            return;
          }

          // Forward other messages to signaling service
          signalingService.handleMessage(socketId, message);
        } catch (error) {
          logger.error('Failed to parse WebSocket message', {
            socketId,
            error: error instanceof Error ? error.message : String(error),
          });
          socket.send(
            JSON.stringify({
              type: 'error',
              code: 'PARSE_ERROR',
              message: 'Failed to parse message',
            })
          );
        }
      });

      // Handle connection close
      socket.on('close', (code: number, reason: Buffer) => {
        roomService.leaveRoom(socketId);
        discoveryService.removePeer(socketId);
        logger.info('WebSocket connection closed', {
          socketId,
          code,
          reason: reason.toString(),
        });
      });

      // Handle errors
      socket.on('error', (error: Error) => {
        logger.error('WebSocket error', {
          socketId,
          error: error.message,
        });
        roomService.leaveRoom(socketId);
        discoveryService.removePeer(socketId);
      });
    }
  );

  // REST endpoint to check P2P status
  app.get('/status', async (_request, reply) => {
    return reply.send({
      enabled: true,
      peerCount: discoveryService.getPeerCount(),
      roomCount: roomService.getRoomCount(),
    });
  });

  // REST endpoint to get ICE server configuration for WebRTC
  app.get('/ice-servers', async (_request, reply) => {
    const config = getConfig();
    return reply.send({
      success: true,
      data: {
        iceServers: config.p2p.iceServers,
      },
    });
  });
}
