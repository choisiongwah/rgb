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

function completeCycles(service, session, slot, cycles = 20) {
  for (let i = 0; i < cycles; i += 1) {
    for (const action of ['R', 'G', 'B']) service.submitInput(session.id, slot.token, action);
  }
}
function answerDice(service, session, slot, action = 'G') {
  return service.submitInput(session.id, slot.token, action, session.diceRoundId);
}

describe('SessionService RGB Sequence Rush', () => {
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
    expect(session.diceTarget).toBe(8);
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
    for (let i = 0; i < 8; i += 1) answerDice(service, session, slots[0], 'G');
    expect(slots[0].place).toBe(1);
    expect(slots[0].successCount).toBe(8);
    expect(session.status).toBe('playing');
    for (let i = 0; i < 8; i += 1) answerDice(service, session, slots[1], 'G');
    expect(slots[1].place).toBe(2);
    expect(session.status).toBe('playing');
    for (let i = 0; i < 8; i += 1) answerDice(service, session, slots[2], 'G');
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
    for (const action of session.burgerSequence) {
      service.submitInput(session.id, slot.token, action, roundId);
    }
  }
  it('creates a random four-to-eight-ingredient shared recipe and publishes a round id', () => {
    const { service, session } = createLevel5Session();
    const view = service.toPublicView(session);
    expect(session.burgerSequence.length).toBeGreaterThanOrEqual(4);
    expect(session.burgerSequence.length).toBeLessThanOrEqual(8);
    expect(session.burgerSequence.every((item) => ['R', 'G', 'B'].includes(item))).toBe(true);
    expect(view.burgerRoundId).toBe(session.burgerRoundId);
    expect(view.burgerTarget).toBe(6);
  });
  it('enforces the four-ingredient minimum and eight-ingredient maximum', () => {
    const min = createLevel5Session(2, () => 0);
    expect(min.session.burgerSequence).toHaveLength(4);
    const max = createLevel5Session(2, () => 0.999999);
    expect(max.session.burgerSequence).toHaveLength(8);
  });
  it('maps R/G/B to meat, vegetable and tomato drops for each input', () => {
    let randomIndex = 0;
    const random = () => [0, 0, 0.4, 0.8, 0][randomIndex++ % 5];
    const { service, session, slots } = createLevel5Session(2, random);
    const roundId = session.burgerRoundId;
    service.submitInput(session.id, slots[0].token, 'R', roundId);
    expect(session.burgerLastDrop).toMatchObject({ action: 'R', ingredient: '🥩', color: 'RED' });
    service.submitInput(session.id, slots[0].token, 'G', roundId);
    expect(session.burgerLastDrop.ingredient).toBe('🥬');
    service.submitInput(session.id, slots[0].token, 'B', roundId);
    expect(session.burgerLastDrop.ingredient).toBe('🍅');
  });
  it('disqualifies a wrong answer for that recipe and resets on the next recipe', () => {
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
  it('awards one point to the first player completing the recipe and rejects late taps', () => {
    const { service, session, slots } = createLevel5Session(2, () => 0);
    const oldRound = session.burgerRoundId;
    completeBurger(service, session, slots[0]);
    expect(slots[0].successCount).toBe(1);
    expect(slots[0].totalPoints).toBe(0); // Placement bonus is added when the player finishes the level.
    expect(session.burgerRoundId).toBe(oldRound + 1);
    expect(() => service.submitInput(session.id, slots[1].token, 'R', oldRound)).toThrow('STALE_BURGER_ROUND');
  });
  it('continues to 2nd and 3rd place after each player reaches six burgers', () => {
    const { service, session, slots } = createLevel5Session();
    for (let i = 0; i < 6; i += 1) completeBurger(service, session, slots[0]);
    expect(slots[0].place).toBe(1);
    expect(session.status).toBe('playing');
    for (let i = 0; i < 6; i += 1) completeBurger(service, session, slots[1]);
    expect(slots[1].place).toBe(2);
    expect(session.status).toBe('playing');
    for (let i = 0; i < 6; i += 1) completeBurger(service, session, slots[2]);
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
  function createLevel6Session(count=3, random=()=>0.37) {
    const service=new SessionService({random}); const session=service.create({host:{username:'admin',role:'admin'}});
    const slots=session.players.slice(0,count); slots.forEach((slot,i)=>service.join(session.id,slot.token,{name:'Pilot '+(i+1)}));
    session.stage=6; service.startLevel(session.id,slots[0].token); return {service,session,slots};
  }
  const reveal=(service)=>{for(let i=0;i<4;i++)service.tickUfos(500);};
  it('starts with a two-second fly-by and three distinct choices',()=>{
    const {service,session}=createLevel6Session(); const view=service.toPublicView(session);
    expect(session.ufoPhase).toBe('flyby'); expect(session.ufoDurationMs).toBe(2000);
    expect(session.ufoOptions).toHaveLength(3); expect(new Set(session.ufoOptions).size).toBe(3);
    expect(view.ufoRoundId).toBe(session.ufoRoundId);
  });
  it('reveals the choices only after the full fly-through',()=>{
    const {service,session}=createLevel6Session(1);
    service.tickUfos(500);service.tickUfos(500);service.tickUfos(500);service.tickUfos(499);
    expect(session.ufoPhase).toBe('flyby');service.tickUfos(1);expect(session.ufoPhase).toBe('choose');
  });
  it('increases speed every four cycles and caps at 0.5 seconds',()=>{
    const {service,session}=createLevel6Session(1);
    for(let i=0;i<4;i++)service.rollNextUfoRound(session);expect(session.ufoDurationMs).toBe(1500);
    for(let i=0;i<4;i++)service.rollNextUfoRound(session);expect(session.ufoDurationMs).toBe(1000);
    for(let i=0;i<4;i++)service.rollNextUfoRound(session);expect(session.ufoDurationMs).toBe(500);
    for(let i=0;i<8;i++)service.rollNextUfoRound(session);expect(session.ufoDurationMs).toBe(500);
  });
  it('awards a point for the matching option and immediately starts the next cycle',()=>{
    const {service,session,slots}=createLevel6Session(2);reveal(service);const old=session.ufoRoundId;
    const result=service.submitInput(session.id,slots[0].token,['R','G','B'][session.ufoCorrectIndex],old);
    expect(result.correct).toBe(true);expect(result.pointAwarded).toBe(1);expect(slots[0].successCount).toBe(1);expect(session.ufoRoundId).toBe(old+1);
  });
  it('disqualifies a wrong answer for the current cycle',()=>{
    const {service,session,slots}=createLevel6Session(2);reveal(service);
    const wrong=['R','G','B'].find((_,i)=>i!==session.ufoCorrectIndex);
    expect(service.submitInput(session.id,slots[0].token,wrong,session.ufoRoundId).correct).toBe(false);
    expect(slots[0].ufoRoundAttempted).toBe(true);
    expect(()=>service.submitInput(session.id,slots[0].token,'R',session.ufoRoundId)).toThrow('ALREADY_ANSWERED');
  });
  it('continues until all three players reach ten points and receive placements',()=>{
    const {service,session,slots}=createLevel6Session();
    for(let p=0;p<3;p++){for(let i=0;i<10;i++){reveal(service);service.submitInput(session.id,slots[p].token,['R','G','B'][session.ufoCorrectIndex],session.ufoRoundId);}expect(slots[p].place).toBe(p+1);expect(session.status).toBe(p===2?'finished':'playing');}
    expect(slots.map(x=>x.pointsEarned)).toEqual([5,3,1]);
  });
  it('does not allow manual finish before all placements are decided',()=>{
    const {service,session,slots}=createLevel6Session();expect(()=>service.finishLevel(session.id,slots[0].token)).toThrow('FINISH_NOT_AVAILABLE');
  });
});
