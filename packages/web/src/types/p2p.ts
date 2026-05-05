// P2P Types for Frontend

export interface PeerInfo {
  socketId: string;
  deviceName: string;
  status: 'available' | 'transferring';
  source?: 'subnet' | 'room';
}

export interface RoomInfo {
  id: string;
  name?: string;
}

export interface TransferProgress {
  id: string;
  peerId: string;
  peerName: string;
  direction: 'sending' | 'receiving';
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  percentage: number;
  status: 'connecting' | 'transferring' | 'completed' | 'failed';
  error?: string;
}

export interface PendingTransfer {
  id: string;
  fromPeer: PeerInfo | null;
  fileName: string;
  fileSize: number;
  fileType: string;
  expiresAt: Date;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
}

// WebSocket message types
export type WSMessageType =
  | 'init'
  | 'peer-list'
  | 'room-created'
  | 'room-joined'
  | 'room-left'
  | 'room-error'
  | 'room-peer-list'
  | 'room-peer-joined'
  | 'room-peer-left'
  | 'room-expired'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'transfer-request'
  | 'transfer-accepted'
  | 'transfer-rejected'
  | 'transfer-expired'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  [key: string]: unknown;
}

export interface WSInitMessage extends WSMessage {
  type: 'init';
  socketId: string;
  peers: PeerInfo[];
  room?: RoomInfo;
  roomPeers?: PeerInfo[];
}

export interface WSRoomCreatedMessage extends WSMessage {
  type: 'room-created';
  room: RoomInfo;
}

export interface WSRoomJoinedMessage extends WSMessage {
  type: 'room-joined';
  room: RoomInfo;
  peers: PeerInfo[];
}

export interface WSRoomPeerListMessage extends WSMessage {
  type: 'room-peer-list';
  roomId: string;
  peers: PeerInfo[];
}

export interface WSRoomPeerJoinedMessage extends WSMessage {
  type: 'room-peer-joined';
  roomId: string;
  peer: PeerInfo;
}

export interface WSRoomPeerLeftMessage extends WSMessage {
  type: 'room-peer-left';
  roomId: string;
  socketId: string;
}

export interface WSPeerListMessage extends WSMessage {
  type: 'peer-list';
  peers: PeerInfo[];
}

export interface WSTransferRequestMessage extends WSMessage {
  type: 'transfer-request';
  transferId: string;
  from: string;
  fromPeer: PeerInfo | null;
  metadata: FileMetadata;
  expiresAt: string;
}

export interface WSErrorMessage extends WSMessage {
  type: 'error';
  code: string;
  message: string;
}

// DataChannel message types
export interface DCFileStart {
  type: 'file-start';
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
}

export interface DCFileEnd {
  type: 'file-end';
  transferId: string;
}

export interface DCFileError {
  type: 'file-error';
  transferId: string;
  error: string;
}
