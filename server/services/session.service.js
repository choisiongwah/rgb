import { randomBytes, randomInt } from 'node:crypto';

const COLORS = ['RED', 'GREEN', 'BLUE'];
const SEQUENCE = ['R', 'G', 'B'];
const DEFAULT_TARGET_CYCLES = 20;
const MIN_TARGET_CYCLES = 1;
const MAX_TARGET_CYCLES = 100;
const DICE_TARGET = 8;
const POINTS_BY_PLACE = { 1: 5, 2: 3, 3: 1 };

function createDiceRoll() {
  const values = [];
  while (values.length < 3) {
    const value = randomInt(1, 7);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

export class SessionService {
  constructor({ diceRoll = createDiceRoll } = {}) {
    this.sessions = new Map();
    this.diceRoll = diceRoll;
  }

  create({ host }) {
    const id = randomBytes(4).toString('hex').toUpperCase();
    const session = {
      id, host, status: 'waiting', paused: false, createdAt: Date.now(),
      stage: 1, nextPlace: 1, controllerColor: null,
      targetCycles: DEFAULT_TARGET_CYCLES, diceTarget: DICE_TARGET,
      diceValues: null, diceRoundId: 0,
      players: COLORS.map((color) => ({
        color, token: randomBytes(24).toString('hex'), player: null,
        connected: false, joined: false, activeForRound: false,
        progressIndex: 0, cycles: 0, successCount: 0, roundAttempted: false,
        roundFeedback: null, successFeedbackId: 0, totalPoints: 0,
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
    const avatar = typeof profile.avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.avatar) && profile.avatar.length <= 180000
      ? profile.avatar : null;
    const character = ['astronaut', 'racer', 'hazmat'].includes(profile.character) ? profile.character : 'astronaut';
    slot.player = {
      name: String(profile.name || '').trim().slice(0, 20) || slot.player?.name || 'Player',
      character,
      avatar: avatar || slot.player?.avatar || null
    };
    slot.connected = true;
    slot.joined = true;
    if (!session.controllerColor) session.controllerColor = slot.color;

    if (session.status === 'playing' && !isReturningPlayer) {
      slot.activeForRound = true;
      slot.progressIndex = 0;
      slot.cycles = 0;
      slot.successCount = 0;
      slot.roundAttempted = false;
      slot.roundFeedback = null;
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
      player.successCount = 0;
      player.roundAttempted = false;
      player.roundFeedback = null;
      player.completed = false;
      player.place = null;
      player.pointsEarned = 0;
    }
    if (session.stage === 2) this.rollNextDiceRound(session);
    else session.diceValues = null;
    return session;
  }

  submitInput(id, token, action, diceRoundId = null) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const slot = this.getSlot(id, token);
    if (!slot || !slot.joined || !slot.connected) throw new Error('PLAYER_NOT_JOINED');
    if (session.status !== 'playing') throw new Error('LEVEL_NOT_RUNNING');
    if (session.paused) throw new Error('GAME_PAUSED');
    if (!slot.activeForRound) throw new Error('NOT_IN_THIS_LEVEL');
    if (slot.completed) throw new Error('PLAYER_ALREADY_FINISHED');

    if (session.stage === 2) {
      if (diceRoundId !== session.diceRoundId) throw new Error('STALE_ROUND');
      if (slot.roundAttempted) throw new Error('ALREADY_ANSWERED');
      const positions = { R: 0, G: 1, B: 2 };
      if (!(action in positions)) throw new Error('INVALID_INPUT');
      slot.roundAttempted = true;
      const largestIndex = session.diceValues.indexOf(Math.max(...session.diceValues));
      if (positions[action] !== largestIndex) {
        slot.roundFeedback = 'wrong';
        if (this.allDicePlayersAttempted(session)) this.rollNextDiceRound(session);
        return { session, slot, correct: false, reset: false, cycleCompleted: false };
      }

      slot.successCount += 1;
      slot.roundFeedback = 'correct';
      let cycleCompleted = false;
      if (slot.successCount >= session.diceTarget) {
        cycleCompleted = true;
        slot.completed = true;
        slot.place = session.nextPlace++;
        slot.pointsEarned = POINTS_BY_PLACE[slot.place] || 0;
        slot.totalPoints += slot.pointsEarned;
      }
      if (this.allActivePlayersFinished(session)) {
        session.status = 'finished';
        session.paused = false;
      } else {
        this.rollNextDiceRound(session, slot);
      }
      return { session, slot, correct: true, reset: false, cycleCompleted, pointAwarded: 1 };
    }

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

  rollNextDiceRound(session, winner = null) {
    session.diceValues = this.diceRoll();
    session.diceRoundId += 1;
    for (const player of session.players) {
      if (!player.activeForRound || player.completed) continue;
      player.roundAttempted = false;
      player.roundFeedback = player === winner ? 'correct' : null;
    }
  }

  allDicePlayersAttempted(session) {
    const remaining = session.players.filter((player) => player.activeForRound && !player.completed);
    return remaining.length > 0 && remaining.every((player) => !player.connected || player.roundAttempted);
  }

  allActivePlayersFinished(session) {
    const active = session.players.filter((player) => player.activeForRound);
    return active.length > 0 && active.every((player) => player.completed);
  }

  finishLevel(id, token) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    this.assertController(session, this.getSlot(id, token));
    if (session.stage === 2) throw new Error('FINISH_NOT_AVAILABLE');
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
      player.successCount = 0;
      player.roundAttempted = false;
      player.roundFeedback = null;
      player.completed = false;
      player.place = null;
      player.pointsEarned = 0;
    }
    session.status = 'waiting';
    session.paused = false;
    session.nextPlace = 1;
    session.diceValues = null;
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
    session.diceValues = null;
    for (const player of session.players) {
      player.activeForRound = false;
      player.progressIndex = 0;
      player.cycles = 0;
      player.successCount = 0;
      player.roundAttempted = false;
      player.roundFeedback = null;
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
      diceTarget: session.diceTarget, diceValues: session.diceValues,
      diceRoundId: session.diceRoundId,
      controllerColor: session.controllerColor, sequence: SEQUENCE,
      players: session.players.map((player) => ({
        color: player.color, player: player.player, connected: player.connected,
        joined: player.joined, activeForRound: player.activeForRound,
        progressIndex: player.progressIndex, cycles: player.cycles,
        successCount: player.successCount, roundAttempted: player.roundAttempted,
        roundFeedback: player.roundFeedback,
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
