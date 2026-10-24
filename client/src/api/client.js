import axios from 'axios';

export const TOKEN_KEY = 'havenhub_token';
const baseURL = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '');
let token = null;

try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  // Browsers can block storage. A new session can still work in memory.
}

export function getToken() {
  return token;
}

export function setToken(value, persist = true) {
  token = value;
  if (!persist) return true;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}

const api = axios.create({ baseURL, timeout: 10000 });

api.interceptors.request.use((config) => {
  if (!baseURL) throw new Error('Set VITE_API_URL in client/.env and restart the client.');
  if (token && !config.skipAuth) {
    config.headers.Authorization = `Bearer ${token}`;
    // Remember which session sent the request, so stale responses cannot end a new session.
    config.sessionToken = token;
  }
  return config;
});

export function apiErrorMessage(error) {
  if (!baseURL) return 'The API connection is not configured. Set VITE_API_URL in client/.env and restart the client.';
  if (error.response?.status >= 500) return 'The server is unavailable. Please try again shortly.';
  if (typeof error.response?.data?.message === 'string') return error.response.data.message;
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (axios.isAxiosError(error) && !error.response) return 'Cannot reach HavenHub. Check your connection and try again.';
  return error.message || 'Something went wrong. Please try again.';
}

export default api;
