import axios from 'axios';
import type { TransferResult, Config, User, UserPayload, UploadOptions } from '../types';
import { useStore } from '../stores/useStore';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// 响应拦截器：处理错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useStore.getState().logout();
      window.dispatchEvent(new CustomEvent('auth:logout'));
      if (!window.location.pathname.includes('/p2p')) {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: async (username: string, password: string): Promise<{ user: UserPayload }> => {
    const res = await api.post<{ success: boolean; data: { user: UserPayload } }>('/auth/register', {
      username,
      password,
    });
    return res.data.data;
  },

  login: async (username: string, password: string): Promise<{ user: UserPayload }> => {
    const res = await api.post<{ success: boolean; data: { user: UserPayload } }>('/auth/login', {
      username,
      password,
    });
    return res.data.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },

  getMe: async (): Promise<User> => {
    const res = await api.get<{ success: boolean; data: User }>('/auth/me');
    return res.data.data;
  },
};

export const transferApi = {
  getConfig: async (): Promise<Config> => {
    const res = await api.get<{ success: boolean; data: Config }>('/transfers/config');
    return res.data.data;
  },

  uploadFile: async (file: File, options?: UploadOptions): Promise<TransferResult> => {
    const formData = new FormData();
    formData.append('file', file);

    const params = new URLSearchParams();
    if (options?.expiresIn) {
      params.append('expiresIn', options.expiresIn.toString());
    }
    if (options?.maxDownloads !== undefined) {
      params.append('maxDownloads', options.maxDownloads.toString());
    }
    if (options?.ownerOnly) {
      params.append('ownerOnly', 'true');
    }

    const res = await api.post<{ success: boolean; data: TransferResult }>(
      `/transfers?${params.toString()}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return res.data.data;
  },

  uploadFolder: async (zipBlob: Blob, folderName: string, fileCount: number, options?: UploadOptions): Promise<TransferResult> => {
    const formData = new FormData();
    formData.append('file', zipBlob, `${folderName}.zip`);

    const params = new URLSearchParams();
    params.append('type', 'folder');
    params.append('folderName', folderName);
    params.append('fileCount', fileCount.toString());
    if (options?.expiresIn) {
      params.append('expiresIn', options.expiresIn.toString());
    }
    if (options?.maxDownloads !== undefined) {
      params.append('maxDownloads', options.maxDownloads.toString());
    }
    if (options?.ownerOnly) {
      params.append('ownerOnly', 'true');
    }

    const res = await api.post<{ success: boolean; data: TransferResult }>(
      `/transfers?${params.toString()}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return res.data.data;
  },

  uploadText: async (text: string, options?: UploadOptions): Promise<TransferResult> => {
    const res = await api.post<{ success: boolean; data: TransferResult }>('/transfers', {
      text,
      expiresIn: options?.expiresIn,
      maxDownloads: options?.maxDownloads,
      ownerOnly: options?.ownerOnly,
    });
    return res.data.data;
  },

  getContent: async (code: string): Promise<Blob | { contentType: 'text'; textContent: string; expiresAt: string }> => {
    const res = await api.get(`/transfers/${code}`, { responseType: 'blob' });
    const contentType = res.headers['content-type'];
    if (typeof contentType === 'string' && contentType.includes('application/json')) {
      const text = await res.data.text();
      return JSON.parse(text).data;
    }
    return res.data;
  },

  getContentWithFilename: async (code: string): Promise<{ blob: Blob; filename: string } | { contentType: 'text'; textContent: string; expiresAt: string }> => {
    const res = await api.get(`/transfers/${code}`, { responseType: 'blob' });
    const contentType = res.headers['content-type'];
    if (typeof contentType === 'string' && contentType.includes('application/json')) {
      const text = await res.data.text();
      return JSON.parse(text).data;
    }
    const disposition = res.headers['content-disposition'];
    let filename = 'download';
    if (typeof disposition === 'string') {
      const match = disposition.match(/filename\*=UTF-8''(.+)/)
        || disposition.match(/filename="?([^";\n]+)"?/);
      if (match) {
        filename = decodeURIComponent(match[1]);
      }
    }
    return { blob: res.data as Blob, filename };
  },
};

export const p2pApi = {
  getICEServers: async (): Promise<RTCIceServer[]> => {
    const res = await api.get<{ success: boolean; data: { iceServers: RTCIceServer[] } }>('/p2p/ice-servers');
    return res.data.data.iceServers;
  },
};

export default api;
