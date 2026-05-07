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
    <div>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-semibold text-[#141413] mb-3 tracking-[-0.01em]">P2P 直传</h1>
          <p className="text-[#73726c] text-sm">
            {isConnected
              ? '已连接 · 通过房间号即可互传文件'
              : '正在连接...'}
          </p>
        </div>

        {!isConnected && (
          <div className="bg-white border border-black/5 rounded-xl p-4 mb-8 shadow-sm">
            <div className="flex items-center gap-3 text-[#73726c]">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>正在连接到信令服务器...</span>
            </div>
          </div>
        )}

        {/* Room Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-[#141413] mb-4">房间</h2>

          {room ? (
            <div className="bg-white border border-black/[0.06] rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-[#3d3d3a] font-medium">当前房间:</span>
                    <span className="bg-[#141413] text-[#f0eee6] px-4 py-1.5 rounded-lg font-mono text-xl tracking-wider">
                      {room.id}
                    </span>
                  </div>
                  <p className="text-[#73726c] text-sm mt-2">
                    将此房间号分享给其他设备，即可在任意网络下互传文件
                  </p>
                </div>
                <button
                  onClick={handleLeaveRoom}
                  className="px-4 py-2 text-[#73726c] hover:text-[#3d3d3a] hover:bg-black/[0.04] rounded-lg transition-colors"
                >
                  离开房间
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#f5f3ee] rounded-xl p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="bg-white rounded-xl p-5 border border-black/[0.06] shadow-sm">
                  <h3 className="font-medium text-[#141413] mb-2">创建房间</h3>
                  <p className="text-[#73726c] text-sm mb-4">创建一个新房间，分享房间号给其他设备</p>
                  <button
                    onClick={handleCreateRoom}
                    disabled={isCreatingRoom || !isConnected}
                    className="w-full px-4 py-2.5 bg-[#c6613f] text-white rounded-lg hover:bg-[#d97757] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    {isCreatingRoom ? '创建中...' : '创建房间'}
                  </button>
                </div>

                <div className="bg-white rounded-xl p-5 border border-black/[0.06] shadow-sm">
                  <h3 className="font-medium text-[#141413] mb-2">加入房间</h3>
                  <p className="text-[#73726c] text-sm mb-4">输入房间号加入已有房间</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      placeholder="4位房间号"
                      maxLength={4}
                      className="flex-1 px-3 py-2.5 bg-[#f0eee6] border border-black/10 text-[#141413] rounded-lg text-center font-mono text-lg uppercase placeholder-[#91908a] focus:outline-none focus:border-[#d97757] focus:ring-1 focus:ring-[#d97757]/20"
                    />
                    <button
                      onClick={handleJoinRoom}
                      disabled={isJoiningRoom || !isConnected || joinRoomId.length !== 4}
                      className="px-4 py-2.5 bg-[#c6613f] text-white rounded-lg hover:bg-[#d97757] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
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
            <h2 className="text-lg font-semibold text-[#141413] mb-4">
              房间内的设备
              <span className="ml-2 text-sm font-normal text-[#73726c]">({roomPeers.length})</span>
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

        {room && roomPeers.length === 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-[#141413] mb-4">房间内的设备</h2>
            <div className="bg-white rounded-xl p-8 text-center border border-black/[0.06] shadow-sm">
              <p className="text-[#73726c]">等待其他设备加入房间...</p>
              <p className="text-[#91908a] text-sm mt-1">分享房间号给其他设备即可开始传输</p>
            </div>
          </section>
        )}

        {/* Transfers Section */}
        {transfers.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-[#141413] mb-4">传输中</h2>
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
    </div>
  );
}
