import { useState, useEffect, useCallback } from 'react';
import { p2pService } from '../services/p2p.service';
import type {
  PeerInfo,
  RoomInfo,
  TransferProgress,
  PendingTransfer,
  WSMessage,
  WSPeerListMessage,
  WSRoomPeerListMessage,
  WSRoomPeerJoinedMessage,
  WSRoomPeerLeftMessage,
  WSTransferRequestMessage,
} from '../types/p2p';

interface UseP2PReturn {
  isConnected: boolean;
  socketId: string | null;
  peers: PeerInfo[];
  roomPeers: PeerInfo[];
  room: RoomInfo | null;
  transfers: TransferProgress[];
  pendingRequests: PendingTransfer[];
  sendFile: (peerId: string, file: File) => Promise<string>;
  acceptTransfer: (transferId: string, fromPeerId: string) => void;
  rejectTransfer: (transferId: string, fromPeerId: string) => void;
  createRoom: (name?: string) => Promise<RoomInfo>;
  joinRoom: (roomId: string) => Promise<{ room: RoomInfo; peers: PeerInfo[] }>;
  leaveRoom: () => Promise<void>;
}

export function useP2P(): UseP2PReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [roomPeers, setRoomPeers] = useState<PeerInfo[]>([]);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingTransfer[]>([]);

  useEffect(() => {
    // Register handlers first so the `init` broadcast isn't missed when
    // connect() resolves after the initial message has already arrived.
    const unsubMessage = p2pService.onMessage((message: WSMessage) => {
      switch (message.type) {
        case 'init':
          setSocketId(p2pService.getSocketId());
          setIsConnected(true);
          break;
        case 'peer-list':
          setPeers((message as WSPeerListMessage).peers);
          break;
        case 'room-peer-list': {
          const roomMsg = message as WSRoomPeerListMessage;
          setRoomPeers(roomMsg.peers);
          break;
        }
        case 'room-peer-joined': {
          const joinMsg = message as WSRoomPeerJoinedMessage;
          setRoomPeers((prev) => [...prev, joinMsg.peer]);
          break;
        }
        case 'room-peer-left': {
          const leftMsg = message as WSRoomPeerLeftMessage;
          setRoomPeers((prev) => prev.filter((p) => p.socketId !== leftMsg.socketId));
          break;
        }
        case 'room-expired':
          setRoom(null);
          setRoomPeers([]);
          break;
        case 'transfer-request': {
          const req = message as WSTransferRequestMessage;
          setPendingRequests((prev) => [
            ...prev,
            {
              id: req.transferId,
              fromPeer: req.fromPeer,
              fileName: req.metadata.fileName,
              fileSize: req.metadata.fileSize,
              fileType: req.metadata.fileType,
              expiresAt: new Date(req.expiresAt),
            },
          ]);
          break;
        }
        case 'transfer-expired':
          setPendingRequests((prev) =>
            prev.filter((r) => r.id !== (message as unknown as { transferId: string }).transferId)
          );
          break;
      }
    });

    const unsubProgress = p2pService.onProgress((transferId: string, progress: number) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? {
                ...t,
                bytesTransferred: Math.floor((progress / 100) * t.fileSize),
                percentage: progress,
                status: progress >= 100 ? ('completed' as const) : ('transferring' as const),
              }
            : t
        )
      );
    });

    // connect() is idempotent; safe under React 18 StrictMode double-invoke.
    p2pService
      .connect()
      .then(() => setIsConnected(true))
      .catch((err) => console.error('[useP2P] Connection error:', err));

    // Only unregister handlers on unmount. The underlying singleton WebSocket
    // stays alive so re-mounting the page doesn't rebuild state.
    return () => {
      unsubMessage();
      unsubProgress();
    };
  }, []);

  const sendFile = async (peerId: string, file: File): Promise<string> => {
    const allPeers = [...peers, ...roomPeers];
    const peerName = allPeers.find((p) => p.socketId === peerId)?.deviceName || 'Unknown';
    const placeholderId = `pending-${Date.now()}`;

    // Show the transfer immediately so the user sees "connecting" state.
    setTransfers((prev) => [
      ...prev,
      {
        id: placeholderId,
        peerId,
        peerName,
        direction: 'sending',
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: 0,
        percentage: 0,
        status: 'connecting',
      },
    ]);

    try {
      const transferId = await p2pService.initiateTransfer(peerId, file);
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === placeholderId ? { ...t, id: transferId, status: 'completed', percentage: 100, bytesTransferred: file.size } : t
        )
      );
      return transferId;
    } catch (err) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === placeholderId
            ? { ...t, status: 'failed', error: err instanceof Error ? err.message : String(err) }
            : t
        )
      );
      throw err;
    }
  };

  const acceptTransfer = (transferId: string, fromPeerId: string) => {
    p2pService.acceptTransfer(transferId, fromPeerId);
    setPendingRequests((prev) => prev.filter((r) => r.id !== transferId));
  };

  const rejectTransfer = (transferId: string, fromPeerId: string) => {
    p2pService.rejectTransfer(transferId, fromPeerId);
    setPendingRequests((prev) => prev.filter((r) => r.id !== transferId));
  };

  const createRoom = useCallback(async (name?: string) => {
    const roomInfo = await p2pService.createRoom(name);
    setRoom(roomInfo);
    return roomInfo;
  }, []);

  const joinRoom = useCallback(async (roomId: string) => {
    const result = await p2pService.joinRoom(roomId);
    setRoom(result.room);
    setRoomPeers(result.peers);
    return result;
  }, []);

  const leaveRoom = useCallback(async () => {
    await p2pService.leaveRoom();
    setRoom(null);
    setRoomPeers([]);
  }, []);

  return {
    isConnected,
    socketId,
    peers,
    roomPeers,
    room,
    transfers,
    pendingRequests,
    sendFile,
    acceptTransfer,
    rejectTransfer,
    createRoom,
    joinRoom,
    leaveRoom,
  };
}
