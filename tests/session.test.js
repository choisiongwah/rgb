import { describe, expect, it } from 'vitest';
import { SessionService } from '../server/services/session.service.js';

function createPlayingSession(count = 3) {
  const service = new SessionService();
  const session = service.create({ host: { username: 'admin', role: 'admin' } });
  const slots = session.players.slice(0, count);
  slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Player ' + (index + 1) }));
  service.startLevel(session.id, slots[0].token);
  return { service, session, slots };
}
function createLevel2Session(count = 3) {
  const service = new SessionService({ diceRoll: () => [4, 6, 2] });
  const session = service.create({ host: { username: 'admin', role: 'admin' } });
  const slots = session.players.slice(0, count);
  slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Player ' + (index + 1) }));
  service.startLevel(session.id, slots[0].token);
  service.finishLevel(session.id, slots[0].token);
  service.nextLevel(session.id);
  service.startLevel(session.id, slots[0].token);
  return { service, session, slots };
}

function createLevel3Session(count = 3, random = () => 0.99) {
  const service = new SessionService({ random });
  const session = service.create({ host: { username: 'admin', role: 'admin' } });
  const slots = session.players.slice(0, count);
  slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Racer ' + (index + 1) }));
  session.stage = 3;
  service.startLevel(session.id, slots[0].token);
  return { service, session, slots };
}

function completeCycles(service, session, slot, cycles = session.targetCycles) {
  for (let i = 0; i < cycles; i += 1) {
    for (const action of ['R', 'G', 'B']) service.submitInput(session.id, slot.token, action);
  }
}
function answerDice(service, session, slot, action = 'G') {
  return service.submitInput(session.id, slot.token, action, session.diceRoundId);
}

describe('SessionService RGB Sequence Rush', () => {
  it('lets the admin jump to any level and start it while preserving earlier level points', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const [slot] = session.players;
    service.join(session.id, slot.token, { name: 'Tester' });
    slot.totalPoints = 5;
    slot.pointsEarned = 0;
    session.stage = 4;
    session.status = 'finished';

    service.selectLevel(session.id, 'admin', 9);
    expect(session.stage).toBe(9);
    expect(session.status).toBe('waiting');
    expect(slot.totalPoints).toBe(5);
    expect(() => service.selectLevel(session.id, 'other-admin', 2)).toThrow('SESSION_NOT_FOUND');
    expect(() => service.selectLevel(session.id, 'admin', 11)).toThrow('INVALID_LEVEL');

    service.startLevel(session.id, slot.token);
    expect(session.stage).toBe(9);
    expect(session.status).toBe('playing');
    expect(slot.activeForRound).toBe(true);
  });

  it('removes only the current level award when the admin switches to a test level', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const [slot] = session.players;
    service.join(session.id, slot.token, { name: 'Tester' });
    slot.totalPoints = 8;
    slot.pointsEarned = 3;
    service.selectLevel(session.id, 'admin', 3);
    expect(slot.totalPoints).toBe(5);
    expect(slot.pointsEarned).toBe(0);
    expect(session.status).toBe('waiting');
  });

  it('stores an optional avatar and selected character on the player profile', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slot = session.players[0];
    const avatar = 'data:image/jpeg;base64,AAAA';
    service.join(session.id, slot.token, { name: 'Explorer', character: 'hazmat', avatar });
    const player = service.toPublicView(session).players[0];
    expect(player.player).toMatchObject({ name: 'Explorer', character: 'hazmat', avatar });
  });

  it('increments success feedback for every valid input but not wrong inputs', () => {
    const { service, session, slots } = createPlayingSession(1);
    expect(slots[0].successFeedbackId).toBe(0);
    service.submitInput(session.id, slots[0].token, 'R');
    expect(slots[0].successFeedbackId).toBe(1);
    service.submitInput(session.id, slots[0].token, 'B');
    expect(slots[0].successFeedbackId).toBe(1);
    service.submitInput(session.id, slots[0].token, 'R');
    expect(slots[0].successFeedbackId).toBe(2);
  });

  it('creates three distinct player slots and join tokens', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    expect(session.players).toHaveLength(3);
    expect(new Set(session.players.map((p) => p.color)).size).toBe(3);
    expect(new Set(session.players.map((p) => p.token)).size).toBe(3);
  });
  it('assigns controller privileges to the first player who joins', () => {
    const service = new SessionService();
    const session = service.create({ host: {} });
    const [red, green] = session.players;
    expect(service.join(session.id, green.token, { name: 'Green' }).isController).toBe(true);
    expect(service.join(session.id, red.token, { name: 'Red' }).isController).toBe(false);
    expect(session.controllerColor).toBe('GREEN');
  });
  it('allows any joined player to pause and move to the next finished level', () => {
    const { service, session, slots } = createPlayingSession(2);
    service.setPaused(session.id, true);
    expect(session.paused).toBe(true);
    service.setPaused(session.id, false);
    completeCycles(service, session, slots[0]);
    completeCycles(service, session, slots[1]);
    expect(session.status).toBe('finished');
    service.nextLevel(session.id);
    expect(session.stage).toBe(2);
  });
  it('restricts start, reset, finish and config to the first player', () => {
    const { service, session, slots } = createPlayingSession(2);
    expect(() => service.startLevel(session.id, slots[1].token)).toThrow('CONTROLLER_ONLY');
    expect(() => service.resetLevel(session.id, slots[1].token)).toThrow('CONTROLLER_ONLY');
    expect(() => service.configure(session.id, slots[1].token, 10)).toThrow('CONTROLLER_ONLY');
    expect(() => service.finishLevel(session.id, slots[1].token)).toThrow('CONTROLLER_ONLY');
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
  it('awards no points to players who do not finish before the controller ends the level', () => {
    const { service, session, slots } = createPlayingSession(2);
    completeCycles(service, session, slots[0]);
    service.finishLevel(session.id, slots[0].token);
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
  it('reset removes points awarded in the current level but keeps prior level totals', () => {
    const { service, session, slots } = createPlayingSession(1);
    completeCycles(service, session, slots[0]);
    expect(slots[0].totalPoints).toBe(5);
    service.resetLevel(session.id, slots[0].token);
    expect(slots[0].totalPoints).toBe(0);
    expect(slots[0].cycles).toBe(0);
    expect(session.status).toBe('waiting');
  });
  it('ends the game and returns everyone to Level 1 with a clean score', () => {
    const { service, session, slots } = createLevel2Session(2);
    slots[0].totalPoints = 5;
    slots[0].pointsEarned = 5;
    slots[0].successCount = 3;
    slots[1].totalPoints = 3;
    slots[1].pointsEarned = 3;
    slots[1].completed = true;
    slots[1].place = 2;
    session.status = 'finished';

    const result = service.endGame(session.id, slots[0].token);

    expect(result.stage).toBe(1);
    expect(result.status).toBe('waiting');
    expect(result.paused).toBe(false);
    expect(result.diceValues).toBeNull();
    expect(slots.map((player) => player.totalPoints)).toEqual([0, 0]);
    expect(slots.every((player) => player.joined)).toBe(true);
    expect(slots.every((player) => !player.completed && player.place === null)).toBe(true);
    expect(() => service.endGame(session.id, slots[1].token)).toThrow('CONTROLLER_ONLY');
  });

  it('supports configuring the cycle target before a level starts', () => {
    const { service, session, slots } = createPlayingSession(1);
    service.resetLevel(session.id, slots[0].token);
    service.configure(session.id, slots[0].token, 12);
    expect(session.targetCycles).toBe(12);
  });

  it('configures and publishes the winning target independently for every level', () => {
    const { service, session, slots } = createPlayingSession(1);
    service.resetLevel(session.id, slots[0].token);
    const targets = [
      ['targetCycles', 1, 12], ['diceTarget', 2, 6], ['raceTargetMeters', 3, 2400],
      ['flappyTargetBlockers', 4, 15], ['burgerTarget', 5, 4], ['ufoTarget', 6, 8],
      ['pieHitsPerColor', 7, 3], ['triTarget', 8, 40], ['burgerStackTarget', 9, 3],
      ['matrixTarget', 10, 5]
    ];
    for (const [field, stage, target] of targets) {
      session.stage = stage;
      session.status = 'waiting';
      service.configure(session.id, slots[0].token, target);
      expect(session[field]).toBe(target);
      expect(service.toPublicView(session)[field]).toBe(target);
    }
    expect(session.islandTarget).toBe(40);
    expect(slots[0].tri.pipes).toBeDefined();
  });
});

describe('SessionService Level 3 Highway Dodge', () => {
  it('starts each player in the centre lane with an independent race state', () => {
    const { service, session, slots } = createLevel3Session();
    const view = service.toPublicView(session);
    expect(view.players.map((player) => player.race.lane)).toEqual([1, 1, 1]);
    expect(view.players.map((player) => player.race.distanceMeters)).toEqual([0, 0, 0]);
    expect(view.players[0].race).not.toBe(view.players[1].race);
  });

  it('maps R, G and B to left, centre and right lanes', () => {
    const { service, session, slots } = createLevel3Session(1);
    service.submitInput(session.id, slots[0].token, 'R');
    expect(slots[0].race.lane).toBe(0);
    service.submitInput(session.id, slots[0].token, 'G');
    expect(slots[0].race.lane).toBe(1);
    service.submitInput(session.id, slots[0].token, 'B');
    expect(slots[0].race.lane).toBe(2);
  });

  it('advances distance at 100 metres per second and increases race speed', () => {
    const { service, session, slots } = createLevel3Session(1);
    service.tickRaces(500);
    service.tickRaces(500);
    expect(slots[0].race.distanceMeters).toBeCloseTo(101.25);
    expect(slots[0].race.speedMultiplier).toBeCloseTo(1.025);
    service.tickRaces(500);
    service.tickRaces(500);
    expect(slots[0].race.distanceMeters).toBeGreaterThan(200);
    expect(slots[0].race.speedMultiplier).toBeGreaterThan(1);
  });

  it('applies a two-second collision penalty and temporarily locks lane input', () => {
    const { service, session, slots } = createLevel3Session(1, () => 0.4);
    for (let i = 0; i < 7; i += 1) service.tickRaces(500);
    expect(slots[0].race.crashId).toBe(1);
    expect(slots[0].race.penaltyMs).toBe(2000);
    expect(() => service.submitInput(session.id, slots[0].token, 'R')).toThrow('RACE_PENALTY_ACTIVE');
    const distanceAtCrash = slots[0].race.distanceMeters;
    slots[0].race.obstacles = [];
    service.tickRaces(500);
    service.tickRaces(500);
    expect(slots[0].race.penaltyMs).toBe(1000);
    expect(slots[0].race.distanceMeters).toBe(distanceAtCrash);
    service.tickRaces(500);
    service.tickRaces(500);
    expect(slots[0].race.penaltyMs).toBe(0);
    service.submitInput(session.id, slots[0].token, 'R');
    expect(slots[0].race.lane).toBe(0);
  });

  it('continues the race after first place until all players finish', () => {
    const { service, session, slots } = createLevel3Session(3);
    slots[0].race.distanceMeters = 2999;
    service.tickRaces(500);
    expect(slots[0].place).toBe(1);
    expect(session.status).toBe('playing');
    expect(slots[1].completed).toBe(false);
    slots[1].race.distanceMeters = 2999;
    service.tickRaces(500);
    expect(slots[1].place).toBe(2);
    expect(session.status).toBe('playing');
    slots[2].race.distanceMeters = 2999;
    service.tickRaces(500);
    expect(slots.map((slot) => slot.place)).toEqual([1, 2, 3]);
    expect(slots.map((slot) => slot.pointsEarned)).toEqual([5, 3, 1]);
    expect(session.status).toBe('finished');
  });

  it('does not advance races while paused', () => {
    const { service, session, slots } = createLevel3Session(1);
    service.setPaused(session.id, true);
    service.tickRaces(1000);
    expect(slots[0].race.distanceMeters).toBe(0);
  });
});

describe('SessionService Level 2 Dice Reaction', () => {
  it('does not allow manual finish before second and third place are decided', () => {
    const { service, session, slots } = createLevel2Session();
    expect(() => service.finishLevel(session.id, slots[0].token)).toThrow('FINISH_NOT_AVAILABLE');
    expect(session.status).toBe('playing');
  });

  it('starts with three distinct dice values and publishes the current round id', () => {
    const { service, session } = createLevel2Session();
    expect(session.stage).toBe(2);
    expect(session.diceValues).toEqual([4, 6, 2]);
    expect(new Set(session.diceValues).size).toBe(3);
    expect(service.toPublicView(session).diceRoundId).toBe(session.diceRoundId);
    expect(session.diceTarget).toBe(6);
  });

  it('increments the shared success feedback counter for correct dice answers', () => {
    const { service, session, slots } = createLevel2Session(1);
    expect(slots[0].successFeedbackId).toBe(0);
    answerDice(service, session, slots[0], 'G');
    expect(slots[0].successFeedbackId).toBe(1);
    expect(service.toPublicView(session).players[0].successFeedbackId).toBe(1);
  });

  it('awards the point to the first player choosing the largest dice position', () => {
    const { service, session, slots } = createLevel2Session();
    const roundId = session.diceRoundId;
    const result = service.submitInput(session.id, slots[0].token, 'G', roundId);
    expect(result.correct).toBe(true);
    expect(result.pointAwarded).toBe(1);
    expect(slots[0].successCount).toBe(1);
    expect(session.diceRoundId).toBe(roundId + 1);
    expect(slots[1].roundAttempted).toBe(false);
  });

  it('marks a wrong answer and disqualifies that player for the current dice roll', () => {
    const { service, session, slots } = createLevel2Session();
    const roundId = session.diceRoundId;
    const result = service.submitInput(session.id, slots[0].token, 'R', roundId);
    expect(result.correct).toBe(false);
    expect(slots[0].roundFeedback).toBe('wrong');
    expect(slots[0].roundAttempted).toBe(true);
    expect(slots[0].successCount).toBe(0);
    expect(() => service.submitInput(session.id, slots[0].token, 'G', roundId)).toThrow('ALREADY_ANSWERED');
  });

  it('rerolls only after all remaining players have used their attempt', () => {
    const { service, session, slots } = createLevel2Session();
    const firstRound = session.diceRoundId;
    answerDice(service, session, slots[0], 'R');
    answerDice(service, session, slots[1], 'B');
    expect(session.diceRoundId).toBe(firstRound);
    answerDice(service, session, slots[2], 'R');
    expect(session.diceRoundId).toBe(firstRound + 1);
    expect(slots.every((player) => !player.roundAttempted)).toBe(true);
    expect(slots.every((player) => player.roundFeedback === null)).toBe(true);
  });

  it('rejects late taps from a dice roll that has already advanced', () => {
    const { service, session, slots } = createLevel2Session();
    const oldRound = session.diceRoundId;
    answerDice(service, session, slots[0], 'G');
    expect(() => service.submitInput(session.id, slots[1].token, 'G', oldRound)).toThrow('STALE_ROUND');
    expect(slots[1].successCount).toBe(0);
  });

  it('continues after first place so second and third place can finish', () => {
    const { service, session, slots } = createLevel2Session();
    for (let i = 0; i < session.diceTarget; i += 1) answerDice(service, session, slots[0], 'G');
    expect(slots[0].place).toBe(1);
    expect(slots[0].successCount).toBe(session.diceTarget);
    expect(session.status).toBe('playing');
    for (let i = 0; i < session.diceTarget; i += 1) answerDice(service, session, slots[1], 'G');
    expect(slots[1].place).toBe(2);
    expect(session.status).toBe('playing');
    for (let i = 0; i < session.diceTarget; i += 1) answerDice(service, session, slots[2], 'G');
    expect(slots[2].place).toBe(3);
    expect(session.status).toBe('finished');
    expect(slots.map((player) => player.pointsEarned)).toEqual([5, 3, 1]);
    expect(slots.map((player) => player.totalPoints)).toEqual([5, 3, 1]);
  });

  it('rolls again when every connected remaining player has been disqualified', () => {
    const { service, session, slots } = createLevel2Session();
    const firstRound = session.diceRoundId;
    answerDice(service, session, slots[0], 'R');
    answerDice(service, session, slots[1], 'B');
    answerDice(service, session, slots[2], 'R');
    expect(session.diceRoundId).toBe(firstRound + 1);
    expect(slots.every((player) => !player.roundAttempted)).toBe(true);
  });
});


describe('SessionService Level 4 Rocket Flight', () => {
  function createLevel4Session(count = 3, random = () => 0.5) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Pilot ' + (index + 1) }));
    session.stage = 4;
    service.startLevel(session.id, slots[0].token);
    return { service, session, slots };
  }
  it('initializes independent flight state for each joined pilot', () => {
    const { service, session } = createLevel4Session();
    const view = service.toPublicView(session);
    expect(view.players.map((player) => player.flappy.blockersPassed)).toEqual([0, 0, 0]);
    expect(view.players[0].flappy).not.toBe(view.players[1].flappy);
  });
  it('accepts jump input and rejects lane controls', () => {
    const { service, session, slots } = createLevel4Session(1);
    expect(service.submitInput(session.id, slots[0].token, 'JUMP').jumped).toBe(true);
    expect(slots[0].flappy.velocity).toBeLessThan(0);
    expect(() => service.submitInput(session.id, slots[0].token, 'R')).toThrow('INVALID_INPUT');
  });
  it('moves obstacles faster after blocker 6', () => {
    const { service, slots } = createLevel4Session(1);
    const flight = slots[0].flappy;
    flight.obstacles = [{ id: 1, x: 0.8, gapY: 0.5, drift: 0, passed: false }];
    service.tickFlappy(100);
    const easyDistance = 0.8 - flight.obstacles[0].x;
    flight.blockersPassed = 6;
    flight.obstacles[0].x = 0.8;
    service.tickFlappy(100);
    expect(0.8 - flight.obstacles[0].x).toBeGreaterThan(easyDistance);
  });
  it('keeps the level running after first and second place, then awards all placements', () => {
    const { service, session, slots } = createLevel4Session();
    for (let i = 0; i < 3; i += 1) {
      const flight = slots[i].flappy;
      flight.blockersPassed = 19;
      flight.obstacles = [{ id: 1, x: 0.21, gapY: 0.5, drift: 0, passed: false }];
      flight.y = 0.5;
      service.tickFlappy(100);
      expect(slots[i].place).toBe(i + 1);
      expect(session.status).toBe(i === 2 ? 'finished' : 'playing');
    }
    expect(slots.map((slot) => slot.pointsEarned)).toEqual([5, 3, 1]);
  });
  it('does not advance flight while paused', () => {
    const { service, session, slots } = createLevel4Session(1);
    service.setPaused(session.id, true);
    service.tickFlappy(1000);
    expect(slots[0].flappy.y).toBe(0.5);
  });
});


describe('SessionService Level 5 Burger Builder', () => {
  function createLevel5Session(count = 3, random = () => 0.2) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Chef ' + (index + 1) }));
    session.stage = 5;
    service.startLevel(session.id, slots[0].token);
    return { service, session, slots };
  }
  function completeBurger(service, session, slot) {
    const roundId = session.burgerRoundId;
    for (const action of [...session.burgerSequence].reverse()) {
      service.submitInput(session.id, slot.token, action, roundId);
    }
  }
  it('creates a shared three-colour recipe and publishes its round id', () => {
    const { service, session } = createLevel5Session();
    const view = service.toPublicView(session);
    expect(session.burgerSequence.length).toBeGreaterThanOrEqual(4);
    expect(session.burgerSequence.length).toBeLessThanOrEqual(8);
    expect(session.burgerSequence.every((item) => ['R', 'G', 'B'].includes(item))).toBe(true);
    expect(view.burgerRoundId).toBe(session.burgerRoundId);
    expect(view.burgerTarget).toBe(6);
  });
  it('maps R/G/B to meat, vegetable and tomato drops', () => {
    let randomIndex = 0;
    const random = () => [0, 0, 0.4, 0.8, 0][randomIndex++ % 5];
    const { service, session, slots } = createLevel5Session(2, random);
    const roundId = session.burgerRoundId;
    session.burgerSequence = ['B', 'G', 'R'];
    service.submitInput(session.id, slots[0].token, 'R', roundId);
    expect(session.burgerLastDrop).toMatchObject({ action: 'R', ingredient: '🥩', color: 'RED' });
    service.submitInput(session.id, slots[0].token, 'G', roundId);
    expect(session.burgerLastDrop.ingredient).toBe('🥬');
    service.submitInput(session.id, slots[0].token, 'B', roundId);
    expect(session.burgerLastDrop.ingredient).toBe('🍅');
  });
  it('rejects incorrect recipe input and advances the shared round after all attempts', () => {
    const { service, session, slots } = createLevel5Session(2, () => 0);
    const round = session.burgerRoundId;
    const wrong = service.submitInput(session.id, slots[0].token, 'G', round);
    expect(wrong.correct).toBe(false);
    expect(slots[0].burgerRoundAttempted).toBe(true);
    expect(() => service.submitInput(session.id, slots[0].token, 'R', round)).toThrow('ALREADY_ANSWERED');
    completeBurger(service, session, slots[1]);
    expect(session.burgerRoundId).toBe(round + 1);
    expect(slots[0].burgerRoundAttempted).toBe(false);
    expect(slots[0].burgerProgressIndex).toBe(0);
  });
  it('awards placements at the configured burger target and stops accepting completed-player input', () => {
    const { service, session, slots } = createLevel5Session();
    for (let i = 0; i < session.burgerTarget; i += 1) completeBurger(service, session, slots[0]);
    expect(slots[0].place).toBe(1);
    expect(session.status).toBe('playing');
    expect(() => service.submitInput(session.id, slots[0].token, 'R', session.burgerRoundId)).toThrow('PLAYER_ALREADY_FINISHED');
    for (let i = 0; i < session.burgerTarget; i += 1) completeBurger(service, session, slots[1]);
    for (let i = 0; i < session.burgerTarget; i += 1) completeBurger(service, session, slots[2]);
    expect(slots.map((slot) => slot.place)).toEqual([1, 2, 3]);
    expect(slots.map((slot) => slot.pointsEarned)).toEqual([5, 3, 1]);
    expect(session.status).toBe('finished');
  });
  it('does not allow manual finish before all placements are decided', () => {
    const { service, session, slots } = createLevel5Session();
    expect(() => service.finishLevel(session.id, slots[0].token)).toThrow('FINISH_NOT_AVAILABLE');
  });
});

describe('SessionService Level 6 UFO Spotter', () => {
  function createLevel6Session(count = 3, random = () => 0.37) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Pilot ' + (index + 1) }));
    session.stage = 6;
    service.startLevel(session.id, slots[0].token);
    return { service, session, slots };
  }
  function revealChoices(service) {
    service.tickUfos(500);
    service.tickUfos(100);
  }
  function answerCorrectly(service, session, slot) {
    revealChoices(service);
    return service.submitInput(session.id, slot.token, ['R', 'G', 'B'][session.ufoCorrectIndex], session.ufoRoundId);
  }
  it('starts the Alien fly-through with three distinct choices and its configured round duration', () => {
    const { service, session } = createLevel6Session();
    const view = service.toPublicView(session);
    expect(session.ufoPhase).toBe('flyby');
    expect(session.ufoDurationMs).toBe(2800);
    expect(session.ufoOptions).toHaveLength(3);
    expect(new Set(session.ufoOptions).size).toBe(3);
    expect(view.ufoRoundId).toBe(session.ufoRoundId);
  });
  it('reveals the choices after the fly-through portion completes', () => {
    const { service, session } = createLevel6Session(1);
    service.tickUfos(500);
    expect(session.ufoPhase).toBe('flyby');
    service.tickUfos(100);
    expect(session.ufoPhase).toBe('choose');
  });
  it('starts another Alien fly-through when the round times out unanswered', () => {
    const { service, session } = createLevel6Session(1);
    const firstRound = session.ufoRoundId;
    service.tickUfos(500);
    service.tickUfos(500);
    service.tickUfos(500);
    service.tickUfos(500);
    service.tickUfos(500);
    service.tickUfos(300);
    expect(session.ufoRoundId).toBe(firstRound + 1);
    expect(session.ufoPhase).toBe('flyby');
  });
  it('awards a point, shows feedback, then starts the next cycle', () => {
    const { service, session, slots } = createLevel6Session(2);
    const oldRound = session.ufoRoundId;
    const result = answerCorrectly(service, session, slots[0]);
    expect(result.correct).toBe(true);
    expect(result.pointAwarded).toBe(1);
    expect(slots[0].successCount).toBe(1);
    expect(session.ufoPhase).toBe('feedback');
    service.tickUfos(1000);
    expect(session.ufoRoundId).toBe(oldRound + 1);
    expect(session.ufoPhase).toBe('flyby');
  });
  it('continues placements until all players reach the configured target', () => {
    const { service, session, slots } = createLevel6Session();
    for (let playerIndex = 0; playerIndex < slots.length; playerIndex += 1) {
      while (!slots[playerIndex].completed) {
        const result = answerCorrectly(service, session, slots[playerIndex]);
        expect(result.correct).toBe(true);
        if (!slots[playerIndex].completed) service.tickUfos(1000);
      }
      expect(slots[playerIndex].place).toBe(playerIndex + 1);
      expect(session.status).toBe(playerIndex === 2 ? 'finished' : 'playing');
    }
    expect(slots.map((slot) => slot.pointsEarned)).toEqual([5, 3, 1]);
  });
  it('does not allow manual finish before all placements are decided', () => {
    const { service, session, slots } = createLevel6Session();
    expect(() => service.finishLevel(session.id, slots[0].token)).toThrow('FINISH_NOT_AVAILABLE');
  });
});

describe('SessionService Level 7 RGB Knife Hit', () => {
  function createLevel7Session(count = 3, random = () => 0.25) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Player ' + (index + 1) }));
    session.stage = 7;
    service.startLevel(session.id, slots[0].token);
    session.pieSpeed = 0;
    return { service, session, slots };
  }
  function impact(service, session, slot, color) {
    session.pieAngle = 0;
    const target = service.toPublicView(session).pieTargetColor;
    const result = service.submitInput(session.id, slot.token, color || target);
    service.tickPies(150);
    return result;
  }
  it('publishes an RGB wheel and independent per-colour hit counts', () => {
    const { service, session, slots } = createLevel7Session();
    const view = service.toPublicView(session);
    expect(view.pieTargetColor).toBeDefined();
    expect(view.pieSpeed).toBe(0);
    expect(slots[0].pieHits).toEqual({ R: 0, G: 0, B: 0 });
  });
  it('rotates while playing and stops while paused', () => {
    const { service, session } = createLevel7Session();
    session.pieSpeed = 0.9;
    service.tickPies(500);
    expect(session.pieAngle).toBeCloseTo(0.45);
    service.setPaused(session.id, true);
    const angle = session.pieAngle;
    service.tickPies(500);
    expect(session.pieAngle).toBe(angle);
  });
  it('resolves a knife throw on impact and rejects an occupied position', () => {
    const { service, session, slots } = createLevel7Session(1);
    const target = service.toPublicView(session).pieTargetColor;
    const pending = service.submitInput(session.id, slots[0].token, target);
    expect(pending.pending).toBe(true);
    expect(slots[0].pieThrow.phase).toBe('flying');
    service.tickPies(150);
    expect(slots[0].pieHits[target]).toBe(1);
    expect(slots[0].pieThrow).toBeNull();
    const repeated = service.submitInput(session.id, slots[0].token, target);
    expect(repeated.pending).toBe(true);
    service.tickPies(150);
    expect(slots[0].pieThrow.phase).toBe('falling');
    expect(slots[0].pieThrow.occupied).toBe(true);
    service.tickPies(600);
    expect(slots[0].pieThrow).toBeNull();
    expect(slots[0].pieKnives).toHaveLength(1);
  });
  it('rejects a wrong-colour throw after the animated impact', () => {
    const { service, session, slots } = createLevel7Session(1);
    const target = service.toPublicView(session).pieTargetColor;
    const wrong = ['R', 'G', 'B'].find((color) => color !== target);
    service.submitInput(session.id, slots[0].token, wrong);
    service.tickPies(150);
    expect(slots[0].pieHits[wrong]).toBe(0);
    expect(slots[0].pieThrow.phase).toBe('falling');
    service.tickPies(600);
    expect(slots[0].pieThrow).toBeNull();
  });
  it('uses the configured hits-per-colour target for completion', () => {
    const { service, session, slots } = createLevel7Session(1);
    session.pieHitsPerColor = 1;
    for (const color of ['R', 'G', 'B']) {
      const candidates = Array.from({ length: 360 }, (_, index) => index * Math.PI * 2 / 360)
        .filter((angle) => {
          session.pieAngle = angle;
          return service.toPublicView(session).pieTargetColor === color;
        });
      const angle = candidates.find((candidate) => slots[0].pieKnives.every((knife) => {
        const impactAngle = Math.PI / 2 + candidate;
        const difference = Math.abs(((knife.angle - impactAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return Math.min(difference, Math.PI * 2 - difference) >= Math.PI / 18;
      }));
      expect(angle).toBeDefined();
      session.pieAngle = angle - Math.PI / 2;
      const target = service.toPublicView(session).pieTargetColor;
      service.submitInput(session.id, slots[0].token, target);
      service.tickPies(150);
    }
    expect(slots[0].completed).toBe(true);
    expect(slots[0].place).toBe(1);
    expect(session.status).toBe('finished');
  });
});

describe('SessionService Level 8 Island Crossing', () => {
  function createLevel8Session(count = 3, random = () => 0.1) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Crossing ' + (index + 1) }));
    session.stage = 8;
    service.startLevel(session.id, slots[0].token);
    return { service, session, slots };
  }
  function submitNextPipe(service, session, slot) {
    const next = slot.tri.pipes
      .filter((pipe) => pipe.x > 132 / 600 && pipe.x < 1)
      .sort((a, b) => a.x - b.x)[0];
    if (!next) throw new Error('No next pipe available in test setup');
    return service.submitInput(session.id, slot.token, next.color);
  }
  it('creates the configured course with a six-pipe visible window', () => {
    const { service, session, slots } = createLevel8Session();
    expect(slots[0].tri.pipes).toHaveLength(6);
    expect(service.toPublicView(session).triTarget).toBe(50);
    expect(slots[0].tri.pipes.every((pipe) => ['R', 'G', 'B'].includes(pipe.color))).toBe(true);
  });
  it('advances through matching coloured pipes and increments course score as pipes clear', () => {
    const { service, session, slots } = createLevel8Session(1);
    const player = slots[0];
    for (let i = 0; i < 3; i += 1) submitNextPipe(service, session, player);
    expect(player.tri.score).toBe(1);
    expect(player.successCount).toBe(1);
    expect(player.tri.shift).toBe(3);
  });
  it('rejects a mismatched colour without advancing the course', () => {
    const { service, session, slots } = createLevel8Session(1, () => 0);
    const player = slots[0];
    const next = player.tri.pipes.filter((pipe) => pipe.x > 132 / 600 && pipe.x < 1).sort((a, b) => a.x - b.x)[0];
    const wrong = ['R', 'G', 'B'].find((color) => color !== next.color);
    const result = service.submitInput(session.id, player.token, wrong);
    expect(result.correct).toBe(false);
    expect(player.tri.shift).toBe(0);
    expect(player.tri.score).toBe(0);
  });
  it('finishes exactly at the configured course target and clears remaining pipes', () => {
    const { service, session, slots } = createLevel8Session(1);
    session.triTarget = 2;
    slots[0].tri = {
      pipes: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, color: 'R', x: 0.34 + index / 6 })),
      nextId: 7, score: 0, shift: 0, lastCorrectId: 0
    };
    while (!slots[0].completed) submitNextPipe(service, session, slots[0]);
    expect(slots[0].tri.score).toBe(2);
    expect(slots[0].tri.pipes).toHaveLength(0);
    expect(session.status).toBe('finished');
  });
});

describe('SessionService Level 9 Burger Stack', () => {
  function createLevel9Session(count = 3, random = () => 0.1) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Stacker ' + (index + 1) }));
    session.stage = 9;
    service.startLevel(session.id, slots[0].token);
    return { service, session, slots };
  }
  it('creates independent 5-to-8 ingredient challenges and exposes the configured win target', () => {
    const { service, session, slots } = createLevel9Session();
    for (const slot of slots) {
      expect(slot.burgerStack.challengeLength).toBeGreaterThanOrEqual(5);
      expect(slot.burgerStack.challengeLength).toBeLessThanOrEqual(8);
      expect(slot.burgerStack.recipe).toHaveLength(slot.burgerStack.challengeLength);
      expect(slot.burgerStack.lane).toBe(1);
    }
    const view = service.toPublicView(session);
    expect(view.burgerStackTarget).toBe(4);
    expect(view.players[0].burgerStack).not.toBe(view.players[1].burgerStack);
  });
  it('moves one lane per R/B input and clamps at both edges', () => {
    const { service, session, slots } = createLevel9Session(1);
    expect(service.submitInput(session.id, slots[0].token, 'R').lane).toBe(0);
    expect(service.submitInput(session.id, slots[0].token, 'R').lane).toBe(0);
    expect(service.submitInput(session.id, slots[0].token, 'B').lane).toBe(1);
    expect(service.submitInput(session.id, slots[0].token, 'B').lane).toBe(2);
    expect(() => service.submitInput(session.id, slots[0].token, 'G')).toThrow('INVALID_INPUT');
  });
  it('does not advance falling ingredients while paused', () => {
    const { service, session, slots } = createLevel9Session(1);
    const stack = slots[0].burgerStack;
    stack.spawnAccumulator = 0.8;
    service.setPaused(session.id, true);
    service.tickBurgerStacks(500);
    expect(stack.drops).toHaveLength(0);
    expect(stack.nextIngredientIndex).toBe(0);
  });
});


describe('SessionService Level 10 Matrix Master', () => {
  function createLevel10Session(count = 3, random = () => 0.37) {
    const service = new SessionService({ random });
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players.slice(0, count);
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: 'Solver ' + (index + 1) }));
    session.stage = 10;
    service.startLevel(session.id, slots[0].token);
    return { service, session, slots };
  }
  const correctAction = (session) => ['R', 'G', 'B'][session.matrixPuzzle.correctIndex];
  it('publishes a 3x3 matrix with a missing final cell and three distinct choices', () => {
    const { service, session } = createLevel10Session();
    const view = service.toPublicView(session);
    expect(view.matrixTarget).toBe(6);
    expect(view.matrixPuzzle.cells).toHaveLength(8);
    expect(view.matrixPuzzle.options).toHaveLength(3);
    expect(new Set(view.matrixPuzzle.options).size).toBe(3);
    expect(view.matrixPuzzle).not.toHaveProperty('correctIndex');
  });
  it('rotates through mixed puzzle families with progressive difficulty', () => {
    const { service, session, slots } = createLevel10Session(1);
    const categories = [];
    for (let i = 0; i < 6; i += 1) {
      categories.push(session.matrixPuzzle.category);
      service.submitInput(session.id, slots[0].token, correctAction(session), session.matrixRoundId);
    }
    expect(new Set(categories).size).toBe(4);
    expect(session.matrixPuzzle.difficulty).toBe(3);
  });
  it('rejects a stale answer and prevents a player answering twice in one round', () => {
    const { service, session, slots } = createLevel10Session(2);
    const roundId = session.matrixRoundId;
    const wrong = ['R', 'G', 'B'].find((action) => action !== correctAction(session));
    expect(service.submitInput(session.id, slots[0].token, wrong, roundId).correct).toBe(false);
    expect(() => service.submitInput(session.id, slots[0].token, wrong, roundId)).toThrow('ALREADY_ANSWERED');
    expect(() => service.submitInput(session.id, slots[1].token, correctAction(session), roundId - 1)).toThrow('STALE_MATRIX_ROUND');
  });
  it('starts a new shared puzzle after a correct answer and clears other players round elimination', () => {
    const { service, session, slots } = createLevel10Session(2);
    const oldRound = session.matrixRoundId;
    const wrong = ['R', 'G', 'B'].find((action) => action !== correctAction(session));
    service.submitInput(session.id, slots[1].token, wrong, oldRound);
    service.submitInput(session.id, slots[0].token, correctAction(session), oldRound);
    expect(session.matrixRoundId).toBe(oldRound + 1);
    expect(slots[1].matrixRoundAttempted).toBe(false);
    expect(slots[0].successCount).toBe(1);
  });
  it('awards first, second and third place after six correct answers each', () => {
    const { service, session, slots } = createLevel10Session();
    for (let player = 0; player < 3; player += 1) {
      for (let answer = 0; answer < 6; answer += 1) {
        service.submitInput(session.id, slots[player].token, correctAction(session), session.matrixRoundId);
      }
      expect(slots[player].completed).toBe(true);
      expect(slots[player].place).toBe(player + 1);
      expect(session.status).toBe(player === 2 ? 'finished' : 'playing');
    }
    expect(slots.map((slot) => slot.pointsEarned)).toEqual([5, 3, 1]);
  });
  it('advances when all remaining players answer incorrectly and blocks manual finish', () => {
    const { service, session, slots } = createLevel10Session(2);
    const round = session.matrixRoundId;
    const wrong = ['R', 'G', 'B'].find((action) => action !== correctAction(session));
    service.submitInput(session.id, slots[0].token, wrong, round);
    service.submitInput(session.id, slots[1].token, wrong, round);
    expect(session.matrixRoundId).toBe(round + 1);
    expect(() => service.finishLevel(session.id, slots[0].token)).toThrow('FINISH_NOT_AVAILABLE');
  });
});


describe('Tournament final results review', () => {
  it('preserves points across levels and ranks players by accumulated points', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    const slots = session.players;
    slots.forEach((slot, index) => service.join(session.id, slot.token, { name: ['Alex', 'Blair', 'Casey'][index] }));
    slots[0].totalPoints = 18;
    slots[1].totalPoints = 24;
    slots[2].totalPoints = 12;
    session.stage = 10;
    session.status = 'finished';
    const results = service.reviewResults(session.id);
    expect(results.status).toBe('results');
    expect(results.finalResults.map((player) => player.name)).toEqual(['Blair', 'Alex', 'Casey']);
    expect(results.finalResults.map((player) => player.totalPoints)).toEqual([24, 18, 12]);
    expect(service.toPublicView(results).finalResults[0]).toMatchObject({ rank: 1, totalPoints: 24 });
  });

  it('does not allow reviewing before Level 10 is complete', () => {
    const service = new SessionService();
    const session = service.create({ host: { username: 'admin', role: 'admin' } });
    session.stage = 10;
    session.status = 'playing';
    expect(() => service.reviewResults(session.id)).toThrow('RESULTS_NOT_READY');
    session.status = 'finished';
    session.stage = 9;
    expect(() => service.reviewResults(session.id)).toThrow('RESULTS_NOT_READY');
  });

  it('keeps tournament totals when moving to the next level', () => {
    const { service, session, slots } = createPlayingSession(2);
    slots[0].totalPoints = 17;
    session.status = 'finished';
    service.nextLevel(session.id);
    expect(slots[0].totalPoints).toBe(17);
    expect(slots[1].totalPoints).toBe(0);
  });
});
