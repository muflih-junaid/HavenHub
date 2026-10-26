import { Server } from 'socket.io';
import { authenticateToken } from './middleware/auth.js';

const roles = ['citizen', 'volunteer', 'admin'];
const userRoom = (id) => `user:${id.toString()}`;

function invalidateSession(socket) {
  socket.emit('session:invalid');
  socket.disconnect(true);
}

export function attachRealtime(server, app) {
  const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const io = new Server(server, {
    cors: { origin },
    allowRequest: (req, callback) => callback(null, !req.headers.origin || req.headers.origin === origin),
  });
  app.set('io', io);

  io.use(async (socket, next) => {
    try {
      const { user, expiresAt } = await authenticateToken(socket.handshake.auth?.token);
      if (!roles.includes(user.role)) throw Object.assign(new Error('Invalid role'), { status: 401 });
      socket.data.userId = user.id;
      socket.data.role = user.role;
      socket.data.expiresAt = expiresAt;
      next();
    } catch (failure) {
      const error = new Error(failure.status === 401 ? 'Authentication required' : 'Live updates temporarily unavailable');
      error.data = { code: failure.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    socket.join([userRoom(socket.data.userId), `role:${socket.data.role}`]);
    // There are intentionally no client-controlled join, publish, or mutation handlers.
    let expiryTimer;
    function expire() {
      const remaining = socket.data.expiresAt - Date.now();
      if (remaining <= 0) return invalidateSession(socket);
      expiryTimer = setTimeout(expire, Math.min(remaining, 2 ** 31 - 1));
      expiryTimer.unref();
    }
    expire();
    socket.once('disconnect', () => clearTimeout(expiryTimer));
  });
  return io;
}

// Notifications never make an already-persisted REST operation fail. Reconnects
// refresh REST data, so missed notifications do not require an event store.
export async function notifyRooms(req, rooms, event, payload = {}) {
  const io = req.app.get('io');
  if (!io) return;
  try {
    const sockets = await io.in(rooms).fetchSockets();
    await Promise.all(sockets.map(async (socket) => {
      try {
        // Room membership must not outlive a deleted user or changed database role.
        const { user, expiresAt } = await authenticateToken(socket.handshake.auth.token);
        if (expiresAt <= Date.now() || user.id !== socket.data.userId || user.role !== socket.data.role) return invalidateSession(socket);
        if (socket.connected) socket.emit(event, payload);
      } catch { invalidateSession(socket); }
    }));
  } catch { console.error('Live update notification could not be delivered'); }
}

export async function notifyDisaster(req, report) {
  const rooms = ['role:admin', userRoom(report.reportedBy)];
  if (['verified', 'resolved'].includes(report.status)) rooms.push('role:volunteer');
  await notifyRooms(req, rooms, 'disasters:changed', { id: report._id.toString() });
}

export async function notifyRequest(req, request, previous = null, assignment = false) {
  const rooms = ['role:admin', userRoom(request.requester)];
  for (const person of [request.assignedVolunteer, previous?.assignedVolunteer]) {
    if (person) rooms.push(userRoom(person));
  }
  const payload = { id: request._id.toString() };
  await notifyRooms(req, rooms, assignment ? 'assignments:changed' : 'requests:changed', payload);
  if (request.status === 'pending' || previous?.status === 'pending') {
    // Every volunteer may see the redacted pending feed, but receives no private ID.
    await notifyRooms(req, ['role:volunteer'], 'requests:queue-changed');
  }
}
