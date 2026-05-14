import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/useStore';
import { authApi } from '../services/api';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await authApi.logout().catch(() => {});
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#f0eee6]">
      <header className="bg-white border-b border-black/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#d97757] rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <span className="text-xl font-bold text-[#141413]">AirPortal</span>
          </Link>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <span className="text-sm text-[#3d3d3a]">你好, {user.username}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-[#73726c] hover:text-[#141413]"
                >
                  退出
                </button>
              </>
            ) : (
              <Link to="/login" className="text-sm text-[#d97757] hover:text-[#c6613f]">
                登录
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
      <footer className="text-center py-6 text-sm text-[#91908a]">
        <p>AirPortal - 简单安全的文件传输</p>
      </footer>
    </div>
  );
}
