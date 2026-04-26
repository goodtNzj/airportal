import React, { useState, useEffect } from 'react';
import { FileUploader } from '../components/FileUploader';
import { TextInput } from '../components/TextInput';
import { PickupCodeDisplay } from '../components/PickupCodeDisplay';
import { transferApi } from '../services/api';
import { useStore } from '../stores/useStore';
import type { TransferResult } from '../types';

type TransferType = 'file' | 'text';

export function SendPage() {
  const [transferType, setTransferType] = useState<TransferType>('file');
  const [expiresIn, setExpiresIn] = useState(180);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { config, setConfig } = useStore();

  useEffect(() => {
    transferApi.getConfig().then(setConfig).catch(console.error);
  }, [setConfig]);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const res = await transferApi.uploadFile(file, expiresIn);
      setResult(res);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '上传失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await transferApi.uploadText(text, expiresIn);
      setResult(res);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '发送失败');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return <PickupCodeDisplay result={result} onReset={() => setResult(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">发送文件或文本</h1>
        <p className="text-slate-500">上传后生成取件码，另一端通过取件码获取</p>
      </div>

      <div className="flex justify-center gap-2">
        <button
          onClick={() => setTransferType('file')}
          className={`px-6 py-2 rounded-full transition-colors ${
            transferType === 'file'
              ? 'bg-primary-500 text-white'
              : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          发送文件
        </button>
        <button
          onClick={() => setTransferType('text')}
          className={`px-6 py-2 rounded-full transition-colors ${
            transferType === 'text'
              ? 'bg-primary-500 text-white'
              : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          发送文本
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        {transferType === 'file' ? (
          <FileUploader
            onUpload={handleFileUpload}
            loading={loading}
            maxSize={config?.maxFileSize}
          />
        ) : (
          <TextInput
            onSubmit={handleTextSubmit}
            loading={loading}
            maxLength={config?.maxTextLength}
          />
        )}

        {error && (
          <p className="mt-4 text-center text-red-500 text-sm">{error}</p>
        )}

        <div className="mt-6 flex items-center justify-center gap-4">
          <label className="text-sm text-slate-500">有效期:</label>
          <select
            value={expiresIn}
            onChange={(e) => setExpiresIn(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value={180}>3 分钟</option>
            <option value={300}>5 分钟</option>
            <option value={600}>10 分钟</option>
            <option value={1800}>30 分钟</option>
            <option value={3600}>1 小时</option>
          </select>
        </div>
      </div>
    </div>
  );
}
