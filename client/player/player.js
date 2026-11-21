import { io } from 'socket.io-client';
import './player.css';

const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const sessionId = params.get('sessionId');
const joinToken = params.get('joinToken');
let socket;
let joined = false;
let playerColor;

if (!sessionId || !joinToken) {
  root.textContent = 'Invalid player link';
} else {
  root.innerHTML = '<h1>Join RGB</h1><form id="join"><input name="name" maxlength="20" placeholder="Your name" required><button>Join game</button></form><p id="status"></p>';
  root.querySelector('#join').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name').trim();
    if (!name || socket) return;
    socket = io({ auth: { sessionId, joinToken } });
    socket.on('connect', () => socket.emit('player:join', { name }, (ack) => {
      if (!ack.ok) {
        if (!joined) root.querySelector('#status').textContent = readableError(ack.error);
        return;
      }
      if (!joined) {
        joined = true;
        playerColor = ack.color;
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

function renderController(name, color, state) {
  root.innerHTML = '<header><div><h1 id="player-name"></h1><p id="player-color"></p></div><span id="connection-state">Connected</span></header>' +
    '<section class="progress"><strong id="cycle-count">0 / 20</strong><span id="points">0 points</span><div class="track"><div id="bar"></div></div><p id="feedback">Wait for the host to start</p></section>' +
    '<div class="sequence" id="sequence"><span>R</span><span>G</span><span>B</span></div>' +
    '<div class="pad"><button data-a="R" class="red">R</button><button data-a="G" class="green">G</button><button data-a="B" class="blue">B</button></div>';
  document.querySelector('#player-name').textContent = name;
  document.querySelector('#player-color').textContent = color + ' PLAYER';
  root.querySelectorAll('[data-a]').forEach((button) => button.addEventListener('click', () => {
    if (button.disabled || !socket?.connected) return;
    socket.emit('player:input', { action: button.dataset.a }, (result) => {
      if (!result.ok) setFeedback(readableError(result.error), 'warning');
      else if (!result.correct) setFeedback('Wrong colour — start the sequence again', 'warning');
      else if (result.cycleCompleted) setFeedback('Cycle complete! Nice work.', 'success');
      else setFeedback('Correct — keep going!', 'success');
    });
  }));
  updateController(state);
}

function updateController(state) {
  const mine = state.players.find((player) => player.color === playerColor);
  if (!mine) return;
  document.querySelector('#cycle-count').textContent = mine.cycles + ' / ' + state.targetCycles;
  document.querySelector('#points').textContent = mine.totalPoints + ' total points';
  document.querySelector('#bar').style.width = (mine.cycles / state.targetCycles * 100) + '%';
  const sequence = document.querySelector('#sequence');
  [...sequence.children].forEach((item, index) => {
    item.classList.toggle('done', index < mine.progressIndex);
    item.classList.toggle('current', index === mine.progressIndex && state.status === 'playing' && !state.paused);
  });
  root.querySelectorAll('[data-a]').forEach((button) => {
    button.disabled = state.status !== 'playing' || state.paused || mine.completed || !mine.activeForRound;
  });
  if (mine.completed) setFeedback('You finished ' + mine.place + ordinal(mine.place) + ' · +' + mine.pointsEarned + ' points!', 'success');
  else if (state.status === 'finished') setFeedback('Level finished. You earned no placement points this level.', 'warning');
  else if (state.paused) setFeedback('Game paused by host', 'warning');
  else if (state.status === 'waiting') setFeedback('Waiting for host to start level ' + state.stage, '');
  else if (!mine.activeForRound) setFeedback('You joined — ready for the next level', '');
}

function setFeedback(message, kind) {
  const el = document.querySelector('#feedback');
  if (!el) return;
  el.textContent = message;
  el.className = kind || '';
}
function ordinal(place) { return place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'; }
function readableError(code) {
  return ({
    SLOT_OCCUPIED: 'This player slot is already in use',
    GAME_PAUSED: 'The game is paused',
    LEVEL_NOT_RUNNING: 'The level has not started',
    PLAYER_ALREADY_FINISHED: 'You have already finished this level',
    NOT_IN_THIS_LEVEL: 'You can join the next level'
  })[code] || code || 'Something went wrong';
}
