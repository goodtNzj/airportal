import { useCountdown } from '../hooks/useCountdown';
import type { TransferResult } from '../types';

interface PickupCodeDisplayProps {
  result: TransferResult;
  onReset: () => void;
}

export function PickupCodeDisplay({ result, onReset }: PickupCodeDisplayProps) {
  const { formatted, isExpired } = useCountdown(result.expiresAt);

  const copyCode = () => {
    navigator.clipboard.writeText(result.pickupCode);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-md mx-auto">
      <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-slate-800 mb-2">创建成功</h2>
      <p className="text-slate-500 text-sm mb-6">请将取件码发送给接收方</p>

      <div className="mb-6">
        <p className="text-sm text-slate-400 mb-2">取件码</p>
        <div className="flex items-center justify-center gap-2">
          <code className="text-3xl font-bold tracking-widest text-primary-600 bg-primary-50 px-4 py-2 rounded-lg">
            {result.pickupCode}
          </code>
          <button
            onClick={copyCode}
            className="p-2 text-slate-400 hover:text-primary-500 transition-colors"
            title="复制"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className={`flex items-center justify-center gap-2 ${isExpired ? 'text-red-500' : 'text-slate-600'}`}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{isExpired ? '已过期' : `剩余时间: ${formatted}`}</span>
      </div>

      <button
        onClick={onReset}
        className="mt-6 w-full py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors"
      >
        再发一个
      </button>
    </div>
  );
}
