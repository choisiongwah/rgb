import QRCode from 'qrcode';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import './host.css';

const $ = (selector) => document.querySelector(selector);
let token = sessionStorage.getItem('rgb-token');
let socket;
let game;
let currentState;

function show(user) {
  $('#login').hidden = true;
  $('#dashboard').hidden = false;
  $('#welcome').textContent = 'Signed in as ' + user.username + ' (' + user.role + ')';
}
function updateControls(state) {
  $('#start').disabled = state.status !== 'waiting';
  $('#pause').disabled = state.status !== 'playing';
  $('#pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('#finish').disabled = state.status !== 'playing';
  $('#next').disabled = state.status !== 'finished';
}
function renderSlots(state) {
  for (const player of state.players) {
    const status = $('#slot-status-' + player.color);
    if (status) status.textContent = player.joined
      ? (player.player?.name || 'Player') + (player.connected ? ' · Connected' : ' · Disconnected')
      : 'Scan to join';
  }
}
function applyState(state) {
  currentState = state;
  renderSlots(state);
  updateControls(state);
  if (game?.scene?.keys?.RGBScene) game.scene.keys.RGBScene.updateState(state);
}

class RGBScene extends Phaser.Scene {
  constructor() { super('RGBScene'); }
  create() {
    this.cameras.main.setBackgroundColor('#111827');
    this.title = this.add.text(0, 24, 'RGB SEQUENCE RUSH', { fontSize: '34px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5, 0);
    this.subtitle = this.add.text(0, 76, 'Complete R → G → B. First to 20 cycles wins.', { fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.stageText = this.add.text(0, 120, 'LEVEL 1 · WAITING', { fontSize: '22px', color: '#fbbf24', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.sequenceText = this.add.text(0, 166, 'R     →     G     →     B', { fontSize: '48px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.statusText = this.add.text(0, 235, 'Waiting for players…', { fontSize: '22px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.playerTexts = [];
    this.scale.on('resize', (size) => this.layout(size.width));
    this.layout(this.scale.width);
    if (currentState) this.updateState(currentState);
  }
  layout(width) {
    const center = width / 2;
    this.title?.setX(center);
    this.subtitle?.setX(center);
    this.stageText?.setX(center);
    this.sequenceText?.setX(center);
    this.statusText?.setX(center);
    this.playerTexts?.forEach((item, index) => item.setPosition(width * (index + 0.5) / 3, 315));
  }
  updateState(state) {
    if (!this.title) return;
    this.stageText.setText('LEVEL ' + state.stage + ' · ' + (state.paused ? 'PAUSED' : state.status.toUpperCase()));
    this.statusText.setText(state.status === 'waiting' ? 'Ready when you are — host can start the level'
      : state.status === 'finished' ? 'LEVEL COMPLETE'
      : state.paused ? 'GAME PAUSED' : 'Race to ' + state.targetCycles + ' completed cycles!');
    this.playerTexts.forEach((item) => item.destroy());
    this.playerTexts = [];
    const players = state.players.filter((player) => player.joined);
    const colors = { RED: '#f87171', GREEN: '#4ade80', BLUE: '#60a5fa' };
    players.forEach((player, index) => {
      const label = (player.player?.name || player.color) +
        '\n' + player.cycles + ' / ' + state.targetCycles + ' cycles' +
        '\n' + player.totalPoints + ' total points' +
        (player.place ? '\n' + player.place + getOrdinalSuffix(player.place) + ' place · +' + player.pointsEarned : '') +
        (player.completed ? '\nFINISHED' : player.activeForRound && !player.connected ? '\nDISCONNECTED' : '');
      const item = this.add.text(this.scale.width * (index + 0.5) / 3, 315, label, {
        fontSize: '22px', color: colors[player.color], align: 'center', lineSpacing: 8,
        backgroundColor: '#1f2937', padding: { x: 18, y: 14 }
      }).setOrigin(0.5, 0);
      this.playerTexts.push(item);
    });
    this.layout(this.scale.width);
  }
}
function getOrdinalSuffix(place) {
  return place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
}

async function createRoom() {
  const response = await fetch('/api/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  const session = await response.json();
  if (!response.ok) { $('#error').textContent = session.error || 'Could not create session'; return; }
  const configResponse = await fetch('/api/config');
  const config = await configResponse.json();
  const publicBaseUrl = (config.publicBaseUrl || location.origin).replace(/\/$/, '');

  $('#room').hidden = false;
  $('#session-id').textContent = 'Session ' + session.id;
  $('#slots').innerHTML = '';
  for (const player of session.players) {
    const card = document.createElement('article');
    card.className = 'slot ' + player.color.toLowerCase();
    const title = document.createElement('h3');
    title.textContent = player.color;
    const qr = document.createElement('img');
    qr.alt = 'Join ' + player.color;
    qr.src = await QRCode.toDataURL(publicBaseUrl + '/player/?sessionId=' + session.id + '&joinToken=' + player.joinToken);
    const status = document.createElement('p');
    status.id = 'slot-status-' + player.color;
    status.textContent = 'Scan to join';
    card.append(title, qr, status);
    $('#slots').append(card);
  }

  socket?.disconnect();
  socket = io({ auth: { token } });
  socket.on('connect', () => socket.emit('host:subscribe', { sessionId: session.id }, (ack) => {
    if (ack.ok) applyState(ack.session);
    else $('#error').textContent = ack.error;
  }));
  socket.on('game:state', applyState);

  game?.destroy(true);
  game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game-root', width: 1200, height: 650,
    backgroundColor: '#111827',
    scale: { mode: Phaser.Scale.RESIZE, width: 1200, height: 650 },
    scene: [RGBScene]
  });
  applyState(session);
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
  });
  const data = await response.json();
  if (!response.ok) { $('#error').textContent = data.error; return; }
  token = data.token;
  sessionStorage.setItem('rgb-token', token);
  show(data.user);
});
$('#logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  sessionStorage.removeItem('rgb-token');
  location.reload();
});
$('#create').addEventListener('click', createRoom);
$('#start').addEventListener('click', () => socket?.emit('host:start', (ack) => { if (!ack.ok) $('#error').textContent = ack.error; }));
$('#pause').addEventListener('click', () => socket?.emit(currentState?.paused ? 'host:resume' : 'host:pause', (ack) => { if (!ack.ok) $('#error').textContent = ack.error; }));
$('#finish').addEventListener('click', () => socket?.emit('host:finish-level', (ack) => { if (!ack.ok) $('#error').textContent = ack.error; }));
$('#next').addEventListener('click', () => socket?.emit('host:next-level', (ack) => { if (!ack.ok) $('#error').textContent = ack.error; }));

if (token) {
  fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((response) => { if (!response.ok) throw new Error('Session expired'); return response.json(); })
    .then((data) => show(data.user))
    .catch(() => { sessionStorage.removeItem('rgb-token'); token = null; });
}
