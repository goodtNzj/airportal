import { useState, useRef } from 'react';
import { PeerCard } from '../components/PeerCard';
import { TransferRequestModal } from '../components/TransferRequestModal';
import { TransferProgressCard } from '../components/TransferProgressCard';
import { useP2P } from '../hooks/useP2P';

export function P2PPage() {
  const {
    isConnected,
    peers,
    transfers,
    pendingRequests,
    sendFile,
    acceptTransfer,
    rejectTransfer,
  } = useP2P();

  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
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
        <h1 className="text-2xl font-bold text-slate-800 mb-2">局域网直传</h1>
        <p className="text-slate-500 text-sm">
          {isConnected ? '已连接 · 同一局域网下的设备可以互相发现' : '正在连接...'}
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

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">
          发现的设备
          {peers.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">({peers.length})</span>
          )}
        </h2>

        {peers.length === 0 ? (
          <div className="bg-slate-50 rounded-xl p-8 text-center">
            <svg
              className="w-12 h-12 mx-auto text-slate-300 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <p className="text-slate-400">{isConnected ? '暂无其他设备在线' : '请等待连接建立'}</p>
            {isConnected && (
              <p className="text-slate-400 text-sm mt-1">请确保其他设备也打开了此页面</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {peers.map((peer) => (
              <PeerCard
                key={peer.socketId}
                peer={peer}
                onSendFile={() => handleSendClick(peer.socketId)}
                disabled={isSending}
              />
            ))}
          </div>
        )}
      </section>

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
