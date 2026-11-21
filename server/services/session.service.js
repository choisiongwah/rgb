import { randomBytes } from 'node:crypto';

const COLORS = ['RED', 'GREEN', 'BLUE'];
const SEQUENCE = ['R', 'G', 'B'];
const DEFAULT_TARGET_CYCLES = 20;
const MIN_TARGET_CYCLES = 1;
const MAX_TARGET_CYCLES = 100;
const POINTS_BY_PLACE = { 1: 5, 2: 3, 3: 1 };

export class SessionService {
  constructor() { this.sessions = new Map(); }

  create({ host }) {
    const id = randomBytes(4).toString('hex').toUpperCase();
    const session = {
      id, host, status: 'waiting', paused: false, createdAt: Date.now(),
      stage: 1, nextPlace: 1, controllerColor: null,
      targetCycles: DEFAULT_TARGET_CYCLES,
      players: COLORS.map((color) => ({
        color, token: randomBytes(24).toString('hex'), player: null,
        connected: false, joined: false, activeForRound: false,
        progressIndex: 0, cycles: 0, totalPoints: 0,
        completed: false, place: null, pointsEarned: 0
      }))
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) { return this.sessions.get(id); }
  getSlot(sessionId, token) {
    return this.get(sessionId)?.players.find((player) => player.token === token) || null;
  }

  join(id, token, profile) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const slot = this.getSlot(id, token);
    if (!slot) throw new Error('INVALID_JOIN_TOKEN');
    if (slot.connected) throw new Error('SLOT_OCCUPIED');

    const isReturningPlayer = slot.joined;
    slot.player = { name: String(profile.name || '').trim().slice(0, 20) || slot.player?.name || 'Player' };
    slot.connected = true;
    slot.joined = true;
    if (!session.controllerColor) session.controllerColor = slot.color;

    if (session.status === 'playing' && !isReturningPlayer) {
      slot.activeForRound = true;
      slot.progressIndex = 0;
      slot.cycles = 0;
      slot.completed = false;
      slot.place = null;
      slot.pointsEarned = 0;
    }
    return { session, slot, isReturningPlayer, isController: session.controllerColor === slot.color };
  }

  disconnect(id, token) {
    const slot = this.getSlot(id, token);
    if (!slot) return null;
    slot.connected = false;
    return { session: this.get(id), slot };
  }

  assertController(session, slot) {
    if (!slot || session.controllerColor !== slot.color) throw new Error('CONTROLLER_ONLY');
  }

  startLevel(id, token) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const slot = this.getSlot(id, token);
    this.assertController(session, slot);
    if (session.status === 'playing') throw new Error('LEVEL_ALREADY_RUNNING');
    if (session.status === 'finished') throw new Error('USE_NEXT_LEVEL');
    const participants = session.players.filter((player) => player.joined && player.connected);
    if (!participants.length) throw new Error('NO_PLAYERS');

    session.status = 'playing';
    session.paused = false;
    session.nextPlace = 1;
    for (const player of session.players) {
      player.activeForRound = participants.includes(player);
      player.progressIndex = 0;
      player.cycles = 0;
      player.completed = false;
      player.place = null;
      player.pointsEarned = 0;
    }
    return session;
  }

  submitInput(id, token, action) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const slot = this.getSlot(id, token);
    if (!slot || !slot.joined || !slot.connected) throw new Error('PLAYER_NOT_JOINED');
    if (session.status !== 'playing') throw new Error('LEVEL_NOT_RUNNING');
    if (session.paused) throw new Error('GAME_PAUSED');
    if (!slot.activeForRound) throw new Error('NOT_IN_THIS_LEVEL');
    if (slot.completed) throw new Error('PLAYER_ALREADY_FINISHED');

    const expected = SEQUENCE[slot.progressIndex];
    if (action !== expected) {
      slot.progressIndex = 0;
      return { session, slot, correct: false, reset: true, cycleCompleted: false };
    }

    slot.progressIndex += 1;
    let cycleCompleted = false;
    if (slot.progressIndex === SEQUENCE.length) {
      slot.progressIndex = 0;
      slot.cycles += 1;
      cycleCompleted = true;
      if (slot.cycles >= session.targetCycles) {
        slot.completed = true;
        slot.place = session.nextPlace++;
        slot.pointsEarned = POINTS_BY_PLACE[slot.place] || 0;
        slot.totalPoints += slot.pointsEarned;
      }
    }

    if (this.allActivePlayersFinished(session)) {
      session.status = 'finished';
      session.paused = false;
    }
    return { session, slot, correct: true, reset: false, cycleCompleted };
  }

  allActivePlayersFinished(session) {
    const active = session.players.filter((player) => player.activeForRound);
    return active.length > 0 && active.every((player) => player.completed);
  }

  finishLevel(id, token) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    this.assertController(session, this.getSlot(id, token));
    if (session.status !== 'playing') throw new Error('LEVEL_NOT_RUNNING');
    session.status = 'finished';
    session.paused = false;
    return session;
  }

  setPaused(id, paused) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.status !== 'playing') throw new Error('LEVEL_NOT_RUNNING');
    session.paused = paused;
    return session;
  }

  resetLevel(id, token) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    this.assertController(session, this.getSlot(id, token));
    if (session.status === 'waiting') throw new Error('LEVEL_NOT_RUNNING');

    for (const player of session.players) {
      player.totalPoints = Math.max(0, player.totalPoints - player.pointsEarned);
      player.activeForRound = false;
      player.progressIndex = 0;
      player.cycles = 0;
      player.completed = false;
      player.place = null;
      player.pointsEarned = 0;
    }
    session.status = 'waiting';
    session.paused = false;
    session.nextPlace = 1;
    return session;
  }

  configure(id, token, targetCycles) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    this.assertController(session, this.getSlot(id, token));
    if (session.status === 'playing') throw new Error('CONFIG_LOCKED_DURING_GAME');
    if (!Number.isInteger(targetCycles) || targetCycles < MIN_TARGET_CYCLES || targetCycles > MAX_TARGET_CYCLES) {
      throw new Error('INVALID_TARGET_CYCLES');
    }
    session.targetCycles = targetCycles;
    return session;
  }

  nextLevel(id) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.status !== 'finished') throw new Error('LEVEL_NOT_FINISHED');
    session.stage += 1;
    session.status = 'waiting';
    session.paused = false;
    session.nextPlace = 1;
    for (const player of session.players) {
      player.activeForRound = false;
      player.progressIndex = 0;
      player.cycles = 0;
      player.completed = false;
      player.place = null;
      player.pointsEarned = 0;
    }
    return session;
  }

  toPublicView(session) {
    return {
      id: session.id, status: session.status, paused: session.paused,
      stage: session.stage, targetCycles: session.targetCycles,
      controllerColor: session.controllerColor, sequence: SEQUENCE,
      players: session.players.map((player) => ({
        color: player.color, player: player.player, connected: player.connected,
        joined: player.joined, activeForRound: player.activeForRound,
        progressIndex: player.progressIndex, cycles: player.cycles,
        totalPoints: player.totalPoints, completed: player.completed,
        place: player.place, pointsEarned: player.pointsEarned
      }))
    };
  }

  toHostView(session) {
    const view = this.toPublicView(session);
    return {
      ...view,
      players: view.players.map((player) => ({
        ...player,
        joinToken: session.players.find((slot) => slot.color === player.color).token
      }))
    };
  }
}
