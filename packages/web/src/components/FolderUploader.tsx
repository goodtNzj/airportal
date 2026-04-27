import React, { useCallback, useState } from 'react';
import { readFolderEntries, createZipFromEntries } from '../services/folder-zip';

interface FolderUploaderProps {
  onZipReady: (zipBlob: Blob, folderName: string, fileCount: number) => void;
  loading?: boolean;
  maxSize?: number;
  maxFileCount?: number;
}

export function FolderUploader({ onZipReady, loading, maxSize = 50 * 1024 * 1024, maxFileCount = 10000 }: FolderUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [progress, setProgress] = useState(0);

  const processEntries = useCallback(
    async (entries: { relativePath: string; file: File }[], folderName: string) => {
      if (entries.length === 0) {
        setError('文件夹为空');
        return;
      }
      if (entries.length > maxFileCount) {
        setError(`文件数量 (${entries.length}) 超过限制 (${maxFileCount})`);
        return;
      }

      const totalSize = entries.reduce((sum, e) => sum + e.file.size, 0);
      if (totalSize > maxSize) {
        setError(`文件夹总大小 (${Math.round(totalSize / 1024 / 1024)}MB) 超过限制`);
        return;
      }

      setZipping(true);
      setProgress(0);
      setError(null);

      try {
        const zipBlob = await createZipFromEntries(entries, folderName, setProgress);
        onZipReady(zipBlob, folderName, entries.length);
      } catch (err) {
        setError('压缩文件夹失败');
      } finally {
        setZipping(false);
        setProgress(0);
      }
    },
    [maxSize, maxFileCount, onZipReady]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);

      const items = e.dataTransfer.items;
      if (items.length === 0) return;

      // Try to get entry as directory
      const entry = items[0].webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        try {
          const entries = await readFolderEntries(entry as FileSystemDirectoryEntry);
          await processEntries(entries, entry.name);
        } catch {
          setError('无法读取文件夹，请尝试使用点击选择');
        }
      } else if (e.dataTransfer.files.length > 0) {
        // Fallback: treat as file list
        const folderName = e.dataTransfer.files[0].name.replace(/\.[^.]+$/, '') || 'folder';
        const entries = Array.from(e.dataTransfer.files).map((f) => ({
          relativePath: (f as any).webkitRelativePath || f.name,
          file: f,
        }));
        await processEntries(entries, folderName);
      }
    },
    [processEntries]
  );

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const firstFile = files[0];
      const folderName = (firstFile as any).webkitRelativePath?.split('/')[0] || 'folder';
      const entries = Array.from(files).map((f) => ({
        relativePath: (f as any).webkitRelativePath || f.name,
        file: f,
      }));
      await processEntries(entries, folderName);
    },
    [processEntries]
  );

  const isLoading = loading || zipping;

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
        dragActive ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:border-primary-300'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        // @ts-ignore webkitdirectory is widely supported
        webkitdirectory=""
        directory=""
        onChange={handleChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isLoading}
      />
      <div className="space-y-3">
        <div className="w-16 h-16 mx-auto bg-primary-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>
        <p className="text-slate-600">
          拖拽文件夹到这里，或<span className="text-primary-500">点击选择文件夹</span>
        </p>
        <p className="text-sm text-slate-400">
          文件夹将被压缩为 ZIP 上传（最大 {Math.round(maxSize / 1024 / 1024)}MB）
        </p>
      </div>

      {zipping && (
        <div className="mt-4">
          <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-slate-400">压缩中... {progress}%</p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {isLoading && !zipping && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-xl">
          <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}
