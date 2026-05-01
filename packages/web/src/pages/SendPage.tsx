import React, { useState, useEffect } from 'react';
import { FileUploader } from '../components/FileUploader';
import { FolderUploader } from '../components/FolderUploader';
import { TextInput } from '../components/TextInput';
import { PickupCodeDisplay } from '../components/PickupCodeDisplay';
import { transferApi } from '../services/api';
import { useStore } from '../stores/useStore';
import type { TransferResult } from '../types';

type TransferType = 'file' | 'text' | 'folder';

export function SendPage() {
  const [transferType, setTransferType] = useState<TransferType>('file');
  const [expiresIn, setExpiresIn] = useState(180);
  const [maxDownloads, setMaxDownloads] = useState(1);
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { config, setConfig, user } = useStore();

  useEffect(() => {
    transferApi.getConfig().then(setConfig).catch(console.error);
  }, [setConfig]);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const res = await transferApi.uploadFile(file, { expiresIn, maxDownloads, ownerOnly });
      setResult(res);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '上传失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFolderZip = async (zipBlob: Blob, folderName: string, fileCount: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await transferApi.uploadFolder(zipBlob, folderName, fileCount, { expiresIn, maxDownloads, ownerOnly });
      setResult(res);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '上传文件夹失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await transferApi.uploadText(text, { expiresIn, maxDownloads, ownerOnly });
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

      <div className="flex justify-center gap-2 flex-wrap">
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
        {config?.folderUploadEnabled !== false && (
          <button
            onClick={() => setTransferType('folder')}
            className={`px-6 py-2 rounded-full transition-colors ${
              transferType === 'folder'
                ? 'bg-primary-500 text-white'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            发送文件夹
          </button>
        )}
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
        {transferType === 'file' && (
          <FileUploader
            onUpload={handleFileUpload}
            loading={loading}
            maxSize={config?.maxFileSize}
          />
        )}
        {transferType === 'folder' && (
          <FolderUploader
            onZipReady={handleFolderZip}
            loading={loading}
            maxSize={config?.maxFileSize}
          />
        )}
        {transferType === 'text' && (
          <TextInput
            onSubmit={handleTextSubmit}
            loading={loading}
            maxLength={config?.maxTextLength}
          />
        )}

        {error && (
          <p className="mt-4 text-center text-red-500 text-sm">{error}</p>
        )}

        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-center gap-4">
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

          <div className="flex items-center justify-center gap-4">
            <label className="text-sm text-slate-500">可领取次数:</label>
            <select
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(Number(e.target.value))}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value={1}>1 次</option>
              <option value={2}>2 次</option>
              <option value={5}>5 次</option>
              <option value={10}>10 次</option>
              <option value={0}>不限次数</option>
            </select>
          </div>

          {user && (
            <div className="flex items-center justify-center gap-4">
              <label className="text-sm text-slate-500">仅限本人领取:</label>
              <button
                type="button"
                onClick={() => setOwnerOnly(!ownerOnly)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  ownerOnly ? 'bg-primary-500' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    ownerOnly ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-xs text-slate-400">开启后仅您可领取</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
