import { useEffect, useRef, useState } from 'react';
import api, { apiErrorMessage, getToken, setToken, TOKEN_KEY } from '../api/client.js';
import { AuthContext } from './AuthContext.js';

function validateUser(user) {
  if (!user?.id || !['citizen', 'volunteer', 'admin'].includes(user.role)) {
    throw new Error('The server returned an unexpected account response. Please try again.');
  }
  return user;
}

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(() => ({
    user: null, status: getToken() ? 'loading' : 'ready', error: '',
  }));
  const [storageWarning, setStorageWarning] = useState('');
  const [attempt, setAttempt] = useState(0);
  const sessionVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const originalToken = getToken();
    const version = sessionVersion.current;

    const interceptor = api.interceptors.response.use((response) => response, (error) => {
      if (error.response?.status === 401 && error.config?.sessionToken
          && error.config.sessionToken === getToken()) {
        sessionVersion.current += 1;
        setToken(null);
        setSession({ user: null, status: 'ready', error: 'Your session has ended. Please sign in again.' });
      }
      return Promise.reject(error);
    });

    async function restoreSession() {
      try {
        const { data } = await api.get('/auth/me', { signal: controller.signal });
        if (active && version === sessionVersion.current) {
          setSession({ user: validateUser(data.user), status: 'ready', error: '' });
        }
      } catch (error) {
        if (active && version === sessionVersion.current && !controller.signal.aborted) {
          setSession({ user: null, status: 'error', error: apiErrorMessage(error) });
        }
      }
    }

    if (originalToken) restoreSession();

    function syncStorage(event) {
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      sessionVersion.current += 1;
      setToken(event.newValue, false);
      setSession({ user: null, status: event.newValue ? 'loading' : 'ready', error: '' });
      setAttempt((previous) => previous + 1);
    }
    window.addEventListener('storage', syncStorage);

    return () => {
      active = false;
      controller.abort();
      api.interceptors.response.eject(interceptor);
      window.removeEventListener('storage', syncStorage);
    };
  }, [attempt]);

  async function authenticate(path, credentials) {
    const version = sessionVersion.current;
    const { data } = await api.post(path, credentials, { skipAuth: true });
    if (version !== sessionVersion.current) throw new Error('The session changed. Please try signing in again.');
    const user = validateUser(data.user);
    if (typeof data.token !== 'string' || !data.token) throw new Error('The server did not return a session token.');

    sessionVersion.current += 1;
    const persisted = setToken(data.token);
    setStorageWarning(persisted ? '' : 'Your browser could not save this session. You will need to sign in again after reloading.');
    setSession({ user, status: 'ready', error: '' });
    return user;
  }

  function logout() {
    sessionVersion.current += 1;
    const cleared = setToken(null);
    setStorageWarning(cleared ? '' : 'Signed out in this tab, but browser storage could not be cleared. Clear this site’s storage before using a shared device.');
    setSession({ user: null, status: 'ready', error: '' });
  }

  function retrySession() {
    setSession({ user: null, status: 'loading', error: '' });
    setAttempt((previous) => previous + 1);
  }

  return (
    <AuthContext.Provider value={{
      user: session.user,
      loading: session.status === 'loading',
      sessionError: session.error,
      needsRetry: session.status === 'error',
      storageWarning,
      login: (credentials) => authenticate('/auth/login', credentials),
      register: (credentials) => authenticate('/auth/register', credentials),
      logout,
      retrySession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
