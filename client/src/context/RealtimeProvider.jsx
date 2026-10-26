import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import api, { getToken } from '../api/client.js';
import { useAuth } from './AuthContext.js';
import { RealtimeContext } from '../realtime.js';

export default function RealtimeProvider({ children }) {
  const { user, retrySession } = useAuth();
  const token = getToken();
  const userId = user?.id;
  const role = user?.role;
  const [connection, setConnection] = useState({ socket: null, status: null });
  const restoreSession = useEffectEvent(() => retrySession());
  const socket = useMemo(() => {
    if (!userId || !role || !token || !api.defaults.baseURL) return null;
    return io(new URL(api.defaults.baseURL, window.location.origin).origin, {
      autoConnect: false,
      auth: (callback) => callback({ token: getToken() }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }, [userId, role, token]);

  useEffect(() => {
    if (!socket) return;
    let retryTimer;
    function connected() {
      clearTimeout(retryTimer);
      setConnection({ socket, status: 'online' });
    }
    function disconnected() { setConnection({ socket, status: 'reconnecting' }); }
    function sessionInvalid() { restoreSession(); }
    function failed(error) {
      setConnection({ socket, status: 'unavailable' });
      if (error.data?.code === 'UNAUTHENTICATED') return restoreSession();
      // Transport errors reconnect automatically; temporary middleware failures need a retry.
      if (!socket.active) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => socket.connect(), 3000);
      }
    }
    socket.on('connect', connected);
    socket.on('disconnect', disconnected);
    socket.on('connect_error', failed);
    socket.on('session:invalid', sessionInvalid);
    socket.connect();
    return () => {
      clearTimeout(retryTimer);
      socket.off('connect', connected);
      socket.off('disconnect', disconnected);
      socket.off('connect_error', failed);
      socket.off('session:invalid', sessionInvalid);
      socket.disconnect();
    };
  }, [socket]);

  const status = socket ? connection.socket === socket ? connection.status : 'connecting' : null;
  return <RealtimeContext.Provider value={{ socket, status }}>{children}</RealtimeContext.Provider>;
}
