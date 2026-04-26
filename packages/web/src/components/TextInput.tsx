import React, { useState } from 'react';

interface TextInputProps {
  onSubmit: (text: string) => void;
  loading?: boolean;
  maxLength?: number;
}

export function TextInput({ onSubmit, loading, maxLength = 10000 }: TextInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
    }
  };

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入要发送的文本内容..."
        className="w-full h-40 p-4 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        maxLength={maxLength}
        disabled={loading}
      />
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          {text.length} / {maxLength} 字符
        </span>
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || loading}
          className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '发送中...' : '发送文本'}
        </button>
      </div>
    </div>
  );
}
