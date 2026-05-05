import type {
  FileMetadata,
  WSMessage,
  WSInitMessage,
  WSRoomCreatedMessage,
  WSRoomJoinedMessage,
  DCFileStart,
  DCFileEnd,
  RoomInfo,
  PeerInfo,
} from '../types/p2p';

type MessageHandler = (message: WSMessage) => void;
type ProgressHandler = (transferId: string, progress: number) => void;

const CHUNK_SIZE = 16384; // 16KB - safe for WebRTC DataChannel

class P2PService {
  private ws: WebSocket | null = null;
  private socketId: string | null = null;
  private currentRoom: RoomInfo | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private progressHandlers: Set<ProgressHandler> = new Set();

  // File receiving state
  private receivingFiles: Map<
    string,
    {
      metadata: DCFileStart;
      chunks: ArrayBuffer[];
      receivedChunks: number;
    }
  > = new Map();

  /**
   * Connect to signaling server (idempotent)
   */
  connect(url?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Already connected — nothing to do
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // Currently connecting — wait for its open/error instead of opening a
      // second WebSocket (React StrictMode mounts effects twice in dev).
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        const existing = this.ws;
        const onOpen = () => {
          existing.removeEventListener('open', onOpen);
          existing.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e: Event) => {
          existing.removeEventListener('open', onOpen);
          existing.removeEventListener('error', onError);
          reject(e);
        };
        existing.addEventListener('open', onOpen);
        existing.addEventListener('error', onError);
        return;
      }

      const wsUrl = url || this.getWebSocketUrl();

      // Close any stale CLOSING/CLOSED socket before creating a new one
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.onerror = null;
        try {
          this.ws.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[P2P] WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WSMessage;
          this.handleMessage(message);
        } catch (error) {
          console.error('[P2P] Failed to parse message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[P2P] WebSocket closed');
        this.socketId = null;
        this.ws = null;
      };

      this.ws.onerror = (error) => {
        console.error('[P2P] WebSocket error:', error);
        reject(error);
      };
    });
  }

  /**
   * Get WebSocket URL based on current location
   */
  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/p2p/ws`;
  }

  /**
   * Disconnect from signaling server.
   * Typically NOT called from React effect cleanups — the service is a
   * page-wide singleton. This is reserved for full teardown (e.g. logout
   * or window unload).
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    // Close all peer connections
    for (const [, pc] of this.peerConnections) {
      pc.close();
    }
    this.peerConnections.clear();

    // Clear all data channels
    for (const [, dc] of this.dataChannels) {
      dc.close();
    }
    this.dataChannels.clear();

    this.socketId = null;
    // NOTE: don't clear messageHandlers/progressHandlers here — components
    // that re-mount expect their handlers registered via onMessage/onProgress
    // to persist. They are unregistered by the unsubscribe fn returned.
  }

  /**
   * Add message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Add progress handler
   */
  onProgress(handler: ProgressHandler): () => void {
    this.progressHandlers.add(handler);
    return () => this.progressHandlers.delete(handler);
  }

  /**
   * Get current socket ID
   */
  getSocketId(): string | null {
    return this.socketId;
  }

  /**
   * Get current room info
   */
  getRoom(): RoomInfo | null {
    return this.currentRoom;
  }

  /**
   * Create a new room
   */
  createRoom(name?: string): Promise<RoomInfo> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Create room timeout'));
      }, 10000);

      const handler = (message: WSMessage) => {
        if (message.type === 'room-created') {
          clearTimeout(timeout);
          this.messageHandlers.delete(handler);
          const roomMsg = message as WSRoomCreatedMessage;
          this.currentRoom = roomMsg.room;
          console.log('[P2P] Room created:', roomMsg.room.id);
          resolve(roomMsg.room);
        } else if (message.type === 'room-error') {
          clearTimeout(timeout);
          this.messageHandlers.delete(handler);
          reject(new Error((message as unknown as { message: string }).message));
        }
      };

      this.messageHandlers.add(handler);
      this.send({ type: 'create-room', name });
    });
  }

  /**
   * Join an existing room
   */
  joinRoom(roomId: string): Promise<{ room: RoomInfo; peers: PeerInfo[] }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join room timeout'));
      }, 10000);

      const handler = (message: WSMessage) => {
        if (message.type === 'room-joined') {
          clearTimeout(timeout);
          this.messageHandlers.delete(handler);
          const roomMsg = message as WSRoomJoinedMessage;
          this.currentRoom = roomMsg.room;
          console.log('[P2P] Joined room:', roomMsg.room.id, 'with', roomMsg.peers.length, 'peers');
          resolve({ room: roomMsg.room, peers: roomMsg.peers });
        } else if (message.type === 'room-error') {
          clearTimeout(timeout);
          this.messageHandlers.delete(handler);
          reject(new Error((message as unknown as { message: string }).message));
        }
      };

      this.messageHandlers.add(handler);
      this.send({ type: 'join-room', roomId });
    });
  }

  /**
   * Leave current room
   */
  leaveRoom(): Promise<void> {
    return new Promise((resolve) => {
      const handler = (message: WSMessage) => {
        if (message.type === 'room-left') {
          this.messageHandlers.delete(handler);
          this.currentRoom = null;
          console.log('[P2P] Left room');
          resolve();
        }
      };

      this.messageHandlers.add(handler);
      this.send({ type: 'leave-room' });
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case 'init':
        const initMsg = message as WSInitMessage;
        this.socketId = initMsg.socketId;
        if (initMsg.room) {
          this.currentRoom = initMsg.room;
        }
        console.log('[P2P] Initialized with socket ID:', this.socketId);
        break;

      case 'peer-list':
        // Peer list updated (subnet peers)
        break;

      case 'room-peer-list':
      case 'room-peer-joined':
      case 'room-peer-left':
      case 'room-expired':
        // Room peer updates - handled by useP2P hook
        break;

      case 'offer':
        this.handleOffer(message as unknown as { from: string; payload: RTCSessionDescriptionInit });
        break;

      case 'answer':
        this.handleAnswer(message as unknown as { from: string; payload: RTCSessionDescriptionInit });
        break;

      case 'ice-candidate':
        this.handleIceCandidate(message as unknown as { from: string; payload: RTCIceCandidateInit });
        break;

      case 'transfer-accepted':
        console.log('[P2P] Transfer accepted');
        break;

      case 'transfer-rejected':
        console.log('[P2P] Transfer rejected');
        break;

      case 'error':
        console.error('[P2P] Server error:', message);
        break;
    }

    // Notify all handlers
    this.messageHandlers.forEach((handler) => handler(message));
  }

  /**
   * Send message to signaling server
   */
  private send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('[P2P] WebSocket not connected');
    }
  }

  /**
   * Create WebRTC peer connection
   */
  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [], // No STUN/TURN needed for local network
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: 'ice-candidate',
          from: this.socketId,
          to: peerId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[P2P] Connection state for ${peerId}:`, pc.connectionState);
    };

    pc.ondatachannel = (event) => {
      console.log(`[P2P] Received data channel from ${peerId}`);
      const channel = event.channel;
      this.setupDataChannel(channel, peerId);
      this.dataChannels.set(peerId, channel);
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  /**
   * Setup data channel event handlers
   */
  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log(`[P2P] Data channel opened with ${peerId}`);
    };

    channel.onclose = () => {
      console.log(`[P2P] Data channel closed with ${peerId}`);
    };

    channel.onerror = (error) => {
      console.error(`[P2P] Data channel error with ${peerId}:`, error);
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data, peerId);
    };
  }

  /**
   * Handle data channel message (file chunks)
   */
  private handleDataChannelMessage(
    data: ArrayBuffer | string,
    _peerId: string
  ): void {
    if (typeof data === 'string') {
      // JSON message
      try {
        const message = JSON.parse(data);

        if (message.type === 'file-start') {
          const fileStart = message as DCFileStart;
          this.receivingFiles.set(message.transferId, {
            metadata: fileStart,
            chunks: new Array(fileStart.totalChunks),
            receivedChunks: 0,
          });
          console.log(`[P2P] Starting to receive file: ${fileStart.fileName}`);
        } else if (message.type === 'file-end') {
          this.completeFileReceive(message.transferId);
        } else if (message.type === 'file-error') {
          console.error(`[P2P] File transfer error:`, message.error);
          this.receivingFiles.delete(message.transferId);
        }
      } catch (error) {
        console.error('[P2P] Failed to parse DataChannel message:', error);
      }
    } else {
      // Binary chunk
      // Find the receiving file for this peer
      for (const [transferId, receiving] of this.receivingFiles) {
        if (receiving.chunks[receiving.receivedChunks] === undefined) {
          receiving.chunks[receiving.receivedChunks] = data;
          receiving.receivedChunks++;

          // Report progress
          const progress = (receiving.receivedChunks / receiving.metadata.totalChunks) * 100;
          this.progressHandlers.forEach((handler) => handler(transferId, progress));

          // Check if complete (will be handled by file-end message)
          break;
        }
      }
    }
  }

  /**
   * Complete file receive and trigger download
   */
  private completeFileReceive(transferId: string): void {
    const receiving = this.receivingFiles.get(transferId);
    if (!receiving) {
      console.error(`[P2P] No receiving file found for transfer ${transferId}`);
      return;
    }

    const { metadata, chunks } = receiving;

    // Combine chunks into blob
    const blob = new Blob(chunks, { type: metadata.mimeType });

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = metadata.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[P2P] File received and downloaded: ${metadata.fileName}`);

    // Cleanup
    this.receivingFiles.delete(transferId);
  }

  /**
   * Initiate transfer request to a peer
   */
  async initiateTransfer(peerId: string, file: File): Promise<string> {
    const metadata: FileMetadata = {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
    };

    this.send({
      type: 'transfer-request',
      from: this.socketId,
      to: peerId,
      payload: metadata,
    });

    // Return a promise that resolves when accepted
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transfer request timeout'));
      }, 60000);

      const handler = (message: WSMessage) => {
        if (message.type === 'transfer-accepted') {
          clearTimeout(timeout);
          this.messageHandlers.delete(handler);

          // Create WebRTC connection and start transfer
          this.startTransfer(peerId, file).then(resolve).catch(reject);
        } else if (message.type === 'transfer-rejected') {
          clearTimeout(timeout);
          this.messageHandlers.delete(handler);
          reject(new Error('Transfer rejected'));
        }
      };

      this.messageHandlers.add(handler);
    });
  }

  /**
   * Start WebRTC connection and file transfer
   */
  private async startTransfer(peerId: string, file: File): Promise<string> {
    const pc = this.createPeerConnection(peerId);

    // Create data channel
    const channel = pc.createDataChannel('file-transfer', {
      ordered: true,
    });
    this.setupDataChannel(channel, peerId);
    this.dataChannels.set(peerId, channel);

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.send({
      type: 'offer',
      from: this.socketId,
      to: peerId,
      payload: offer,
    });

    // Wait for data channel to open, then send file
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 30000);

      channel.onopen = async () => {
        clearTimeout(timeout);

        try {
          const transferId = await this.sendFile(channel, file, peerId);
          resolve(transferId);
        } catch (error) {
          reject(error);
        }
      };

      channel.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  /**
   * Send file through data channel
   */
  private async sendFile(
    channel: RTCDataChannel,
    file: File,
    _peerId: string
  ): Promise<string> {
    const transferId = `transfer-${Date.now()}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Send file metadata
    const fileStart: DCFileStart = {
      type: 'file-start',
      transferId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
    };
    channel.send(JSON.stringify(fileStart));

    // Send chunks with backpressure control
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = await file.slice(start, end).arrayBuffer();

      // Wait for buffer to be ready (backpressure)
      while (channel.bufferedAmount > 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      channel.send(chunk);

      // Report progress
      const progress = ((i + 1) / totalChunks) * 100;
      this.progressHandlers.forEach((handler) => handler(transferId, progress));
    }

    // Send completion message
    const fileEnd: DCFileEnd = {
      type: 'file-end',
      transferId,
    };
    channel.send(JSON.stringify(fileEnd));

    console.log(`[P2P] File sent: ${file.name}`);

    return transferId;
  }

  /**
   * Handle incoming offer (receiver side)
   */
  private async handleOffer(message: {
    from: string;
    payload: RTCSessionDescriptionInit;
  }): Promise<void> {
    const peerId = message.from;
    const pc = this.createPeerConnection(peerId);

    await pc.setRemoteDescription(new RTCSessionDescription(message.payload));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.send({
      type: 'answer',
      from: this.socketId,
      to: peerId,
      payload: answer,
    });
  }

  /**
   * Handle incoming answer (sender side)
   */
  private async handleAnswer(message: {
    from: string;
    payload: RTCSessionDescriptionInit;
  }): Promise<void> {
    const peerId = message.from;
    const pc = this.peerConnections.get(peerId);

    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
    }
  }

  /**
   * Handle incoming ICE candidate
   */
  private async handleIceCandidate(message: {
    from: string;
    payload: RTCIceCandidateInit;
  }): Promise<void> {
    const peerId = message.from;
    const pc = this.peerConnections.get(peerId);

    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(message.payload));
    }
  }

  /**
   * Accept incoming transfer request
   */
  acceptTransfer(transferId: string, fromPeerId: string): void {
    this.send({
      type: 'transfer-accept',
      from: this.socketId,
      to: fromPeerId,
      payload: { transferId },
    });
  }

  /**
   * Reject incoming transfer request
   */
  rejectTransfer(transferId: string, fromPeerId: string): void {
    this.send({
      type: 'transfer-reject',
      from: this.socketId,
      to: fromPeerId,
      payload: { transferId },
    });
  }
}


export const p2pService = new P2PService();
