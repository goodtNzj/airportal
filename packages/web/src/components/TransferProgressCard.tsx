import type { TransferProgress } from '../types/p2p';

interface TransferProgressCardProps {
  transfer: TransferProgress;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getStatusText(status: TransferProgress['status']): string {
  switch (status) {
    case 'connecting':
      return '连接中...';
    case 'transferring':
      return '传输中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '未知';
  }
}

function getStatusColor(status: TransferProgress['status']): string {
  switch (status) {
    case 'connecting':
      return 'text-amber-600';
    case 'transferring':
      return 'text-blue-600';
    case 'completed':
      return 'text-emerald-600';
    case 'failed':
      return 'text-red-500';
    default:
      return 'text-[#73726c]';
  }
}

export function TransferProgressCard({ transfer }: TransferProgressCardProps) {
  const isCompleted = transfer.status === 'completed';
  const isFailed = transfer.status === 'failed';
  const isInProgress = transfer.status === 'transferring' || transfer.status === 'connecting';

  return (
    <div className={`bg-white rounded-xl border p-4 shadow-sm ${
      isFailed ? 'border-red-200' : isCompleted ? 'border-emerald-200' : 'border-black/[0.06]'
    }`}>
      <div className="flex items-center gap-3">
        {/* Direction Icon */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          transfer.direction === 'sending' ? 'bg-[#f0eee6]' : 'bg-emerald-50'
        }`}>
          {transfer.direction === 'sending' ? (
            <svg className="w-5 h-5 text-[#d97757]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 11l5-5m0 0l5 5m-5-5v12"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 13l-5 5m0 0l-5-5m5 5V6"
              />
            </svg>
          )}
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="font-medium text-[#141413] truncate">{transfer.fileName}</p>
            <span className={`text-sm ${getStatusColor(transfer.status)}`}>
              {getStatusText(transfer.status)}
            </span>
          </div>

          {/* Progress Bar */}
          {isInProgress && (
            <div className="w-full bg-[#f0eee6] rounded-full h-2 mb-1">
              <div
                className="bg-[#d97757] h-2 rounded-full transition-all duration-300"
                style={{ width: `${transfer.percentage}%` }}
              />
            </div>
          )}

          {/* Size Info */}
          <div className="flex items-center gap-2 text-xs text-[#73726c]">
            <span>
              {isInProgress
                ? `${formatFileSize(transfer.bytesTransferred)} / ${formatFileSize(transfer.fileSize)}`
                : formatFileSize(transfer.fileSize)}
            </span>
            {isInProgress && (
              <>
                <span>·</span>
                <span>{transfer.percentage.toFixed(0)}%</span>
              </>
            )}
            <span>·</span>
            <span>{transfer.peerName}</span>
          </div>
        </div>

        {/* Status Icon */}
        {isCompleted && (
          <div className="w-8 h-8 bg-emerald-50 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {isFailed && (
          <div className="w-8 h-8 bg-red-50 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
