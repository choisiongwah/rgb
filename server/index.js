import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { authRouter } from './routes/auth.routes.js';
import { createSessionRouter } from './routes/session.routes.js';
import { SessionService } from './services/session.service.js';
import { registerSocketHandlers } from './socket/register.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const sessions = new SessionService();

app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/config', (req, res) => {
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL;
  res.json({ publicBaseUrl: configuredBaseUrl || req.get('origin') || (req.protocol + '://' + req.get('host')) });
});
app.use('/api/auth', authRouter);
app.use('/api/sessions', createSessionRouter({ sessions }));
registerSocketHandlers(io, { sessions });

const raceTicker = setInterval(() => {
  for (const session of [...sessions.tickRaces(100), ...sessions.tickFlappy(100), ...sessions.tickUfos(100), ...sessions.tickIslands(100), ...sessions.tickBurgerStacks(100)]) {
    io.to('session:' + session.id).emit('game:state', sessions.toPublicView(session));
  }
}, 100);
raceTicker.unref?.();

// HitKnife uses a 150ms throw tween; a 50ms server tick resolves it on time.
const pieTicker = setInterval(() => {
  for (const session of sessions.tickPies(50)) {
    io.to('session:' + session.id).emit('game:state', sessions.toPublicView(session));
  }
}, 50);
pieTicker.unref?.();

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get('/player/*', (_req, res) => res.sendFile(path.join(dist, 'player/index.html')));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'host/index.html')));
}

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, process.env.HOST || '0.0.0.0', () => console.log('RGB server listening on ' + port));
export { app, httpServer, io, sessions };
