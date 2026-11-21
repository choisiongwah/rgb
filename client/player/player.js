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

if (!sessionId || !joinToken) {
  root.textContent = 'Invalid player link';
} else {
  root.innerHTML = '<div class="join-card"><h1>Join RGB</h1><form id="join"><input name="name" maxlength="20" placeholder="Your name" required><button>Join game</button></form><p id="status" role="status"></p></div>';
  root.querySelector('#join').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name').trim();
    if (!name || socket) return;
    socket = io({ auth: { sessionId, joinToken }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('player:join', { name }, (ack) => {
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
    '<div class="pad"><button data-a="R" class="red" aria-label="Red / Left">R</button><button data-a="G" class="green" aria-label="Green / Middle">G</button><button data-a="B" class="blue" aria-label="Blue / Right">B</button></div>' +
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
    if (isPlaying) buttons.push(['finish', 'Finish level', false, 'danger']);
    if (state.status !== 'waiting') buttons.push(['reset', 'Reset level', false, 'danger']);
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
      if (action === 'config') {
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
  root.querySelectorAll('[data-a]').forEach((button) => {
    button.disabled = state.status !== 'playing' || state.paused || mine.completed ||
      !mine.activeForRound || (isDice && mine.roundAttempted);
  });
  const sequence = root.querySelector('#sequence');
  const hint = root.querySelector('#input-hint');
  if (isDice) {
    sequence.innerHTML = '<span>R</span><span>G</span><span>B</span>';
    hint.textContent = 'R = LEFT  ·  G = MIDDLE  ·  B = RIGHT';
  } else {
    sequence.innerHTML = '<span>R</span><span>G</span><span>B</span>';
    hint.textContent = 'Tap R → G → B in order';
  }
  if (mine.completed) setFeedback('You finished — ' + ordinal(mine.place) + ' place!', 'success');
  else if (state.status === 'finished') setFeedback('Level complete. Next level is ready.', 'success');
  else if (state.paused) setFeedback('Game paused', 'warning');
  else if (state.status === 'waiting') setFeedback('Waiting for the game to start', '');
  else if (!mine.activeForRound) setFeedback('Ready for the next level', '');
  else if (isDice && mine.roundAttempted && mine.roundFeedback === 'wrong') setFeedback('✕ Wrong answer — wait for next dice roll', 'warning');
  else if (isDice && mine.roundFeedback === 'correct') setFeedback('Correct! +1 point', 'success');
  else if (isDice && mine.roundAttempted) setFeedback('Answer received — wait for next roll', '');
  else if (isDice) setFeedback('Which position has the biggest number?', '');
  else setFeedback('Tap R → G → B in order', '');
  renderControls(state);
  const target = root.querySelector('#target-cycles');
  if (target && document.activeElement !== target) target.value = state.targetCycles;
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
    ALREADY_ANSWERED: 'You already answered this dice roll'
  })[code] || code || 'Something went wrong';
}
