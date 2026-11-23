import { randomBytes, randomInt } from 'node:crypto';

const COLORS = ['RED', 'GREEN', 'BLUE'];
const SEQUENCE = ['R', 'G', 'B'];
const DEFAULT_TARGET_CYCLES = 20;
const MIN_TARGET_CYCLES = 1;
const MAX_TARGET_CYCLES = 100;
const DICE_TARGET = 8;
const RACE_TARGET_METERS = 3000;
const FLAPPY_TARGET_BLOCKERS = 20;
const BURGER_TARGET_POINTS = 5;
const UFO_TARGET_POINTS = 10;
const ISLAND_TARGET_SHARKS = 50;
const ISLAND_MILESTONE_SIZE = 10;
const ISLAND_COLORS = ['R','G','B'];
function createIslandState(random) { return { sharks: Array.from({length:ISLAND_TARGET_SHARKS},()=>ISLAND_COLORS[Math.floor(random()*3)]), orientations: Array.from({length:ISLAND_TARGET_SHARKS},()=>random()<0.5?'horizontal':'vertical'), progress:0, milestone:0, penaltyMs:0, biteId:0, nudgeId:0 }; }
const TRI_TARGET_SCORE = 30;
const TRI_COLORS = ['R','G','B'];
function createTriState(random) {
  return { pipes: Array.from({length:6},(_,index)=>({id:index+1,color:TRI_COLORS[Math.floor(random()*3)],x:0.25+index*0.25})), nextId:7, score:0, shift:0, lastCorrectId:0 };
}
function normalizeAngle(angle) { const turn=Math.PI*2; return ((angle%turn)+turn)%turn; }
function angleDistance(a,b) { const d=Math.abs(normalizeAngle(a)-normalizeAngle(b)); return Math.min(d,Math.PI*2-d); }
function pieImpactAngle(wheelAngle) { return normalizeAngle(wheelAngle); }
function pieOccupied(knives,angle) { return knives.some((knife)=>angleDistance(knife.angle,angle)<(10*Math.PI/180)); }
const BURGER_STACK_TARGET = 5;
const BURGER_STACK_MIN_LENGTH = 3;
const BURGER_STACK_MAX_LENGTH = 7;
const BURGER_STACK_INGREDIENTS = ['R','G','B'];
function createBurgerStackState(random) {
  const ingredientCount = BURGER_STACK_MIN_LENGTH + Math.floor(random() * (BURGER_STACK_MAX_LENGTH - BURGER_STACK_MIN_LENGTH + 1));
  const recipe = Array.from({length:ingredientCount},(_,index)=>({id:index+1,ingredient:BURGER_STACK_INGREDIENTS[Math.floor(random()*3)],lane:Math.floor(random()*3)}));
  recipe.push({id:ingredientCount+1,ingredient:'T',lane:Math.floor(random()*3)});
  return { lane:1, challengeNumber:1, challengeLength:recipe.length,
    recipe,nextIngredientIndex:0,drops:[],stacked:[],completedStack:[],spawnAccumulator:0.8,penaltyMs:0,stackFlashId:0,missId:0,successCount:0,failedCount:0 };
}
function resetBurgerStackChallenge(stack, random) {
  stack.challengeNumber += 1;
  const ingredientCount = BURGER_STACK_MIN_LENGTH + Math.floor(random() * (BURGER_STACK_MAX_LENGTH - BURGER_STACK_MIN_LENGTH + 1));
  stack.recipe = Array.from({length:ingredientCount},(_,index)=>({id:index+1,ingredient:BURGER_STACK_INGREDIENTS[Math.floor(random()*3)],lane:Math.floor(random()*3)}));
  stack.recipe.push({id:ingredientCount+1,ingredient:'T',lane:Math.floor(random()*3)});
  stack.challengeLength = stack.recipe.length;
  stack.nextIngredientIndex=0; stack.drops=[]; stack.stacked=[]; stack.spawnAccumulator=0.8;
}
const PIE_HITS_PER_COLOR = 4;
const PIE_COLORS = ['R', 'G', 'B'];
function pieColorAtStrike(angle) { const turn = Math.PI * 2; const normalized = (((angle + Math.PI / 3) % turn) + turn) % turn; return PIE_COLORS[Math.floor(normalized / (turn / 3)) % 3]; }
const UFO_DURATIONS_MS = [2000, 1500, 1000, 500];
function createUfoOptions(random) { const pool=[1,2,3,4,5,6,7,8,9]; for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];} const targetId=pool[0]; const options=pool.slice(0,3); return {targetId,options,correctIndex:options.indexOf(targetId)};}
const BURGER_MIN_LENGTH = 3;
const BURGER_MAX_LENGTH = 7;
const BURGER_INGREDIENTS = ['R', 'G', 'B'];
const BURGER_EMOJI = { R: '🥩', G: '🥬', B: '🍅' };
function createBurgerSequence(random) {
  const length = BURGER_MIN_LENGTH + Math.floor(random() * (BURGER_MAX_LENGTH - BURGER_MIN_LENGTH + 1));
  return Array.from({ length }, () => BURGER_INGREDIENTS[Math.floor(random() * BURGER_INGREDIENTS.length)]);
}
function createFlappyState() {
  return { y: 0.5, velocity: 0, blockersPassed: 0, obstacles: [], crashId: 0, spawnAccumulator: 0, nextObstacleId: 1, penaltyMs: 0 };
}
const RACE_VEHICLES = ['🚗', '🚕', '🚙', '🚚', '🚛', '🚌', '🚓'];
function createRaceState() {
  return { lane: 1, distanceMeters: 0, speedMultiplier: 1, penaltyMs: 0, obstacles: [], crashId: 0, spawnAccumulator: 0, nextObstacleId: 1 };
}
const POINTS_BY_PLACE = { 1: 5, 2: 3, 3: 1 };

const MATRIX_TARGET_POINTS = 6;
const MATRIX_ARROWS = ['↑', '→', '↓', '←'];
const MATRIX_SHAPES = ['▲', '◆', '●', '■'];
function createMatrixPuzzle(random, roundId) {
  const difficulty = Math.min(4, Math.floor((roundId - 1) / 2) + 1);
  const family = (roundId - 1) % 4;
  let cells = [], answer = '', category = '', distractors = [];
  if (family === 0) {
    category = 'ROTATION + COUNT';
    const grid = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => MATRIX_ARROWS[(r + c + difficulty - 1) % 4] + '\\n' + '•'.repeat(c + 1)));
    cells = grid.flat().slice(0, 8); answer = grid[2][2];
    distractors = MATRIX_ARROWS.flatMap((arrow) => [1,2,3].map((count) => arrow + '\\n' + '•'.repeat(count)));
  } else if (family === 1) {
    category = 'SHAPE SEQUENCE';
    const grid = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => MATRIX_SHAPES[(r * 2 + c + difficulty - 1) % 4] + '\\n' + '×'.repeat(1 + ((r + c) % 3))));
    cells = grid.flat().slice(0, 8); answer = grid[2][2];
    distractors = MATRIX_SHAPES.flatMap((shape) => [1,2,3].map((count) => shape + '\\n' + '×'.repeat(count)));
  } else if (family === 2) {
    category = 'NUMBER RELATIONSHIP';
    const base = 2 + Math.floor(random() * 8) + difficulty;
    const across = 2 + difficulty;
    const down = 3 + Math.floor(random() * 3);
    const grid = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => String(base + r * down + c * across)));
    cells = grid.flat().slice(0, 8); answer = grid[2][2];
    distractors = [String(Number(answer) + 1), String(Number(answer) - 1), String(Number(answer) + across), String(Number(answer) - down)];
  } else {
    category = 'COMBINED PATTERN';
    const grid = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => {
      const shape = MATRIX_SHAPES[(r + c + difficulty) % 4];
      const count = ((r * 2 + c + difficulty) % 3) + 1;
      return shape.repeat(count);
    }));
    cells = grid.flat().slice(0, 8); answer = grid[2][2];
    distractors = MATRIX_SHAPES.flatMap((shape) => [1,2,3].map((count) => shape.repeat(count)));
  }
  const options = [answer, ...distractors.filter((value) => value !== answer).slice(0, 2)];
  for (let i = options.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
  return { roundId, difficulty, category, cells, options, correctIndex: options.indexOf(answer) };
}


function createDiceRoll() {
  const values = [];
  while (values.length < 3) {
    const value = randomInt(1, 7);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

export class SessionService {
  constructor({ diceRoll = createDiceRoll, random = Math.random } = {}) {
    this.sessions = new Map();
    this.diceRoll = diceRoll;
    this.random = random;
  }

  create({ host }) {
    const id = randomBytes(4).toString('hex').toUpperCase();
    const session = {
      id, host, status: 'waiting', paused: false, createdAt: Date.now(),
      stage: 1, nextPlace: 1, controllerColor: null,
      targetCycles: DEFAULT_TARGET_CYCLES, diceTarget: DICE_TARGET,
      diceValues: null, diceRoundId: 0,
      burgerTarget: BURGER_TARGET_POINTS, burgerSequence: null, burgerRoundId: 0,
      burgerLastDropId: 0, burgerLastDrop: null, burgerCompletedId: 0, burgerWinnerColor: null, burgerCompletedSequence: null,
      matrixTarget: MATRIX_TARGET_POINTS, matrixRoundId: 0, matrixPuzzle: null, ufoTarget: UFO_TARGET_POINTS, ufoRoundId: 0, ufoCycle: 0, ufoTargetId: null, ufoOptions: [], ufoCorrectIndex: null, ufoPhase: 'idle', ufoElapsedMs: 0, ufoDurationMs: 2000,
      pieAngle: 0, pieSpeed: 4.1887902047863905, pieDirection: 1, pieSpeedAccumulator: 0, pieTotalHits: 0, pieDirectionChanged: false, pieLastHitId: 0, pieLastHit: null, pieKnives: [], pieMissId: 0, pieLastMiss: null,
      players: COLORS.map((color) => ({
        color, token: randomBytes(24).toString('hex'), player: null,
        connected: false, joined: false, activeForRound: false,
        progressIndex: 0, cycles: 0, successCount: 0, roundAttempted: false,
        roundFeedback: null, successFeedbackId: 0, totalPoints: 0,
        completed: false, place: null, pointsEarned: 0, burgerProgressIndex: 0, burgerRoundAttempted: false, ufoRoundAttempted: false, matrixRoundAttempted: false, pieHits: { R: 0, G: 0, B: 0 }, pieTotalHits: 0, pieHitAngles: [], island: createIslandState(this.random), tri: createTriState(this.random), burgerStack: createBurgerStackState(this.random), race: createRaceState(), flappy: createFlappyState()
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

  selectLevel(id, hostUsername, stage) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.host.username !== hostUsername) throw new Error('SESSION_NOT_FOUND');
    if (!Number.isInteger(stage) || stage < 1 || stage > 10) throw new Error('INVALID_LEVEL');

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
      player.burgerProgressIndex = 0;
      player.burgerRoundAttempted = false;
      player.ufoRoundAttempted = false;
      player.matrixRoundAttempted = false;
      player.pieHits = { R: 0, G: 0, B: 0 };
      player.pieTotalHits = 0;
    }

    session.stage = stage;
    session.status = 'waiting';
    session.paused = false;
    session.nextPlace = 1;
    session.finalResults = null;
    session.diceValues = null;
    session.burgerSequence = null;
    session.burgerWinnerColor = null;
    session.burgerCompletedSequence = null;
    session.burgerLastDrop = null;
    session.ufoPhase = 'idle';
    session.ufoTargetId = null;
    session.ufoOptions = [];
    session.ufoElapsedMs = 0;
    session.matrixPuzzle = null;
    session.pieAngle = 0;
    session.pieSpeed = 4.1887902047863905;
    session.pieSpeedAccumulator = 0;
    session.pieDirection = 1;
    session.pieTotalHits = 0;
    session.pieDirectionChanged = false;
    session.pieLastHitId = 0;
    session.pieLastHit = null;
    session.pieKnives = []; session.pieMissId = 0; session.pieLastMiss = null;
    return session;
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
      player.race = createRaceState();
      player.flappy = createFlappyState();
      player.burgerProgressIndex = 0;
      player.burgerRoundAttempted = false;
      player.island = createIslandState(this.random);
      player.tri = createTriState(this.random);
      player.burgerStack = createBurgerStackState(this.random);
    }
    if (session.stage === 10) this.rollNextMatrixRound(session);
    if (session.stage === 2) this.rollNextDiceRound(session);
    else session.diceValues = null;
    if (session.stage === 5) this.rollNextBurgerRound(session);
    else session.burgerSequence = null;


    if (session.stage === 7) { session.pieAngle=0; session.pieSpeed=4.1887902047863905; session.pieSpeedAccumulator=0; session.pieDirection=1; session.pieTotalHits=0; session.pieDirectionChanged=false; session.pieLastHitId=0; session.pieLastHit=null; session.pieKnives=[]; session.pieMissId=0; session.pieLastMiss=null; for (const p of session.players) { p.pieHits={R:0,G:0,B:0}; p.pieTotalHits=0; p.pieKnives=[]; } }
    if (session.stage === 6) { session.ufoCycle = 0; session.ufoRoundId = 0; this.rollNextUfoRound(session); }
    else { session.ufoPhase = 'idle'; session.ufoTargetId = null; session.ufoOptions = []; }
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

    if (session.stage === 10) {
      if (!['R','G','B'].includes(action)) throw new Error('INVALID_INPUT');
      if (diceRoundId !== session.matrixRoundId) throw new Error('STALE_MATRIX_ROUND');
      if (slot.matrixRoundAttempted) throw new Error('ALREADY_ANSWERED');
      slot.matrixRoundAttempted = true;
      const positions = { R: 0, G: 1, B: 2 };
      if (positions[action] !== session.matrixPuzzle.correctIndex) {
        slot.roundFeedback = 'wrong';
        if (this.allMatrixPlayersAttempted(session)) this.rollNextMatrixRound(session);
        return { session, slot, correct: false, reset: false, cycleCompleted: false };
      }
      slot.successCount += 1; slot.successFeedbackId += 1; slot.roundFeedback = 'correct';
      if (slot.successCount >= session.matrixTarget) {
        slot.completed = true; slot.place = session.nextPlace++;
        slot.pointsEarned = POINTS_BY_PLACE[slot.place] || 0; slot.totalPoints += slot.pointsEarned;
      }
      if (this.allActivePlayersFinished(session)) { session.status = 'finished'; session.paused = false; }
      else this.rollNextMatrixRound(session, slot);
      return { session, slot, correct: true, reset: false, cycleCompleted: slot.completed, pointAwarded: 1 };
    }

    if (session.stage === 9) {
      const stack = slot.burgerStack;
      if (!['R','B'].includes(action)) throw new Error('INVALID_INPUT');
      if (stack.penaltyMs > 0) throw new Error('BURGER_STACK_RECOVERING');
      stack.lane = Math.max(0, Math.min(2, stack.lane + (action === 'R' ? -1 : 1)));\n      for (const layer of stack.stacked) layer.lane = stack.lane;
      return { session, slot, correct:true, laneChanged:true, lane:stack.lane };
    }

    if (session.stage === 8) {
      const state = slot.tri;
      if (!TRI_COLORS.includes(action)) throw new Error('INVALID_INPUT');
      const nextPipe = state.pipes.filter((pipe) => pipe.x >= 0.13).sort((a,b) => a.x-b.x)[0];
      if (!nextPipe) throw new Error('TRI_PIPE_NOT_READY');
      if (action !== nextPipe.color) {
        slot.roundFeedback = 'wrong';
        return { session, slot, correct: false, reset: false, cycleCompleted: false, targetColor: nextPipe.color };
      }
      for (const pipe of state.pipes) pipe.x -= 1 / 6;
      state.shift += 1;
      state.lastCorrectId += 1;
      slot.successFeedbackId += 1;
      slot.roundFeedback = 'correct';
      let rightmost = Math.max(...state.pipes.map((pipe) => pipe.x));
      for (const pipe of state.pipes) {
        if (pipe.x < -0.17) {
          pipe.x = rightmost + 0.25;
          rightmost = pipe.x;
          pipe.color = TRI_COLORS[Math.floor(this.random() * TRI_COLORS.length)];
          pipe.id = state.nextId++;
          state.score += 1;
        }
      }
      slot.successCount = state.score;
      if (state.score >= TRI_TARGET_SCORE) {
        slot.completed = true;
        slot.place = session.nextPlace++;
        slot.pointsEarned = POINTS_BY_PLACE[slot.place] || 0;
        slot.totalPoints += slot.pointsEarned;
      }
      if (this.allActivePlayersFinished(session)) { session.status = 'finished'; session.paused = false; }
      return { session, slot, correct: true, reset: false, cycleCompleted: slot.completed, score: state.score };
    }

    if (session.stage === 7) {
      if (!PIE_COLORS.includes(action)) throw new Error('INVALID_INPUT');
      const impactAngle = pieImpactAngle(session.pieAngle);
      const targetColor = pieColorAtStrike(impactAngle);
      const occupied = pieOccupied(slot.pieKnives || [], impactAngle);
      if (occupied || action !== targetColor) {
        slot.roundFeedback='wrong'; session.pieMissId += 1;
        session.pieLastMiss={id:session.pieMissId,color:action,occupied,playerColor:slot.color};
        return {session,slot,correct:false,reset:false,cycleCompleted:false,occupied,repeatSpot:occupied,targetColor};
      }
      slot.pieHits[action] += 1; slot.pieTotalHits += 1; slot.successCount += 1; slot.successFeedbackId += 1; slot.roundFeedback='correct';
      session.pieTotalHits += 1; session.pieLastHitId += 1;
      const knife={id:session.pieLastHitId,angle:impactAngle,color:action,playerColor:slot.color};
      slot.pieKnives ||= []; slot.pieKnives.push(knife); session.pieLastHit=knife;
      
      if(PIE_COLORS.every((color)=>slot.pieHits[color]>=PIE_HITS_PER_COLOR)){slot.completed=true;slot.place=session.nextPlace++;slot.pointsEarned=POINTS_BY_PLACE[slot.place]||0;slot.totalPoints+=slot.pointsEarned;}
      if(this.allActivePlayersFinished(session)){session.status='finished';session.paused=false;}
      return {session,slot,correct:true,reset:false,cycleCompleted:slot.completed,pointAwarded:1,knife};
    }

    if (session.stage === 6) {
      if (!['R','G','B'].includes(action)) throw new Error('INVALID_INPUT');
      if (diceRoundId !== session.ufoRoundId) throw new Error('STALE_UFO_ROUND');
      if (session.ufoPhase !== 'choose') throw new Error('UFO_NOT_READY');
      if (slot.ufoRoundAttempted) throw new Error('ALREADY_ANSWERED');
      slot.ufoRoundAttempted = true;
      if ({R:0,G:1,B:2}[action] !== session.ufoCorrectIndex) { slot.roundFeedback='wrong'; if(this.allUfoPlayersAttempted(session))this.rollNextUfoRound(session); return {session,slot,correct:false,reset:false,cycleCompleted:false}; }
      slot.successCount++; slot.successFeedbackId++; slot.roundFeedback='correct';
      if(slot.successCount>=session.ufoTarget){slot.completed=true;slot.place=session.nextPlace++;slot.pointsEarned=POINTS_BY_PLACE[slot.place]||0;slot.totalPoints+=slot.pointsEarned;}
      if(this.allActivePlayersFinished(session)){session.status='finished';session.paused=false;session.ufoPhase='complete';}else this.rollNextUfoRound(session,slot);
      return {session,slot,correct:true,reset:false,cycleCompleted:true,pointAwarded:1};
    }

    if (session.stage === 5) {
      if (!BURGER_INGREDIENTS.includes(action)) throw new Error('INVALID_INPUT');
      if (diceRoundId !== session.burgerRoundId) throw new Error('STALE_BURGER_ROUND');
      if (slot.burgerRoundAttempted) throw new Error('ALREADY_ANSWERED');
      const expected = session.burgerSequence[session.burgerSequence.length - 1 - slot.burgerProgressIndex];
      session.burgerLastDropId += 1;
      session.burgerLastDrop = { id: session.burgerLastDropId, action, ingredient: BURGER_EMOJI[action], color: slot.color, playerName: slot.player?.name || slot.color };
      if (action !== expected) {
        slot.burgerRoundAttempted = true;
        slot.roundFeedback = 'wrong';
        if (this.allBurgerPlayersAttempted(session)) this.rollNextBurgerRound(session);
        return { session, slot, correct: false, reset: false, cycleCompleted: false };
      }
      slot.burgerProgressIndex += 1;
      slot.successFeedbackId += 1;
      slot.roundFeedback = 'correct';
      if (slot.burgerProgressIndex < session.burgerSequence.length) {
        slot.roundFeedback = 'ingredient';
        return { session, slot, correct: true, reset: false, cycleCompleted: false };
      }
      slot.successCount += 1;
      session.burgerCompletedId += 1;
      session.burgerWinnerColor = slot.color;
      session.burgerCompletedSequence = [...session.burgerSequence];
      slot.burgerRoundAttempted = true;
      if (slot.successCount >= session.burgerTarget) {
        slot.completed = true;
        slot.place = session.nextPlace++;
        slot.pointsEarned = POINTS_BY_PLACE[slot.place] || 0;
        slot.totalPoints += slot.pointsEarned;
      }
      if (this.allActivePlayersFinished(session)) {
        session.status = 'finished';
        session.paused = false;
      } else this.rollNextBurgerRound(session, slot);
      return { session, slot, correct: true, reset: false, cycleCompleted: true, pointAwarded: 1 };
    }

    if (session.stage === 4) {
      if (action !== 'JUMP') throw new Error('INVALID_INPUT');
      if (slot.flappy.penaltyMs > 0) throw new Error('FLAPPY_RECOVERING');
      slot.flappy.velocity = -0.62;
      return { session, slot, correct: true, jumped: true };
    }

    if (session.stage === 3) {
      if (!['R', 'G', 'B'].includes(action)) throw new Error('INVALID_INPUT');
      if (slot.race.penaltyMs > 0) throw new Error('RACE_PENALTY_ACTIVE');
      slot.race.lane = { R: 0, G: 1, B: 2 }[action];
      return { session, slot, correct: true, laneChanged: true };
    }

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
      slot.successFeedbackId += 1;
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
    slot.successFeedbackId += 1;
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

  rollNextMatrixRound(session, winner = null) {
    session.matrixRoundId += 1;
    session.matrixPuzzle = createMatrixPuzzle(this.random, session.matrixRoundId);
    for (const player of session.players) {
      if (!player.activeForRound || player.completed) continue;
      player.matrixRoundAttempted = false;
      player.roundFeedback = player === winner ? 'correct' : null;
    }
  }

  allMatrixPlayersAttempted(session) {
    const remaining = session.players.filter((player) => player.activeForRound && !player.completed);
    return remaining.length > 0 && remaining.every((player) => !player.connected || player.matrixRoundAttempted);
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

  tickRaces(deltaMs = 100) {
    const delta = Math.max(0, Math.min(500, Number(deltaMs) || 0)) / 1000;
    if (!delta) return [];
    const updated = [];
    for (const session of this.sessions.values()) {
      if (session.stage !== 3 || session.status !== 'playing' || session.paused) continue;
      for (const player of session.players) {
        if (!player.activeForRound || player.completed) continue;
        const race = player.race;
        race.speedMultiplier = Math.min(2.5, 1 + (race.distanceMeters / RACE_TARGET_METERS) * 1.5);
        const wasPenalized = race.penaltyMs > 0;
        if (wasPenalized) race.penaltyMs = Math.max(0, race.penaltyMs - delta * 1000);
        else race.distanceMeters = Math.min(RACE_TARGET_METERS, race.distanceMeters + 100 * race.speedMultiplier * delta);

        const obstacleSpeed = 0.43 * race.speedMultiplier;
        for (const obstacle of race.obstacles) obstacle.progress += obstacleSpeed * delta;
        race.obstacles = race.obstacles.filter((obstacle) => obstacle.progress < 1.08);

        if (!wasPenalized && race.penaltyMs <= 0) {
          const collision = race.obstacles.find((obstacle) =>
            obstacle.lane === race.lane && obstacle.progress >= 0.82 && obstacle.progress - obstacleSpeed * delta < 0.82
          );
          if (collision) {
            race.penaltyMs = 2000;
            race.crashId += 1;
            race.obstacles = race.obstacles.filter((obstacle) => obstacle.id !== collision.id);
          }
        }

        race.spawnAccumulator += delta;
        const spawnInterval = Math.max(0.55, 1.25 / race.speedMultiplier);
        if (race.spawnAccumulator >= spawnInterval && race.obstacles.length < 5) {
          race.spawnAccumulator -= spawnInterval;
          race.obstacles.push({
            id: race.nextObstacleId++,
            lane: Math.floor(this.random() * 3),
            type: RACE_VEHICLES[Math.floor(this.random() * RACE_VEHICLES.length)],
            progress: 0
          });
        }

        if (race.distanceMeters >= RACE_TARGET_METERS) {
          player.completed = true;
          player.place = session.nextPlace++;
          player.pointsEarned = POINTS_BY_PLACE[player.place] || 0;
          player.totalPoints += player.pointsEarned;
          race.distanceMeters = RACE_TARGET_METERS;
        }
      }
      if (this.allActivePlayersFinished(session)) {
        session.status = 'finished';
        session.paused = false;
      }
      updated.push(session);
    }
    return updated;
  }

  tickFlappy(deltaMs = 100) {
    const delta = Math.max(0, Math.min(500, Number(deltaMs) || 0)) / 1000;
    if (!delta) return [];
    const updated = [];
    for (const session of this.sessions.values()) {
      if (session.stage !== 4 || session.status !== 'playing' || session.paused) continue;
      for (const player of session.players) {
        if (!player.activeForRound || player.completed) continue;
        const flight = player.flappy;
        const difficulty = 1 + Math.floor(flight.blockersPassed / 6) * 0.18;
        if (flight.penaltyMs > 0) {
          flight.penaltyMs = Math.max(0, flight.penaltyMs - delta * 1000);
          flight.y = 0.5;
          flight.velocity = 0;
        } else {
          flight.velocity = Math.min(0.82, flight.velocity + 1.35 * delta);
          flight.y += flight.velocity * delta;
          for (const obstacle of flight.obstacles) {
            obstacle.x -= (0.30 * difficulty) * delta;
            obstacle.gapY += obstacle.drift * delta;
            if (obstacle.gapY < 0.24 || obstacle.gapY > 0.76) obstacle.drift *= -1;
          }
          for (const obstacle of flight.obstacles.filter((item) => !item.passed && item.x < 0.20)) {
            obstacle.passed = true;
            flight.blockersPassed += 1;
            if (flight.blockersPassed >= FLAPPY_TARGET_BLOCKERS) {
              player.completed = true;
              player.place = session.nextPlace++;
              player.pointsEarned = POINTS_BY_PLACE[player.place] || 0;
              player.totalPoints += player.pointsEarned;
              break;
            }
          }
          flight.obstacles = flight.obstacles.filter((obstacle) => obstacle.x > -0.12);
          if (!player.completed && (flight.y < 0.035 || flight.y > 0.965)) {
            flight.crashId += 1;
            flight.penaltyMs = 850;
            flight.y = 0.5;
            flight.velocity = 0;
          }
          if (!player.completed) {
            const hit = flight.obstacles.find((obstacle) => {
              const overlapsRocket = Math.abs(obstacle.x - 0.28) < 0.055;
              const gap = Math.max(0.22, 0.38 - Math.floor(flight.blockersPassed / 6) * 0.035);
              return overlapsRocket && Math.abs(flight.y - obstacle.gapY) > gap / 2 - 0.035;
            });
            if (hit) {
              flight.crashId += 1;
              flight.penaltyMs = 850;
              flight.y = 0.5;
              flight.velocity = 0;
              flight.obstacles = flight.obstacles.filter((obstacle) => obstacle.id !== hit.id);
            }
          }
          flight.spawnAccumulator += delta;
          const spawnInterval = Math.max(0.92, 1.55 / difficulty);
          if (!player.completed && flight.spawnAccumulator >= spawnInterval && flight.obstacles.length < 3) {
            flight.spawnAccumulator -= spawnInterval;
            flight.obstacles.push({ id: flight.nextObstacleId++, x: 1.12, gapY: 0.32 + this.random() * 0.36,
              drift: (this.random() - 0.5) * 0.16 * difficulty, passed: false });
          }
        }
      }
      if (this.allActivePlayersFinished(session)) { session.status = 'finished'; session.paused = false; }
      updated.push(session);
    }
    return updated;
  }

  allDicePlayersAttempted(session) {
    const remaining = session.players.filter((player) => player.activeForRound && !player.completed);
    return remaining.length > 0 && remaining.every((player) => !player.connected || player.roundAttempted);
  }

  rollNextUfoRound(session, winner = null) {
    const {targetId,options,correctIndex}=createUfoOptions(this.random); session.ufoRoundId++;session.ufoCycle++;session.ufoTargetId=targetId;session.ufoOptions=options;session.ufoCorrectIndex=correctIndex;session.ufoDurationMs=UFO_DURATIONS_MS[Math.min(3,Math.floor((session.ufoCycle-1)/4))];session.ufoElapsedMs=0;session.ufoPhase='flyby';
    for(const player of session.players){if(!player.activeForRound||player.completed)continue;player.ufoRoundAttempted=false;player.roundFeedback=player===winner?'correct':null;}
  }

  tickBurgerStacks(deltaMs = 100) {
    const delta = Math.max(0, Math.min(500, Number(deltaMs) || 0)) / 1000;
    if (!delta) return [];
    const updated = [];
    for (const session of this.sessions.values()) {
      if (session.stage !== 9 || session.status !== 'playing' || session.paused) continue;
      for (const player of session.players) {
        if (!player.activeForRound || player.completed) continue;
        const stack = player.burgerStack;
        if (stack.penaltyMs > 0) { stack.penaltyMs = Math.max(0, stack.penaltyMs - delta * 1000); continue; }
        const difficulty = stack.successCount;
        const fallSpeed = 0.72 + difficulty * 0.055;
        const spawnInterval = difficulty > 2 ? 0.6 : 0.8;
        stack.spawnAccumulator += delta;
        while (stack.spawnAccumulator >= spawnInterval && stack.nextIngredientIndex < stack.recipe.length && stack.drops.length < 6) {
          stack.spawnAccumulator -= spawnInterval;
          stack.completedStack = [];
          stack.drops.push({ ...stack.recipe[stack.nextIngredientIndex++], y:0.02 });
        }
        for (const drop of stack.drops) drop.y += fallSpeed * delta;
        const landed = stack.drops.find((drop) => drop.y >= 0.84);
        if (landed) {
          if (landed.lane !== stack.lane) {
            stack.missId += 1; stack.failedCount += 1; stack.penaltyMs = 1000; stack.completedStack = [];
            resetBurgerStackChallenge(stack, this.random); player.roundFeedback = 'stack-missed'; continue;
          }
          stack.stacked.push({ingredient:landed.ingredient,lane:landed.lane});
          stack.stackFlashId += 1;
          stack.drops = stack.drops.filter((drop) => drop.id !== landed.id);
          player.roundFeedback = 'stacked';
          if (stack.stacked.length === stack.challengeLength && stack.nextIngredientIndex === stack.recipe.length && stack.drops.length === 0) {
            stack.successCount += 1; player.successCount = stack.successCount; player.successFeedbackId += 1;
            player.roundFeedback = 'stack-challenge-complete';
            stack.completedStack = [...stack.stacked];
            if (stack.successCount >= BURGER_STACK_TARGET) {
              player.completed = true; player.place = session.nextPlace++;
              player.pointsEarned = POINTS_BY_PLACE[player.place] || 0; player.totalPoints += player.pointsEarned;
            } else resetBurgerStackChallenge(stack, this.random);
          }
        }
      }
      if (this.allActivePlayersFinished(session)) { session.status = 'finished'; session.paused = false; }
      updated.push(session);
    }
    return updated;
  }

  tickIslands(deltaMs=100) { const delta=Math.max(0,Math.min(500,Number(deltaMs)||0)); if(!delta)return[]; const updated=[]; for(const session of this.sessions.values()){if(session.stage!==8||session.status!=='playing'||session.paused)continue;let changed=false;for(const p of session.players){if(!p.activeForRound||p.completed||p.island.penaltyMs<=0)continue;p.island.penaltyMs=Math.max(0,p.island.penaltyMs-delta);changed=true;}if(changed)updated.push(session);}return updated; }

  tickPies(deltaMs=100) {
    const elapsed=Math.max(0,Math.min(500,Number(deltaMs)||0));
    const delta=elapsed/1000;
    if(!delta)return[];
    const updated=[];
    for(const session of this.sessions.values()){
      if(session.stage!==7||session.status!=='playing'||session.paused)continue;
      session.pieAngle=(session.pieAngle+session.pieSpeed*session.pieDirection*delta)%(Math.PI*2);
      session.pieSpeedAccumulator=(session.pieSpeedAccumulator||0)+elapsed;
      while(session.pieSpeedAccumulator>=1500){
        session.pieSpeedAccumulator-=1500;
        const variation=(this.random()*4-2)*Math.PI/180*60;
        const sign=this.random()<0.5?-1:1;
        session.pieSpeed=Math.max(-6.283185307179586,Math.min(6.283185307179586,(Math.abs(session.pieSpeed)+variation)*sign));
        if(Math.abs(session.pieSpeed)<0.35)session.pieSpeed=sign*0.35;
      }
      updated.push(session);
    }
    return updated;
  }

  tickUfos(deltaMs=100){const delta=Math.max(0,Math.min(500,Number(deltaMs)||0));if(!delta)return[];const updated=[];for(const session of this.sessions.values()){if(session.stage!==6||session.status!=='playing'||session.paused||session.ufoPhase!=='flyby')continue;session.ufoElapsedMs=Math.min(session.ufoDurationMs,session.ufoElapsedMs+delta);if(session.ufoElapsedMs>=session.ufoDurationMs)session.ufoPhase='choose';updated.push(session);}return updated;}
  allUfoPlayersAttempted(session){const remaining=session.players.filter(p=>p.activeForRound&&!p.completed);return remaining.length>0&&remaining.every(p=>!p.connected||p.ufoRoundAttempted);}

  rollNextBurgerRound(session, winner = null) {
    session.burgerSequence = createBurgerSequence(this.random);
    session.burgerRoundId += 1;
    for (const player of session.players) {
      if (!player.activeForRound || player.completed) continue;
      player.burgerProgressIndex = 0;
      player.burgerRoundAttempted = false;
      player.roundFeedback = player === winner ? 'correct' : null;
    }
  }

  allBurgerPlayersAttempted(session) {
    const remaining = session.players.filter((player) => player.activeForRound && !player.completed);
    return remaining.length > 0 && remaining.every((player) => !player.connected || player.burgerRoundAttempted);
  }

  allActivePlayersFinished(session) {
    const active = session.players.filter((player) => player.activeForRound);
    return active.length > 0 && active.every((player) => player.completed);
  }

  reviewResults(id) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.stage !== 10 || session.status !== 'finished') throw new Error('RESULTS_NOT_READY');
    session.finalResults = session.players
      .filter((player) => player.joined)
      .map((player) => ({
        color: player.color,
        name: player.player?.name || 'Player',
        totalPoints: player.totalPoints,
        avatar: player.player?.avatar || null,
        character: player.player?.character || 'astronaut'
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints || a.color.localeCompare(b.color))
      .map((player, index) => ({ ...player, rank: index + 1 }));
    session.status = 'results';
    session.paused = false;
    return session;
  }

  finishLevel(id, token) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    this.assertController(session, this.getSlot(id, token));
    if (session.stage === 2 || session.stage === 4 || session.stage === 5 || session.stage === 6 || session.stage === 7 || session.stage === 8 || session.stage === 9 || session.stage === 10) throw new Error('FINISH_NOT_AVAILABLE');
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
    session.burgerSequence = null;
    session.burgerWinnerColor = null;
    session.burgerCompletedSequence = null;
    return session;
  }

  endGame(id, token) {
    const session = this.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    this.assertController(session, this.getSlot(id, token));

    session.stage = 1;
    session.status = 'waiting';
    session.paused = false;
    session.nextPlace = 1;
    session.diceValues = null;
    session.burgerSequence = null;
    session.burgerWinnerColor = null;
    session.burgerCompletedSequence = null;
    for (const player of session.players) {
      player.activeForRound = false;
      player.progressIndex = 0;
      player.cycles = 0;
      player.successCount = 0;
      player.roundAttempted = false;
      player.roundFeedback = null;
      player.totalPoints = 0;
      player.completed = false;
      player.place = null;
      player.pointsEarned = 0;
    }
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
    session.burgerSequence = null;
    session.burgerWinnerColor = null;
    session.burgerCompletedSequence = null;
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
      id: session.id, status: session.status, paused: session.paused, finalResults: session.finalResults || null,
      stage: session.stage, targetCycles: session.targetCycles,
      diceTarget: session.diceTarget, diceValues: session.diceValues,
      diceRoundId: session.diceRoundId,
      burgerTarget: session.burgerTarget, burgerSequence: session.burgerSequence,
      burgerRoundId: session.burgerRoundId, burgerLastDropId: session.burgerLastDropId,
      burgerLastDrop: session.burgerLastDrop, burgerCompletedId: session.burgerCompletedId,
      burgerWinnerColor: session.burgerWinnerColor, burgerCompletedSequence: session.burgerCompletedSequence,
      islandTarget: ISLAND_TARGET_SHARKS, triTarget: TRI_TARGET_SCORE, burgerStackTarget: BURGER_STACK_TARGET, pieAngle: session.pieAngle, pieSpeed: session.pieSpeed, pieDirection: session.pieDirection, pieTotalHits: session.pieTotalHits, pieLastHitId: session.pieLastHitId, pieLastHit: session.pieLastHit, pieKnives: session.pieKnives, pieMissId: session.pieMissId, pieLastMiss: session.pieLastMiss, pieTargetColor: pieColorAtStrike(pieImpactAngle(session.pieAngle)),
      matrixTarget: session.matrixTarget, matrixRoundId: session.matrixRoundId, matrixPuzzle: session.matrixPuzzle ? { roundId: session.matrixPuzzle.roundId, difficulty: session.matrixPuzzle.difficulty, category: session.matrixPuzzle.category, cells: session.matrixPuzzle.cells, options: session.matrixPuzzle.options } : null, ufoTarget: session.ufoTarget, ufoRoundId: session.ufoRoundId, ufoCycle: session.ufoCycle, ufoTargetId: session.ufoTargetId, ufoOptions: session.ufoOptions, ufoPhase: session.ufoPhase, ufoElapsedMs: session.ufoElapsedMs, ufoDurationMs: session.ufoDurationMs,
      controllerColor: session.controllerColor, sequence: SEQUENCE,
      players: session.players.map((player) => ({
        color: player.color, player: player.player, connected: player.connected,
        joined: player.joined, activeForRound: player.activeForRound,
        progressIndex: player.progressIndex, cycles: player.cycles,
        successCount: player.successCount, roundAttempted: player.roundAttempted,
        roundFeedback: player.roundFeedback, successFeedbackId: player.successFeedbackId,
        race: player.race, flappy: player.flappy,
        island: player.island, tri: player.tri, burgerStack: player.burgerStack, pieHits: player.pieHits, pieTotalHits: player.pieTotalHits, pieKnives: player.pieKnives, burgerProgressIndex: player.burgerProgressIndex, burgerRoundAttempted: player.burgerRoundAttempted, ufoRoundAttempted: player.ufoRoundAttempted, matrixRoundAttempted: player.matrixRoundAttempted,
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
