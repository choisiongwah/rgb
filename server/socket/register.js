import { z } from 'zod';
import { authService } from '../middleware/auth.js';

const inputSchema = z.object({ action: z.enum(['R', 'G', 'B']) });
const room = (id) => 'session:' + id;

export function registerSocketHandlers(io, { sessions }) {
  io.use((socket, next) => {
    socket.data.user = authService.getUser(socket.handshake.auth?.token);
    socket.data.sessionId = socket.handshake.auth?.sessionId;
    socket.data.joinToken = socket.handshake.auth?.joinToken;
    next();
  });

  io.on('connection', (socket) => {
    if (socket.data.user) {
      socket.on('host:subscribe', ({ sessionId }, ack = () => {}) => {
        const session = sessions.get(sessionId);
        if (!session || session.host.username !== socket.data.user.username) {
          return ack({ ok: false, error: 'SESSION_NOT_FOUND' });
        }
        socket.data.hostSessionId = sessionId;
        socket.join(room(sessionId));
        ack({ ok: true, session: sessions.toHostView(session) });
      });

      const hostAction = (event, action) => socket.on(event, (ack = () => {}) => {
        const sessionId = socket.data.hostSessionId;
        const session = sessions.get(sessionId);
        if (!session || session.host.username !== socket.data.user.username) {
          return ack({ ok: false, error: 'SESSION_NOT_FOUND' });
        }
        try {
          action(sessionId);
          const state = sessions.toPublicView(session);
          io.to(room(sessionId)).emit('game:state', state);
          ack({ ok: true, state });
        } catch (error) {
          ack({ ok: false, error: error.message });
        }
      });

      hostAction('host:start', (id) => sessions.startLevel(id));
      hostAction('host:pause', (id) => sessions.setPaused(id, true));
      hostAction('host:resume', (id) => sessions.setPaused(id, false));
      hostAction('host:finish-level', (id) => sessions.finishLevel(id));
      hostAction('host:next-level', (id) => sessions.nextLevel(id));
      return;
    }

    socket.on('player:join', (profile, ack = () => {}) => {
      try {
        const { session, slot } = sessions.join(
          socket.data.sessionId,
          socket.data.joinToken,
          { name: String(profile?.name || '') }
        );
        socket.data.playerSessionId = session.id;
        socket.data.playerToken = socket.data.joinToken;
        socket.join(room(session.id));
        const state = sessions.toPublicView(session);
        io.to(room(session.id)).emit('game:state', state);
        ack({ ok: true, color: slot.color, state });
      } catch (error) {
        ack({ ok: false, error: error.message });
      }
    });

    socket.on('player:input', (payload, ack = () => {}) => {
      const parsed = inputSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_INPUT' });
      try {
        const result = sessions.submitInput(socket.data.sessionId, socket.data.joinToken, parsed.data.action);
        const state = sessions.toPublicView(result.session);
        io.to(room(result.session.id)).emit('game:state', state);
        ack({
          ok: true,
          correct: result.correct,
          reset: result.reset,
          cycleCompleted: result.cycleCompleted,
          state
        });
      } catch (error) {
        ack({ ok: false, error: error.message });
      }
    });

    socket.on('disconnect', () => {
      if (!socket.data.playerSessionId || !socket.data.playerToken) return;
      const result = sessions.disconnect(socket.data.playerSessionId, socket.data.playerToken);
      if (result) io.to(room(result.session.id)).emit('game:state', sessions.toPublicView(result.session));
    });
  });
}
