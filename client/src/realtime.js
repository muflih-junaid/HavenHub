import { createContext, useContext, useEffect, useEffectEvent } from 'react';

export const RealtimeContext = createContext({ socket: null, status: null });

export function useRealtime() { return useContext(RealtimeContext); }

// Keep REST as the source of data. Coalesce related notifications into one reload.
export function useLiveRefresh(events, onRefresh, id) {
  const { socket } = useRealtime();
  const refresh = useEffectEvent(onRefresh);
  useEffect(() => {
    if (!socket) return;
    let timer;
    function receive(payload) {
      if (id && payload?.id && payload.id !== id && payload.requestId !== id) return;
      clearTimeout(timer);
      timer = setTimeout(() => refresh(), 75);
    }
    const topics = events.split(' ');
    for (const topic of topics) socket.on(topic, receive);
    // Initial connection and every reconnect close the gap after the last REST read.
    socket.on('connect', receive);
    return () => {
      clearTimeout(timer);
      for (const topic of topics) socket.off(topic, receive);
      socket.off('connect', receive);
    };
  }, [socket, events, id]);
}
