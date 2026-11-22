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
    '<section id="race-screen" class="race-screen" hidden><div class="race-hud"><strong id="race-distance">0 m / 3,000 m</strong><span id="race-speed">1.0× SPEED</span></div><div class="race-road"><div class="road-lane-line line-one"></div><div class="road-lane-line line-two"></div><div id="race-obstacles" class="race-obstacles"></div><div id="race-player" class="race-player"><img id="race-avatar" alt="Your profile" hidden><span id="race-car">🚗</span></div><div id="race-crash" class="race-crash" aria-live="polite">CRASH! +2 SEC</div></div><div class="race-status"><span id="race-lane-label">CENTRE LANE</span><span id="race-penalty"></span></div><div class="race-progress"><div id="race-progress-fill"></div></div></section>' +
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
      socket.emit('player:input', payload, (result) => {
        button.classList.remove('pressed');
        if (!result.ok) setFeedback(readableError(result.error), 'warning');
        else if (!result.correct) setFeedback(latestState?.stage === 2
          ? '✕ Wrong position — wait for the next dice roll'
          : 'Wrong colour — sequence restarted', 'warning');
        else if (latestState?.stage === 3) setFeedback('Moving to ' + ({ R: 'left', G: 'centre', B: 'right' }[payload.action]) + ' lane', 'success');
        else if (result.pointAwarded) setFeedback('Correct! +1 point', 'success');
        else if (result.cycleCompleted) setFeedback('Cycle complete!', 'success');
        else setFeedback('Good — keep going!', 'success');
      });
    }, { passive: false });
    button.addEventListener('pointerup', () => button.classList.remove('pressed'));
    button.addEventListener('pointercancel', () => button.classList.remove('pressed'));
    button.addEventListener('lostpointercapture', () => button.classList.remove('pressed'));
  });
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
  root.querySelectorAll('[data-a]').forEach((button) => {
    button.disabled = state.status !== 'playing' || state.paused || mine.completed ||
      !mine.activeForRound || (isDice && mine.roundAttempted) || (isRace && (mine.race?.penaltyMs || 0) > 0);
  });
  const sequence = root.querySelector('#sequence');
  const hint = root.querySelector('#input-hint');
  sequence.hidden = isRace;
  hint.hidden = isRace;
  root.querySelector('#race-screen').hidden = !isRace;
  if (isDice) {
    sequence.innerHTML = '<span>R</span><span>G</span><span>B</span>';
    hint.textContent = 'R = LEFT  ·  G = MIDDLE  ·  B = RIGHT';
  } else if (!isRace) {
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
  else if (isRace) setFeedback('Dodge traffic! R left · G centre · B right', '');
  else if (isDice && mine.roundAttempted && mine.roundFeedback === 'wrong') setFeedback('✕ Wrong answer — wait for next dice roll', 'warning');
  else if (isDice && mine.roundFeedback === 'correct') setFeedback('Correct! +1 point', 'success');
  else if (isDice && mine.roundAttempted) setFeedback('Answer received — wait for next roll', '');
  else if (isDice) setFeedback('Which position has the biggest number?', '');
  else setFeedback('Tap R → G → B in order', '');
  renderControls(state);
  const target = root.querySelector('#target-cycles');
  if (target && document.activeElement !== target) target.value = state.targetCycles;
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
  playerCar.style.left = ((race.lane ?? 1) * 33.333 + 16.667) + '%';
  const obstacles = root.querySelector('#race-obstacles');
  obstacles.innerHTML = '';
  for (const item of race.obstacles || []) {
    const vehicle = document.createElement('span');
    vehicle.className = 'race-obstacle';
    vehicle.textContent = item.type;
    vehicle.style.left = ((item.lane * 33.333) + 16.667) + '%';
    vehicle.style.top = (item.progress * 100) + '%';
    obstacles.append(vehicle);
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
    ALREADY_ANSWERED: 'You already answered this dice roll',
    FINISH_NOT_AVAILABLE: 'Level 2 runs until all three places are decided',
    RACE_PENALTY_ACTIVE: 'Recovering from a crash — wait 2 seconds'
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
