import { useState, useEffect } from 'react';
import type { PendingTransfer } from '../types/p2p';

interface TransferRequestModalProps {
  request: PendingTransfer;
  onAccept: () => void;
  onReject: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function TransferRequestModal({ request, onAccept, onReject }: TransferRequestModalProps) {
  const [timeLeft, setTimeLeft] = useState(60);

  useEffect(() => {
    const expiresAt = new Date(request.expiresAt).getTime();
    const now = Date.now();
    const initialTimeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
    setTimeLeft(initialTimeLeft);

    const interval = setInterval(() => {
      const newTimeLeft = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(newTimeLeft);

      if (newTimeLeft <= 0) {
        onReject();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [request.expiresAt, onReject]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">文件传输请求</h3>
            <p className="text-sm text-slate-500">
              来自: {request.fromPeer?.deviceName || '未知设备'}
            </p>
          </div>
        </div>

        {/* File Info */}
        <div className="bg-slate-50 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800 truncate">{request.fileName}</p>
              <p className="text-sm text-slate-500">{formatFileSize(request.fileSize)}</p>
            </div>
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center justify-center gap-1 text-sm text-slate-400 mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{timeLeft} 秒后自动拒绝</span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onReject}
            className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-4 py-3 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors"
          >
            接收
          </button>
        </div>
      </div>
    </div>
  );
}
