import { io } from 'socket.io-client';
import './player.css';

const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const sessionId = params.get('sessionId');
const joinToken = params.get('joinToken');
let socket;
let joined = false;
let playerColor;
let isController = false;
let inputId = 0;
let latestState;
let lastCrashId = 0;
let lastFlappyCrashId = 0;
let lastIslandBiteId = 0;
const raceObstacleNodes = new Map();

if (!sessionId || !joinToken) {
  root.textContent = 'Invalid player link';
} else {
  root.innerHTML = '<div class="join-card"><h1>Join RGB</h1><form id="join"><input name="name" maxlength="20" placeholder="Your name" required><label for="character">Choose your suit</label><select name="character" id="character"><option value="astronaut">🚀 Astronaut</option><option value="racer">🏎️ Car Racer</option><option value="hazmat">☣️ Hazmat Explorer</option></select><label for="avatar">Profile photo (optional)</label><input id="avatar" name="avatar" type="file" accept="image/png,image/jpeg,image/webp"><small>Your photo appears inside your character visor.</small><button>Join game</button></form><p id="status" role="status"></p></div>';
  root.querySelector('#join').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const character = String(form.get('character') || 'astronaut');
    const file = form.get('avatar');
    if (!name || socket) return;
    let avatar = null;
    if (file instanceof File && file.size) {
      try { avatar = await resizeAvatar(file); }
      catch { root.querySelector('#status').textContent = 'Could not read that photo. Try another image.'; return; }
    }
    socket = io({ auth: { sessionId, joinToken }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('player:join', { name, character, avatar }, (ack) => {
      if (!ack.ok) {
        if (!joined) root.querySelector('#status').textContent = readableError(ack.error);
        return;
      }
      if (!joined) {
        joined = true;
        playerColor = ack.color;
        isController = ack.isController;
        renderController(name, ack.color, ack.state);
      } else {
        updateController(ack.state);
        const connection = document.querySelector('#connection-state');
        if (connection) connection.textContent = 'Connected';
      }
    }));
    socket.on('game:state', (state) => { if (joined) updateController(state); });
    socket.on('disconnect', () => {
      const state = document.querySelector('#connection-state');
      if (state) state.textContent = 'Reconnecting…';
    });
  });
}

function emitControl(action, extra = {}) {
  if (!socket?.connected) return;
  socket.emit('player:control', { action, ...extra }, (result) => {
    if (!result.ok) setFeedback(readableError(result.error), 'warning');
  });
}

function renderController(name, color, state) {
  root.innerHTML = '<header><div><h1 id="player-name"></h1><p id="player-color"></p></div><span id="connection-state">Connected</span></header>' +
    '<p id="feedback" aria-live="polite">Waiting for the game to start</p>' +
    '<div class="sequence" id="sequence"><span>R</span><span>G</span><span>B</span></div>' +
    '<p id="input-hint" class="input-hint">Tap R → G → B in order</p>' +
    '<section id="flappy-screen" class="flappy-screen" hidden><div class="flappy-hud"><strong id="flappy-count">0 / 20 BLOCKERS</strong><span id="flappy-difficulty">EASY FLIGHT</span></div><div id="flappy-world" class="flappy-world" role="button" tabindex="0" aria-label="Tap to boost rocket"><div class="flappy-stars"></div><div id="flappy-obstacles" class="flappy-obstacles"></div><div id="flappy-rocket" class="flappy-rocket"><div class="rocket-window"><img id="flappy-avatar" alt="Your profile" hidden><span id="flappy-default">🚀</span></div><div class="rocket-flame"></div></div><div id="flappy-crash" class="flappy-crash">BOOST AGAIN!</div><div class="flappy-tap-hint">TAP ANYWHERE TO BOOST</div></div><div class="flappy-progress"><div id="flappy-progress-fill"></div></div></section>' +
    '<section id="island-screen" class="island-screen" hidden><div class="island-hud"><strong id="island-progress">0 / 50 SHARKS</strong><span id="island-milestone">START</span></div><div class="island-world"><div class="island-sky"></div><div class="island-sea"></div><div class="island-destination">🏝️<small>DESTINATION</small></div><div id="island-steps" class="island-steps"></div><div id="island-player" class="island-player">🧑‍🚀</div><div id="island-shark" class="island-shark">🦈</div><div id="island-bite" class="island-bite">CHOMP! -1 SEC</div></div><div class="island-progress"><div id="island-progress-fill"></div></div></section>' +
    '<section id="race-screen"' class="race-screen" hidden><div class="race-hud"><strong id="race-distance">0 m / 3,000 m</strong><span id="race-speed">1.0× SPEED</span></div><div class="race-road"><div class="road-lane-line line-one"></div><div class="road-lane-line line-two"></div><div id="race-obstacles" class="race-obstacles"></div><div id="race-player" class="race-player"><img id="race-avatar" alt="Your profile" hidden><span id="race-car">🚗</span></div><div id="race-crash" class="race-crash" aria-live="polite">CRASH! +2 SEC</div></div><div class="race-status"><span id="race-lane-label">CENTRE LANE</span><span id="race-penalty"></span></div><div class="race-progress"><div id="race-progress-fill"></div></div></section>' +
    '<div class="pad"><button data-a="R" class="red" aria-label="R / Left lane">R</button><button data-a="G" class="green" aria-label="G / Centre lane">G</button><button data-a="B" class="blue" aria-label="B / Right lane">B</button></div>' +
    '<section id="controls" class="controls"></section>' +
    '<section id="config-panel" class="config-panel" hidden><label for="target-cycles">Cycles to win</label><input id="target-cycles" type="number" min="1" max="100" value="20"><button id="save-config">Save config</button></section>';
  document.querySelector('#player-name').textContent = name;
  document.querySelector('#player-color').textContent = color + ' PLAYER';
  root.querySelectorAll('[data-a]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (button.disabled || !socket?.connected) return;
      const thisInput = inputId++;
      button.classList.add('pressed');
      const payload = { action: button.dataset.a, inputId: thisInput };
      if (latestState?.stage === 2) payload.roundId = latestState.diceRoundId;
      if (latestState?.stage === 5) payload.roundId = latestState.burgerRoundId;
      if (latestState?.stage === 6) payload.roundId = latestState.ufoRoundId;
      socket.emit('player:input', payload, (result) => {
        button.classList.remove('pressed');
        if (!result.ok) setFeedback(readableError(result.error), 'warning');
        else if (!result.correct) setFeedback(latestState?.stage === 5
          ? '✕ Wrong ingredient — wait for the next burger'
          : latestState?.stage === 2 ? '✕ Wrong position — wait for the next dice roll'
            : 'Wrong colour — sequence restarted', 'warning');
        else if (latestState?.stage === 3) setFeedback('Moving to ' + ({ R: 'left', G: 'centre', B: 'right' }[payload.action]) + ' lane', 'success');
        else if (result.pointAwarded) setFeedback(latestState?.stage === 6 ? 'Correct UFO! +1 point' : latestState?.stage === 7 ? 'Knife hit!' : latestState?.stage === 8 ? 'Safe crossing!' : 'Perfect burger! +1 point', 'success');
        else if (result.cycleCompleted) setFeedback('Cycle complete!', 'success');
        else setFeedback('Good — keep going!', 'success');
      });
    }, { passive: false });
    button.addEventListener('pointerup', () => button.classList.remove('pressed'));
    button.addEventListener('pointercancel', () => button.classList.remove('pressed'));
    button.addEventListener('lostpointercapture', () => button.classList.remove('pressed'));
  });
  const jump = (event) => {
    const mine = latestState?.players?.find((player) => player.color === playerColor);
    if (latestState?.stage !== 4 || latestState.status !== 'playing' || latestState.paused || mine?.completed) return;
    event?.preventDefault?.();
    if (!socket?.connected) return;
    socket.emit('player:input', { action: 'JUMP', inputId: inputId++ }, (result) => {
      if (!result.ok) setFeedback(readableError(result.error), 'warning');
    });
  };
  const flightWorld = root.querySelector('#flappy-world');
  flightWorld.addEventListener('pointerdown', jump);
  flightWorld.addEventListener('keydown', (event) => { if ([' ', 'Enter', 'ArrowUp'].includes(event.key)) jump(event); });
  root.querySelector('#save-config').addEventListener('click', () => {
    const targetCycles = Number(root.querySelector('#target-cycles').value);
    emitControl('configure', { targetCycles });
    root.querySelector('#config-panel').hidden = true;
  });
  updateController(state);
}

function renderControls(state) {
  const controls = root.querySelector('#controls');
  if (!controls) return;
  const isFinished = state.status === 'finished';
  const isPlaying = state.status === 'playing';
  const buttons = [];
  if (isController) {
    if (state.status === 'waiting') buttons.push(['start', 'Start level', false, 'primary']);
    if (isPlaying && state.stage === 1) buttons.push(['finish', 'Finish level', false, 'danger']);
    if (state.status !== 'waiting') buttons.push(['reset', 'Reset level', false, 'danger']);
    if (state.stage > 1 || state.status !== 'waiting') buttons.push(['end', 'End game', false, 'danger']);
    if (state.stage === 1) buttons.push(['config', 'Config', false, 'secondary']);
  }
  if (isPlaying) buttons.push([state.paused ? 'resume' : 'pause', state.paused ? 'Resume' : 'Pause', false, 'secondary']);
  if (isFinished) buttons.push(['next', 'Next level', false, 'primary']);
  controls.innerHTML = '';
  for (const [action, label, , style] of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = style;
    button.textContent = label;
    button.addEventListener('click', () => {
      if (action === 'end') {
        if (window.confirm('End this game and return everyone to Level 1? All scores from this game will be cleared.')) emitControl('end');
      } else if (action === 'config') {
        root.querySelector('#target-cycles').value = state.targetCycles;
        root.querySelector('#config-panel').hidden = !root.querySelector('#config-panel').hidden;
      } else emitControl(action);
    });
    controls.append(button);
  }
}

function updateController(state) {
  latestState = state;
  const mine = state.players.find((player) => player.color === playerColor);
  if (!mine) return;
  const isDice = state.stage === 2;
  const isRace = state.stage === 3;
  const isFlappy = state.stage === 4;
  const isBurger = state.stage === 5;
  const isUfo = state.stage === 6;
  const isPie = state.stage === 7;
  const isIsland = state.stage === 8;
  root.querySelectorAll('[data-a]').forEach((button) => {
    button.disabled = state.status !== 'playing' || state.paused || mine.completed ||
      !mine.activeForRound || (isDice && mine.roundAttempted) || (isBurger && mine.burgerRoundAttempted) || (isUfo && (state.ufoPhase !== 'choose' || mine.ufoRoundAttempted)) || (isRace && (mine.race?.penaltyMs || 0) > 0) || (isIsland && (mine.island?.penaltyMs || 0) > 0);
  });
  const sequence = root.querySelector('#sequence');
  const hint = root.querySelector('#input-hint');
  sequence.hidden = isRace || isFlappy || isUfo || isPie || isIsland;
  hint.hidden = isRace || isFlappy;
  root.querySelector('#race-screen').hidden = !isRace;
  root.querySelector('#island-screen').hidden = !isIsland;
  if (isIsland) renderIsland(state, mine);
  root.querySelector('#flappy-screen').hidden = !isFlappy;
  root.querySelector('.pad').hidden = isFlappy;
  if (isFlappy) renderFlappy(state, mine);
  if (isDice) {
    sequence.innerHTML = '<span>R</span><span>G</span><span>B</span>';
    hint.textContent = 'R = LEFT  ·  G = MIDDLE  ·  B = RIGHT';
  } else if (isBurger) {
    sequence.innerHTML = (state.burgerSequence || []).map((action) => '<span>' + ({ R: '🥩', G: '🥬', B: '🍅' }[action]) + '</span>').join('');
    hint.textContent = 'Build the burger in order · R Meat · G Vegetable · B Tomato';
  } else if (isPie) { hint.hidden=false; hint.textContent='Watch the pointer · Press the matching colour to throw a knife'; }
  if (isUfo) {
    hint.hidden = false; hint.textContent = state.ufoPhase === 'flyby' ? 'Watch carefully — memorise the UFO!' : 'Which UFO did you see? R = LEFT · G = MIDDLE · B = RIGHT';
  } else if (isPie) { hint.hidden=false; hint.textContent='R '+(mine.pieHits?.R||0)+'/6  ·  G '+(mine.pieHits?.G||0)+'/6  ·  B '+(mine.pieHits?.B||0)+'/6'; }
  else if (isIsland) { hint.hidden=false; hint.textContent='Match the shark colour to cross safely · R Red · G Green · B Blue'; }
  else if (!isRace) {
    sequence.innerHTML = '<span>R</span><span>G</span><span>B</span>';
    hint.textContent = 'Tap R → G → B in order';
  }
  if (isRace) renderRace(state, mine);
  if (mine.completed) setFeedback('You finished — ' + ordinal(mine.place) + ' place!', 'success');
  else if (state.status === 'finished') setFeedback('Level complete. Next level is ready.', 'success');
  else if (state.paused) setFeedback('Game paused', 'warning');
  else if (state.status === 'waiting') setFeedback('Waiting for the game to start', '');
  else if (!mine.activeForRound) setFeedback('Ready for the next level', '');
  else if (isRace && (mine.race?.penaltyMs || 0) > 0) setFeedback('CRASH! 2-second penalty — hold tight', 'warning');
  else if (isFlappy && (mine.flappy?.penaltyMs || 0) > 0) setFeedback('ROCKET BUMPED — GET READY TO BOOST', 'warning');
  else if (isFlappy) setFeedback('Tap anywhere to boost your rocket!', '');
  else if (isRace) setFeedback('Dodge traffic! R left · G centre · B right', '');
  else if (isPie && mine.roundFeedback === 'wrong') setFeedback('Missed the colour — watch the pointer and try again', 'warning');
  else if (isPie) setFeedback('Hit R, G or B when that colour reaches the pointer', '');
  else if (isIsland && mine.island?.penaltyMs > 0) setFeedback('SHARK BITE! Recovering for 1 second…', 'warning');
  else if (isIsland && mine.roundFeedback === 'bitten') setFeedback('Wrong colour! You fell back to the last island checkpoint.', 'warning');
  else if (isIsland) setFeedback('Cross the sea — match each shark colour!', '');
  else if (isUfo && state.ufoPhase === 'flyby') setFeedback('Memorise the UFO before it disappears!', '');
  else if (isUfo && mine.ufoRoundAttempted && mine.roundFeedback === 'wrong') setFeedback('Wrong UFO — wait for the next fly-by', 'warning');
  else if (isUfo && mine.roundFeedback === 'correct') setFeedback('Correct UFO! +1 point', 'success');
  else if (isUfo) setFeedback('Choose the matching UFO', '');
  else if (isBurger && mine.burgerRoundAttempted && mine.roundFeedback === 'wrong') setFeedback('✕ Wrong ingredient — wait for the next burger', 'warning');
  else if (isBurger && mine.roundFeedback === 'correct') setFeedback('Burger complete! +1 point · Next recipe loading', 'success');
  else if (isBurger && mine.burgerRoundAttempted) setFeedback('Wrong ingredient — wait for the next burger', 'warning');
  else if (isBurger) setFeedback('Match the recipe on the shared screen!', '');
  else if (isDice && mine.roundAttempted && mine.roundFeedback === 'wrong') setFeedback('✕ Wrong answer — wait for next dice roll', 'warning');
  else if (isDice && mine.roundFeedback === 'correct') setFeedback('Correct! +1 point', 'success');
  else if (isDice && mine.roundAttempted) setFeedback('Answer received — wait for next roll', '');
  else if (isDice) setFeedback('Which position has the biggest number?', '');
  else setFeedback('Tap R → G → B in order', '');
  renderControls(state);
  const target = root.querySelector('#target-cycles');
  if (target && document.activeElement !== target) target.value = state.targetCycles;
}

function renderIsland(state, mine) {
  const island = mine.island || { progress:0, milestone:0, sharks:[], penaltyMs:0, biteId:0 };
  const progress = island.progress || 0;
  root.querySelector('#island-progress').textContent = progress + ' / 50 SHARKS';
  root.querySelector('#island-milestone').textContent = island.milestone ? 'CHECKPOINT ' + island.milestone : 'START ISLAND';
  root.querySelector('#island-progress-fill').style.width = (progress / 50 * 100) + '%';
  const player = root.querySelector('#island-player');
  player.style.left = (8 + progress / 50 * 76) + '%';
  player.classList.toggle('bitten', (island.penaltyMs || 0) > 0);
  const shark = root.querySelector('#island-shark');
  shark.textContent = ({R:'🦈',G:'🦈',B:'🦈'}[island.sharks?.[progress]] || '🦈');
  shark.style.filter = ({R:'drop-shadow(0 0 12px #ef4444) hue-rotate(320deg) saturate(2)',G:'drop-shadow(0 0 12px #22c55e) hue-rotate(70deg) saturate(2)',B:'drop-shadow(0 0 12px #3b82f6)'}[island.sharks?.[progress]] || 'none');
  shark.style.left = Math.min(88, 8 + progress / 50 * 76 + 5) + '%';
  if (island.biteId !== lastIslandBiteId) { lastIslandBiteId=island.biteId; const bite=root.querySelector('#island-bite'); bite.classList.remove('show'); void bite.offsetWidth; bite.classList.add('show'); player.classList.add('bitten'); }
}

function renderRace(state, mine) {
  const race = mine.race || {};
  const distance = Math.floor(race.distanceMeters || 0);
  root.querySelector('#race-distance').textContent = distance.toLocaleString() + ' m / 3,000 m';
  root.querySelector('#race-speed').textContent = (race.speedMultiplier || 1).toFixed(1) + '× SPEED';
  root.querySelector('#race-progress-fill').style.width = (distance / 3000 * 100) + '%';
  root.querySelector('#race-lane-label').textContent = ['LEFT LANE', 'CENTRE LANE', 'RIGHT LANE'][race.lane ?? 1];
  const penalty = Math.ceil((race.penaltyMs || 0) / 100) / 10;
  root.querySelector('#race-penalty').textContent = penalty > 0 ? 'RECOVERING ' + penalty.toFixed(1) + 's' : '';
  const avatar = root.querySelector('#race-avatar');
  const car = root.querySelector('#race-car');
  const playerCar = root.querySelector('#race-player');
  if (mine.player?.avatar) { avatar.src = mine.player.avatar; avatar.hidden = false; car.hidden = true; playerCar.classList.add('has-avatar'); }
  else { avatar.hidden = true; avatar.removeAttribute('src'); car.hidden = false; playerCar.classList.remove('has-avatar'); }
  playerCar.style.left = ([20, 50, 80][race.lane ?? 1]) + '%';
  const obstacles = root.querySelector('#race-obstacles');
  const activeIds = new Set();
  for (const item of race.obstacles || []) {
    activeIds.add(item.id);
    let vehicle = raceObstacleNodes.get(item.id);
    if (!vehicle) {
      vehicle = document.createElement('span');
      vehicle.className = 'race-obstacle';
      vehicle.textContent = item.type;
      obstacles.append(vehicle);
      raceObstacleNodes.set(item.id, vehicle);
    }
    vehicle.style.left = ([20, 50, 80][item.lane]) + '%';
    vehicle.style.top = (item.progress * 100) + '%';
  }
  for (const [id, vehicle] of raceObstacleNodes) {
    if (!activeIds.has(id)) { vehicle.remove(); raceObstacleNodes.delete(id); }
  }
  if ((race.crashId || 0) > lastCrashId) {
    lastCrashId = race.crashId;
    const overlay = root.querySelector('#race-crash');
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    const playerCar = root.querySelector('#race-player');
    playerCar.classList.remove('crashed');
    void playerCar.offsetWidth;
    playerCar.classList.add('crashed');
  }
}

function renderFlappy(state, mine) {
  const flight = mine.flappy || {};
  const passed = flight.blockersPassed || 0;
  const tier = Math.min(4, Math.floor(passed / 6) + 1);
  root.querySelector('#flappy-count').textContent = passed + ' / 20 BLOCKERS';
  root.querySelector('#flappy-difficulty').textContent = ['EASY FLIGHT','WIND PICKING UP','TIGHTER GAPS','MAXIMUM TURBULENCE'][tier - 1];
  root.querySelector('#flappy-progress-fill').style.width = (passed / 20 * 100) + '%';
  const rocket = root.querySelector('#flappy-rocket');
  rocket.style.top = (flight.y * 100) + '%';
  const avatar = root.querySelector('#flappy-avatar');
  const fallback = root.querySelector('#flappy-default');
  if (mine.player?.avatar) { avatar.src = mine.player.avatar; avatar.hidden = false; fallback.hidden = true; }
  else { avatar.hidden = true; avatar.removeAttribute('src'); fallback.hidden = false; }
  const container = root.querySelector('#flappy-obstacles');
  const active = new Set();
  for (const obstacle of flight.obstacles || []) {
    active.add(obstacle.id);
    let node = container.querySelector('[data-id="' + obstacle.id + '"]');
    if (!node) { node = document.createElement('div'); node.className = 'flappy-obstacle'; node.dataset.id = obstacle.id; node.innerHTML = '<div class="flappy-pillar top"></div><div class="flappy-pillar bottom"></div>'; container.append(node); }
    node.style.left = (obstacle.x * 100) + '%';
    const gap = Math.max(0.22, 0.38 - Math.floor(passed / 6) * 0.035);
    node.querySelector('.top').style.height = ((obstacle.gapY - gap / 2) * 100) + '%';
    node.querySelector('.bottom').style.top = ((obstacle.gapY + gap / 2) * 100) + '%';
  }
  for (const node of container.children) if (!active.has(Number(node.dataset.id))) node.remove();
  if ((flight.crashId || 0) > lastFlappyCrashId) {
    lastFlappyCrashId = flight.crashId;
    const overlay = root.querySelector('#flappy-crash');
    overlay.classList.remove('show'); void overlay.offsetWidth; overlay.classList.add('show');
  }
}

function setFeedback(message, kind) {
  const el = document.querySelector('#feedback');
  if (!el) return;
  el.textContent = message;
  el.className = kind || '';
}
function ordinal(place) { return place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : place + 'th'; }
function readableError(code) {
  return ({
    SLOT_OCCUPIED: 'This player slot is already in use',
    INVALID_PROFILE: 'That profile photo is not supported. Try a JPG, PNG or WebP image.',
    GAME_PAUSED: 'The game is paused',
    LEVEL_NOT_RUNNING: 'The level is not running',
    PLAYER_ALREADY_FINISHED: 'You have already finished',
    NOT_IN_THIS_LEVEL: 'You can join the next level',
    CONTROLLER_ONLY: 'Only the first player can do that',
    LEVEL_NOT_FINISHED: 'Wait until the scene is complete',
    CONFIG_LOCKED_DURING_GAME: 'Config is locked while playing',
    INVALID_TARGET_CYCLES: 'Choose between 1 and 100 cycles',
    DUPLICATE_INPUT: 'Input already received',
    STALE_ROUND: 'That dice roll has passed — use the current dice',
    STALE_BURGER_ROUND: 'That burger recipe has passed — use the current recipe',
    ALREADY_ANSWERED: 'You already answered this dice roll',
    FINISH_NOT_AVAILABLE: 'This level runs until all three places are decided',
    RACE_PENALTY_ACTIVE: 'Recovering from a crash — wait 2 seconds',
    FLAPPY_RECOVERING: 'Rocket recovering — tap again in a moment'
  })[code] || code || 'Something went wrong';
}

async function resizeAvatar(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Unsupported image');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.78);
    if (result.length > 175000) throw new Error('Image too large');
    return result;
  } finally { URL.revokeObjectURL(source); }
}
