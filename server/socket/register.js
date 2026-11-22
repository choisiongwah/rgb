import { z } from 'zod';
import { authService } from '../middleware/auth.js';

const inputSchema = z.object({
  action: z.enum(['R', 'G', 'B', 'JUMP']),
  inputId: z.number().int().nonnegative(),
  roundId: z.number().int().nonnegative().optional()
});
const joinSchema = z.object({ name: z.string().trim().min(1).max(20), character: z.enum(['astronaut', 'racer', 'hazmat']).optional(), avatar: z.string().max(180000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).nullable().optional() });
const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['start', 'reset', 'finish', 'next', 'pause', 'resume', 'end']) }),
  z.object({ action: z.literal('configure'), targetCycles: z.number().int() })
]);
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
      socket.on('host:control', ({ sessionId, action, stage }, ack = () => {}) => {
        if (socket.data.user.role !== 'admin') return ack({ ok: false, error: 'ADMIN_ONLY' });
        try {
          const existing = sessions.get(sessionId);
          if (!existing || existing.host.username !== socket.data.user.username) throw new Error('SESSION_NOT_FOUND');
          let session;
          if (action === 'review') {
            session = sessions.reviewResults(sessionId);
          } else if (action === 'challenge') {
            session = sessions.selectLevel(sessionId, socket.data.user.username, stage);
            const controller = session.players.find((slot) => slot.color === session.controllerColor);
            if (!controller) throw new Error('NO_PLAYERS');
            session = sessions.startLevel(sessionId, controller.token);
          } else {
            throw new Error('INVALID_HOST_ACTION');
          }
          const state = sessions.toHostView(session);
          io.to(room(session.id)).emit('game:state', state);
          ack({ ok: true, state });
        } catch (error) {
          const session = sessions.get(sessionId);
          if (session && session.host.username === socket.data.user.username) {
            io.to(room(session.id)).emit('game:state', sessions.toHostView(session));
          }
          ack({ ok: false, error: error.message });
        }
      });
      socket.on('host:subscribe', ({ sessionId }, ack = () => {}) => {
        const session = sessions.get(sessionId);
        if (!session || session.host.username !== socket.data.user.username) {
          return ack({ ok: false, error: 'SESSION_NOT_FOUND' });
        }
        socket.data.hostSessionId = sessionId;
        socket.join(room(sessionId));
        ack({ ok: true, session: sessions.toHostView(session) });
      });
      return;
    }

    socket.on('player:join', (profile, ack = () => {}) => {
      try {
        const parsedProfile = joinSchema.safeParse(profile);
        if (!parsedProfile.success) return ack({ ok: false, error: 'INVALID_PROFILE' });
        const { session, slot, isController } = sessions.join(
          socket.data.sessionId,
          socket.data.joinToken,
          parsedProfile.data
        );
        socket.data.playerSessionId = session.id;
        socket.data.playerToken = socket.data.joinToken;
        socket.data.lastInputId = -1;
        socket.join(room(session.id));
        const state = sessions.toPublicView(session);
        io.to(room(session.id)).emit('game:state', state);
        ack({ ok: true, color: slot.color, isController, state });
      } catch (error) {
        ack({ ok: false, error: error.message });
      }
    });

    socket.on('player:control', (payload, ack = () => {}) => {
      const parsed = controlSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_CONTROL' });
      try {
        const { action, targetCycles } = parsed.data;
        const id = socket.data.playerSessionId;
        const token = socket.data.playerToken;
        let session;
        if (action === 'start') session = sessions.startLevel(id, token);
        else if (action === 'reset') session = sessions.resetLevel(id, token);
        else if (action === 'end') session = sessions.endGame(id, token);
        else if (action === 'finish') session = sessions.finishLevel(id, token);
        else if (action === 'next') session = sessions.nextLevel(id);
        else if (action === 'pause') session = sessions.setPaused(id, true);
        else if (action === 'resume') session = sessions.setPaused(id, false);
        else if (action === 'configure') session = sessions.configure(id, token, targetCycles);
        const state = sessions.toPublicView(session);
        io.to(room(session.id)).emit('game:state', state);
        ack({ ok: true, state });
      } catch (error) {
        ack({ ok: false, error: error.message });
      }
    });

    socket.on('player:input', (payload, ack = () => {}) => {
      const parsed = inputSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_INPUT' });
      if (!socket.data.playerSessionId || !socket.data.playerToken) return ack({ ok: false, error: 'PLAYER_NOT_JOINED' });
      if (parsed.data.inputId <= socket.data.lastInputId) return ack({ ok: false, error: 'DUPLICATE_INPUT' });
      socket.data.lastInputId = parsed.data.inputId;
      try {
        const result = sessions.submitInput(
          socket.data.playerSessionId,
          socket.data.playerToken,
          parsed.data.action,
          parsed.data.roundId ?? null
        );
        const state = sessions.toPublicView(result.session);
        io.to(room(result.session.id)).emit('game:state', state);
        ack({
          ok: true, correct: result.correct, reset: result.reset,
          cycleCompleted: result.cycleCompleted, pointAwarded: result.pointAwarded || 0
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
