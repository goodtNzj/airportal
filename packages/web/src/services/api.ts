import axios from 'axios';
import type { TransferResult, AuthResult, Config, User } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加 token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：处理错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: async (username: string, password: string): Promise<AuthResult> => {
    const res = await api.post<{ success: boolean; data: AuthResult }>('/auth/register', {
      username,
      password,
    });
    return res.data.data;
  },

  login: async (username: string, password: string): Promise<AuthResult> => {
    const res = await api.post<{ success: boolean; data: AuthResult }>('/auth/login', {
      username,
      password,
    });
    return res.data.data;
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

  uploadFile: async (file: File, expiresIn?: number): Promise<TransferResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (expiresIn) {
      formData.append('expiresIn', expiresIn.toString());
    }
    const res = await api.post<{ success: boolean; data: TransferResult }>('/transfers', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },

  uploadText: async (text: string, expiresIn?: number): Promise<TransferResult> => {
    const res = await api.post<{ success: boolean; data: TransferResult }>('/transfers', {
      text,
      expiresIn,
    });
    return res.data.data;
  },

  getContent: async (code: string): Promise<Blob | { contentType: 'text'; textContent: string; expiresAt: string }> => {
    const res = await api.get(`/transfers/${code}`, { responseType: 'blob' });
    const contentType = res.headers['content-type'];
    if (contentType?.includes('application/json')) {
      const text = await res.data.text();
      return JSON.parse(text).data;
    }
    return res.data;
  },
};

export default api;
