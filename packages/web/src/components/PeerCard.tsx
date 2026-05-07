import type { PeerInfo } from '../types/p2p';

interface PeerCardProps {
  peer: PeerInfo;
  onSendFile: () => void;
  disabled?: boolean;
  source?: 'room';
}

export function PeerCard({ peer, onSendFile, disabled, source }: PeerCardProps) {
  return (
    <div className="bg-white rounded-xl border border-black/[0.06] p-4 hover:border-black/10 hover:shadow-sm transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Device Icon */}
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            peer.status === 'available' ? 'bg-emerald-50' : 'bg-amber-50'
          }`}>
            <svg className={`w-5 h-5 ${
              peer.status === 'available' ? 'text-emerald-600' : 'text-amber-600'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>

          {/* Device Info */}
          <div>
            <h3 className="font-medium text-[#141413]">{peer.deviceName}</h3>
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  peer.status === 'available' ? 'bg-emerald-500' : 'bg-amber-500'
                }`} />
                <span className="text-[#73726c]">
                  {peer.status === 'available' ? '在线' : '传输中'}
                </span>
              </div>
              {source === 'room' && (
                <span className="px-1.5 py-0.5 bg-[#f0eee6] text-[#73726c] rounded text-xs">
                  房间
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Send Button */}
        <button
          onClick={onSendFile}
          disabled={disabled || peer.status !== 'available'}
          className="px-4 py-2 bg-[#c6613f] text-white text-sm rounded-lg hover:bg-[#d97757] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1 font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          发送文件
        </button>
      </div>
    </div>
  );
}
