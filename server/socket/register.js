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
  z.object({ action: z.literal('configure'), target: z.number().int() })
]);
const room = (id) => 'session:' + id;
const hostRoom = (id) => 'session:' + id + ':host';

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
        socket.join(hostRoom(sessionId));
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
        const { action, target } = parsed.data;
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
        else if (action === 'configure') session = sessions.configure(id, token, target);
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
        if (result.correct === false || result.pointAwarded || result.cycleCompleted) {
          const feedback = result.correct === false
            ? ({ 1: 'Sequence restarted', 2: 'Wrong dice position', 5: 'Wrong ingredient', 6: 'Wrong UFO — watch the next one', 7: 'Missed the pie — try another colour', 8: 'Wrong shark colour — check the next step', 10: 'Wrong pattern position' }[result.session.stage] || 'Not quite — watch the main screen')
            : (result.cycleCompleted ? 'Challenge completed!' : 'Correct answer!');
          io.to(hostRoom(result.session.id)).emit('host:player-feedback', {
            color: result.slot.color,
            name: result.slot.player?.name || result.slot.color + ' Player',
            stage: result.session.stage,
            kind: result.correct === false ? 'wrong' : 'success',
            message: feedback
          });
        }
        ack({
          ok: true, correct: result.correct, reset: result.reset,
          cycleCompleted: result.cycleCompleted, pointAwarded: result.pointAwarded || 0
        });
      } catch (error) {
        const session = sessions.get(socket.data.playerSessionId);
        const slot = session?.players.find((player) => player.token === socket.data.playerToken);
        if (session && slot) {
          const messages = {
            GAME_PAUSED: 'Game paused — wait for the host',
            LEVEL_NOT_RUNNING: 'Wait for the host to start the level',
            PLAYER_ALREADY_FINISHED: 'You have completed this level',
            NOT_IN_THIS_LEVEL: 'You are not active in this level',
            RACE_PENALTY_ACTIVE: 'Crash! Recovering — 2 seconds',
            FLAPPY_RECOVERING: 'Rocket recovering — tap again shortly',
            BURGER_STACK_RECOVERING: 'Missed ingredient — recovering'
          };
          io.to(hostRoom(session.id)).emit('host:player-feedback', {
            color: slot.color,
            name: slot.player?.name || slot.color + ' Player',
            stage: session.stage,
            kind: 'warning',
            message: messages[error.message] || 'Input not accepted'
          });
        }
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
