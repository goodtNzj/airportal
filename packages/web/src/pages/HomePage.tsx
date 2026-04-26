import React from 'react';
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
        <h1 className="text-4xl font-bold text-slate-800 mb-2">AirPortal</h1>
        <p className="text-slate-500">简单安全的跨设备文件传输</p>
      </div>

      <div className="flex justify-center gap-4 mb-8">
        <Link
          to="/send"
          className="px-8 py-4 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          发送
        </Link>
        <Link
          to="/receive"
          className="px-8 py-4 bg-white text-primary-500 border border-primary-500 rounded-xl hover:bg-primary-50 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          接收
        </Link>
      </div>

      <div className="text-sm text-slate-400 space-y-1">
        <p>无需登录即可使用</p>
        {user && <p>登录后可查看传输历史</p>}
      </div>
    </div>
  );
}
