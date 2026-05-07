import { Link } from 'react-router-dom';
import { useStore } from '../stores/useStore';

export function HomePage() {
  const { user } = useStore();

  return (
    <div className="text-center py-12">
      <div className="mb-8">
        <div className="w-20 h-20 mx-auto bg-primary-500 rounded-2xl flex items-center justify-center mb-4">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <h1 className="text-4xl font-bold text-[#141413] mb-2">AirPortal</h1>
        <p className="text-[#73726c]">简单安全的跨设备文件传输</p>
      </div>

      <div className="flex justify-center gap-4 mb-6 flex-wrap">
        <Link
          to="/send"
          className="px-8 py-4 bg-[#c6613f] text-white rounded-xl hover:bg-[#d97757] transition-colors flex items-center gap-2 font-medium"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          发送
        </Link>
        <Link
          to="/receive"
          className="px-8 py-4 bg-white text-[#d97757] border border-black/10 rounded-xl hover:bg-black/[0.04] transition-colors flex items-center gap-2 font-medium"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          接收
        </Link>
      </div>

      {/* P2P Entry */}
      <div className="mb-8">
        <Link
          to="/p2p"
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#c6613f] text-white rounded-xl hover:bg-[#d97757] transition-colors font-medium"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
            />
          </svg>
          P2P 直传
        </Link>
        <p className="text-sm text-[#91908a] mt-2">通过房间号实现设备间直接传输，无需经过服务器</p>
      </div>

      <div className="text-sm text-[#91908a] space-y-1">
        <p>无需登录即可使用</p>
        {user && <p>登录后可查看传输历史</p>}
      </div>
    </div>
  );
}
