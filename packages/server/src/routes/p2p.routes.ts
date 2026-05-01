import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { discoveryService } from '../services/discovery.service.js';
import { signalingService } from '../services/signaling.service.js';
import { logger } from '../services/logger.service.js';

interface WebSocketQuery {
  deviceName?: string;
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
      const ip = req.ip;
      const deviceName = getDeviceName(req);

      // Register peer
      const socketId = discoveryService.addPeer(ip, deviceName, socket);

      // Send initial peer list
      const peers = discoveryService.getLocalPeers(socketId);
      socket.send(
        JSON.stringify({
          type: 'init',
          socketId,
          peers: peers.map((p) => ({
            socketId: p.socketId,
            deviceName: p.deviceName,
            status: p.status,
          })),
        })
      );

      logger.info('WebSocket connection established', { socketId, ip, deviceName });

      // Handle incoming messages
      socket.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
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
        discoveryService.removePeer(socketId);
      });
    }
  );

  // REST endpoint to check P2P status
  app.get('/status', async (_request, reply) => {
    return reply.send({
      enabled: true,
      peerCount: discoveryService.getPeerCount(),
    });
  });
}
