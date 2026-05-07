import { useState, useRef } from 'react';
import { PeerCard } from '../components/PeerCard';
import { TransferRequestModal } from '../components/TransferRequestModal';
import { TransferProgressCard } from '../components/TransferProgressCard';
import { useP2P } from '../hooks/useP2P';

export function P2PPage() {
  const {
    isConnected,
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
  } = useP2P();

  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedPeer) return;

    setIsSending(true);
    try {
      await sendFile(selectedPeer, file);
    } catch (error) {
      console.error('Failed to send file:', error);
      alert(error instanceof Error ? error.message : '发送失败');
    } finally {
      setIsSending(false);
      setSelectedPeer(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSendClick = (peerId: string) => {
    setSelectedPeer(peerId);
    fileInputRef.current?.click();
  };

  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    setRoomError(null);
    try {
      await createRoom();
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!joinRoomId.trim()) return;
    setIsJoiningRoom(true);
    setRoomError(null);
    try {
      await joinRoom(joinRoomId.trim().toUpperCase());
      setJoinRoomId('');
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : '加入房间失败');
    } finally {
      setIsJoiningRoom(false);
    }
  };

  const handleLeaveRoom = async () => {
    try {
      await leaveRoom();
    } catch (err) {
      console.error('Failed to leave room:', err);
    }
  };

  const activeRequest = pendingRequests[0];

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto bg-green-500 rounded-2xl flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">P2P 直传</h1>
        <p className="text-slate-500 text-sm">
          {isConnected ? '已连接 · 通过房间号即可互传文件' : '正在连接...'}
        </p>
      </div>

      {!isConnected && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 text-yellow-700">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>正在连接到信令服务器...</span>
          </div>
        </div>
      )}

      {/* Room Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">房间</h2>

        {room ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-blue-700 font-medium">当前房间:</span>
                  <span className="bg-blue-600 text-white px-3 py-1 rounded-lg font-mono text-lg">
                    {room.id}
                  </span>
                </div>
                <p className="text-blue-600 text-sm mt-1">
                  将此房间号分享给其他设备，即可在任意网络下互传文件
                </p>
              </div>
              <button
                onClick={handleLeaveRoom}
                className="px-4 py-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
              >
                离开房间
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <h3 className="font-medium text-slate-700 mb-2">创建房间</h3>
                <p className="text-slate-500 text-sm mb-3">创建一个新房间，分享房间号给其他设备</p>
                <button
                  onClick={handleCreateRoom}
                  disabled={isCreatingRoom || !isConnected}
                  className="w-full px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreatingRoom ? '创建中...' : '创建房间'}
                </button>
              </div>

              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <h3 className="font-medium text-slate-700 mb-2">加入房间</h3>
                <p className="text-slate-500 text-sm mb-3">输入房间号加入已有房间</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                    placeholder="4位房间号"
                    maxLength={4}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-center font-mono text-lg uppercase"
                  />
                  <button
                    onClick={handleJoinRoom}
                    disabled={isJoiningRoom || !isConnected || joinRoomId.length !== 4}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isJoiningRoom ? '加入中...' : '加入'}
                  </button>
                </div>
              </div>
            </div>

            {roomError && (
              <p className="text-red-500 text-sm mt-3 text-center">{roomError}</p>
            )}
          </div>
        )}
      </section>

      {/* Room Peers Section */}
      {room && roomPeers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-slate-700 mb-4">
            房间内的设备
            <span className="ml-2 text-sm font-normal text-slate-400">({roomPeers.length})</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {roomPeers.map((peer) => (
              <PeerCard
                key={peer.socketId}
                peer={peer}
                onSendFile={() => handleSendClick(peer.socketId)}
                disabled={isSending}
                source="room"
              />
            ))}
          </div>
        </section>
      )}

      {transfers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-slate-700 mb-4">传输中</h2>
          <div className="space-y-3">
            {transfers.map((transfer) => (
              <TransferProgressCard key={transfer.id} transfer={transfer} />
            ))}
          </div>
        </section>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

      {activeRequest && (
        <TransferRequestModal
          request={activeRequest}
          onAccept={() => acceptTransfer(activeRequest.id, activeRequest.fromPeer?.socketId || '')}
          onReject={() => rejectTransfer(activeRequest.id, activeRequest.fromPeer?.socketId || '')}
        />
      )}
    </div>
  );
}
