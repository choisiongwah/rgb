import { describe, expect, it } from 'vitest';
import { SessionService } from '../server/services/session.service.js';

function createPlayingSession(count = 3) {
  const service = new SessionService();
  const session = service.create({ host: { username: 'admin', role: 'admin' } });
  const slots = session.players.slice(0, count);
  slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Player ' + (index + 1) }));
  service.startLevel(session.id);
  return { service, session, slots };
}
function completeCycles(service, session, slot, cycles = 20) {
  for (let i = 0; i < cycles; i += 1) {
    for (const action of ['R', 'G', 'B']) service.submitInput(session.id, slot.token, action);
  }
}

describe('SessionService RGB Sequence Rush', () => {
  it('creates three distinct player slots and join tokens', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    expect(session.players).toHaveLength(3);
    expect(new Set(session.players.map((p) => p.color)).size).toBe(3);
    expect(new Set(session.players.map((p) => p.token)).size).toBe(3);
  });
  it('resets only the current cycle after an incorrect colour', () => {
    const { service, session, slots } = createPlayingSession(1);
    service.submitInput(session.id, slots[0].token, 'R');
    service.submitInput(session.id, slots[0].token, 'G');
    const result = service.submitInput(session.id, slots[0].token, 'R');
    expect(result.correct).toBe(false);
    expect(result.reset).toBe(true);
    expect(slots[0].progressIndex).toBe(0);
    expect(slots[0].cycles).toBe(0);
  });
  it('awards 5, 3 and 1 points by finish order', () => {
    const { service, session, slots } = createPlayingSession(3);
    completeCycles(service, session, slots[0]);
    completeCycles(service, session, slots[1]);
    completeCycles(service, session, slots[2]);
    expect(slots.map((p) => p.pointsEarned)).toEqual([5, 3, 1]);
    expect(slots.map((p) => p.place)).toEqual([1, 2, 3]);
    expect(session.status).toBe('finished');
  });
  it('keeps cumulative points and resets cycle counts for the next level', () => {
    const { service, session, slots } = createPlayingSession(1);
    completeCycles(service, session, slots[0]);
    expect(slots[0].totalPoints).toBe(5);
    service.nextLevel(session.id);
    expect(session.stage).toBe(2);
    expect(session.status).toBe('waiting');
    expect(slots[0].cycles).toBe(0);
    expect(slots[0].totalPoints).toBe(5);
  });
  it('awards no points to players who do not finish before the host ends the level', () => {
    const { service, session, slots } = createPlayingSession(2);
    completeCycles(service, session, slots[0]);
    service.finishLevel(session.id);
    expect(slots[0].totalPoints).toBe(5);
    expect(slots[1].totalPoints).toBe(0);
    expect(slots[1].completed).toBe(false);
  });
  it('does not accept input while paused', () => {
    const { service, session, slots } = createPlayingSession(1);
    service.setPaused(session.id, true);
    expect(() => service.submitInput(session.id, slots[0].token, 'R')).toThrow('GAME_PAUSED');
  });
  it('preserves player progress and cumulative score after a reconnect', () => {
    const { service, session, slots } = createPlayingSession(1);
    service.submitInput(session.id, slots[0].token, 'R');
    service.submitInput(session.id, slots[0].token, 'G');
    service.disconnect(session.id, slots[0].token);
    service.join(session.id, slots[0].token, { name: 'Player 1' });
    expect(slots[0].progressIndex).toBe(2);
    expect(slots[0].activeForRound).toBe(true);
  });
});
