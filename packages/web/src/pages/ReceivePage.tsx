import { useState } from 'react';
import { CodeInput } from '../components/CodeInput';
import { transferApi } from '../services/api';
import { useStore } from '../stores/useStore';

export function ReceivePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { user } = useStore();

  const handleSubmit = async (code: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await transferApi.getContentWithFilename(code);

      if ('textContent' in result) {
        // 文本内容
        navigator.clipboard.writeText(result.textContent);
        setError(null);
        alert('文本已复制到剪贴板！');
      } else {
        // 文件/文件夹下载
        setDownloading(true);
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Delay revocation to allow the browser to start the download
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setDownloading(false);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || '获取失败';
      const statusCode = err.response?.status;

      // 处理 ownerOnly 相关错误
      if (statusCode === 403) {
        if (!user) {
          setError('此内容需要登录后领取，请先登录');
        } else {
          setError('此内容仅限创建者领取');
        }
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">接收文件或文本</h1>
        <p className="text-slate-500">输入取件码获取内容</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-8">
        <p className="text-center text-slate-500 mb-6">请输入 6 位取件码</p>
        <CodeInput onSubmit={handleSubmit} loading={loading || downloading} />
        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}
        {downloading && (
          <p className="mt-4 text-center text-primary-500 text-sm">正在下载...</p>
        )}
      </div>

      <div className="text-center text-sm text-slate-400">
        <p>取件码由 6 位字母和数字组成（不含 0OIl1）</p>
      </div>
    </div>
  );
}
