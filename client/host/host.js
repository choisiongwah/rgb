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
function renderSlots(state) {
  for (const player of state.players) {
    const status = $('#slot-status-' + player.color);
    const qr = $('#qr-' + player.color);
    const count = $('#count-' + player.color);
    const result = $('#result-' + player.color);
    const mascot = $('#mascot-' + player.color);\n    const avatar = $('#avatar-' + player.color);\n    if (mascot) { mascot.hidden = !player.joined; mascot.className = 'player-mascot ' + (player.player?.character || 'astronaut'); }\n    if (avatar) { if (player.player?.avatar) { avatar.src = player.player.avatar; avatar.hidden = false; } else { avatar.removeAttribute('src'); avatar.hidden = true; } }
    if (status) status.textContent = player.joined
      ? (player.player?.name || 'Player') + (player.connected ? ' · CONNECTED' : ' · DISCONNECTED')
      : 'SCAN QR TO JOIN';
    if (qr) qr.hidden = player.joined;
    if (count) {
      count.hidden = !player.joined;
      count.textContent = state.stage === 2
        ? player.successCount + ' / ' + state.diceTarget
        : player.cycles + ' / ' + state.targetCycles;
    }
    if (result) {
      result.hidden = !player.joined;
      result.className = 'player-result';
      if (player.place) {
        result.textContent = ordinal(player.place);
        result.classList.add('place');
      } else if (player.roundFeedback === 'wrong') {
        result.textContent = '✕';
        result.classList.add('wrong');
      } else if (player.roundFeedback === 'correct') {
        result.textContent = '+1';
        result.classList.add('correct');
      } else result.textContent = '';
    }
  }
}
function applyState(state) {
  currentState = state;
  renderSlots(state);
  if (game?.scene?.keys?.RGBScene) game.scene.keys.RGBScene.updateState(state);
}

class RGBScene extends Phaser.Scene {
  constructor() { super('RGBScene'); this.celebrated = new Set(); this.successSeen = new Map(); this.lastDiceRound = null; this.audioContext = null; }
  create() {
    this.cameras.main.setBackgroundColor('#111827');
    this.title = this.add.text(0, 0, 'RGB SEQUENCE RUSH', { fontSize: '34px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5, 0);
    this.subtitle = this.add.text(0, 0, '', { fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.stageText = this.add.text(0, 0, 'LEVEL 1 · WAITING', { fontSize: '22px', color: '#fbbf24', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.sequenceText = this.add.text(0, 0, 'R     →     G     →     B', { fontSize: '48px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.statusText = this.add.text(0, 0, 'Waiting for players…', { fontSize: '22px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.playerTexts = [];
    this.diceGraphics = this.add.graphics();
    this.diceNumbers = [0, 1, 2].map(() => this.add.text(0, 0, '', {
      fontSize: '72px', fontStyle: 'bold', color: '#111827'
    }).setOrigin(0.5));
    this.diceLabels = ['LEFT · R', 'MIDDLE · G', 'RIGHT · B'].map((label) =>
      this.add.text(0, 0, label, { fontSize: '18px', fontStyle: 'bold', color: '#cbd5e1' }).setOrigin(0.5)
    );
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(0, 0, 10, 16, 2);
    graphics.generateTexture('rgb-confetti', 10, 16);
    graphics.destroy();
    this.scale.on('resize', (size) => this.layout(size.width, size.height));
    this.layout(this.scale.width, this.scale.height);
    if (currentState) this.updateState(currentState);
  }
  layout(width, height) {
    const center = width / 2;
    this.title?.setPosition(center, height * 0.045).setFontSize(Math.max(20, Math.min(36, width * 0.03)));
    this.subtitle?.setPosition(center, height * 0.16).setFontSize(Math.max(12, Math.min(20, width * 0.017)));
    this.stageText?.setPosition(center, height * 0.26).setFontSize(Math.max(16, Math.min(25, width * 0.021)));
    this.sequenceText?.setPosition(center, height * 0.39).setFontSize(Math.max(19, Math.min(48, width * 0.04)));
    this.statusText?.setPosition(center, height * 0.88).setFontSize(Math.max(13, Math.min(23, width * 0.019)));
    this.playerTexts?.forEach((item, index) => item.setPosition(width * (index + 0.5) / 3, height * 0.53));
    const size = Math.min(height * 0.27, width * 0.15, 170);
    const gap = Math.min(width * 0.055, 54);
    const y = height * 0.59;
    this.diceGraphics?.clear();
    for (let index = 0; index < 3; index += 1) {
      const x = center + (index - 1) * (size + gap);
      this.diceGraphics?.fillStyle(0xf8fafc, 1);
      this.diceGraphics?.lineStyle(5, [0xf87171, 0x4ade80, 0x60a5fa][index], 1);
      this.diceGraphics?.fillRoundedRect(x - size / 2, y - size / 2, size, size, 18);
      this.diceGraphics?.strokeRoundedRect(x - size / 2, y - size / 2, size, size, 18);
      this.diceNumbers?.[index]?.setPosition(x, y).setFontSize(Math.max(32, size * 0.52));
      this.diceLabels?.[index]?.setPosition(x, y + size * 0.72).setFontSize(Math.max(11, Math.min(19, width * 0.016)));
    }
  }
  flashSuccess(index) {
    const x = this.scale.width * (index + 0.5) / 3;
    const y = this.scale.height * 0.48;
    const marker = this.add.text(x, y, 'O', {
      fontSize: Math.max(72, Math.min(150, this.scale.width * 0.11)),
      fontStyle: 'bold', color: '#4ade80', stroke: '#052e16', strokeThickness: 7
    }).setOrigin(0.5).setScale(0.25).setAlpha(0);
    this.tweens.add({ targets: marker, scale: 1.25, alpha: 1, duration: 180, yoyo: true,
      hold: 220, onComplete: () => marker.destroy() });
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        this.audioContext ||= new AudioCtor();
        if (this.audioContext.state === 'suspended') this.audioContext.resume();
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(740, this.audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1040, this.audioContext.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.16, this.audioContext.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.24);
        oscillator.connect(gain); gain.connect(this.audioContext.destination);
        oscillator.start(); oscillator.stop(this.audioContext.currentTime + 0.25);
      }
    } catch { /* Audio is optional when the browser blocks playback. */ }
  }
  animateDiceRoll(values) {
    this.diceNumbers.forEach((item, index) => {
      this.tweens.killTweensOf(item);
      item.setScale(0.55).setAngle(-12);
      this.tweens.add({ targets: item, scale: 1, angle: 0, duration: 320, ease: 'Back.Out' });
      let ticks = 0;
      const flicker = () => {
        if (!item.active || ticks >= 7) { item.setText(String(values[index] ?? '')); return; }
        item.setText(String(1 + Math.floor(Math.random() * 6)));
        ticks += 1;
        this.time.delayedCall(45 + ticks * 8, flicker);
      };
      flicker();
    });
    this.diceGraphics.setAlpha(0.55);
    this.tweens.add({ targets: this.diceGraphics, alpha: 1, duration: 420, ease: 'Sine.Out' });
  }
  celebrate(index, place) {
    const x = this.scale.width * (index + 0.5) / 3;
    const y = this.scale.height * 0.5;
    const emitter = this.add.particles(x, y, 'rgb-confetti', {
      speed: { min: 120, max: 340 }, angle: { min: 200, max: 340 },
      gravityY: 260, lifespan: 1500, quantity: 48, scale: { start: 1.2, end: 0.2 },
      rotate: { min: 0, max: 360 },
      tint: [0xfacc15, 0x4ade80, 0x60a5fa, 0xf472b6, 0xffffff],
      emitting: false
    });
    emitter.explode(48, x, y);
    this.time.delayedCall(1800, () => emitter.destroy());
  }
  updateState(state) {
    if (!this.title) return;
    const isDice = state.stage === 2;
    this.title.setText(isDice ? 'DICE REACTION' : 'RGB SEQUENCE RUSH');
    this.stageText.setText('LEVEL ' + state.stage + ' · ' + (state.paused ? 'PAUSED' : state.status.toUpperCase()));
    this.subtitle.setText(isDice
      ? 'Three unique dice · First to 8 correct answers wins.'
      : 'Complete R → G → B. First to ' + state.targetCycles + ' cycles wins.');
    this.sequenceText.setText(isDice ? 'R = LEFT       G = MIDDLE       B = RIGHT' : 'R     →     G     →     B');
    this.statusText.setText(state.status === 'waiting' ? 'Waiting for players'
      : state.status === 'finished' ? 'LEVEL COMPLETE · NEXT LEVEL READY'
      : state.paused ? 'GAME PAUSED'
      : isDice ? 'Tap the colour matching the largest number'
      : 'Race to ' + state.targetCycles + ' completed cycles!');
    this.diceGraphics.setVisible(isDice);
    this.diceNumbers.forEach((item, index) => {
      item.setVisible(isDice);
      item.setText(isDice && state.diceValues ? String(state.diceValues[index]) : '');
    });
    if (isDice && state.diceRoundId !== this.lastDiceRound) {
      this.lastDiceRound = state.diceRoundId;
      this.animateDiceRoll(state.diceValues || []);
    }
    this.diceLabels.forEach((item) => item.setVisible(isDice));
    const players = state.players.filter((player) => player.joined);
    const colors = { RED: '#f87171', GREEN: '#4ade80', BLUE: '#60a5fa' };
    if (!isDice) {
      players.forEach((player) => {
        const index = state.players.findIndex((slot) => slot.color === player.color);
        const placeLine = player.place ? '\\n' + ordinal(player.place) + ' PLACE  ·  +' + player.pointsEarned + ' POINTS' : '';
        const label = (player.player?.name || player.color) +
          '\\n' + player.cycles + ' / ' + state.targetCycles + ' cycles' +
          '\\n' + player.totalPoints + ' TOTAL POINTS' + placeLine +
          (player.activeForRound && !player.connected ? '\\nDISCONNECTED' : '');
        if (!this.playerTexts[index]) {
          this.playerTexts[index] = this.add.text(this.scale.width * (index + 0.5) / 3, this.scale.height * 0.53, label, {
            fontSize: player.place ? '25px' : '19px', color: colors[player.color], align: 'center', lineSpacing: 6,
            backgroundColor: '#1f2937', padding: { x: 12, y: 10 }
          }).setOrigin(0.5, 0);
        } else {
          this.playerTexts[index].setText(label).setColor(colors[player.color]).setFontSize(player.place ? 25 : 19);
        }
      });
    }
    for (let index = 0; index < this.playerTexts.length; index += 1) {
      if (isDice || !state.players[index]?.joined) {
        this.playerTexts[index]?.destroy();
        this.playerTexts[index] = null;
      }
    }
    players.forEach((player) => {
      const index = state.players.findIndex((slot) => slot.color === player.color);
      const feedbackId = player.successFeedbackId || 0;
      const previous = this.successSeen.get(player.color) || 0;
      if (feedbackId > previous) {
        this.successSeen.set(player.color, feedbackId);
        this.flashSuccess(index);
      }
      if (player.place) {
        const index = state.players.findIndex((slot) => slot.color === player.color);
        const key = state.stage + ':' + player.color + ':' + player.place;
        if (!this.celebrated.has(key)) {
          this.celebrated.add(key);
          this.celebrate(index, player.place);
        }
      }
    });
    this.layout(this.scale.width, this.scale.height);
  }
}
function ordinal(place) { return place === 1 ? '1ST' : place === 2 ? '2ND' : place === 3 ? '3RD' : place + 'TH'; }

async function createRoom() {
  const response = await fetch('/api/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  const session = await response.json();
  if (!response.ok) { $('#error').textContent = session.error || 'Could not create session'; return; }
  const configResponse = await fetch('/api/config');
  const config = await configResponse.json();
  const publicBaseUrl = (config.publicBaseUrl || location.origin).replace(/\/$/, '');

  $('#room').hidden = false;
  $('#session-id').textContent = 'Session ' + session.id;
  $('#dashboard').classList.add('room-active');
  $('#player-strip').innerHTML = '';
  for (const player of session.players) {
    const card = document.createElement('article');
    card.className = 'player-panel ' + player.color.toLowerCase();
    const title = document.createElement('h3');
    title.textContent = player.color;
    const mascot = document.createElement('div');
    mascot.id = 'mascot-' + player.color;
    mascot.className = 'player-mascot ' + (player.player?.character || 'astronaut');
    mascot.hidden = true;
    const head = document.createElement('div');
    head.className = 'mascot-head';
    const visor = document.createElement('div');
    visor.className = 'mascot-visor';
    const avatar = document.createElement('img');
    avatar.id = 'avatar-' + player.color;
    avatar.alt = 'Player profile';
    visor.append(avatar);
    head.append(visor);
    const body = document.createElement('div');
    body.className = 'mascot-body';
    mascot.append(head, body);
    const qr = document.createElement('img');
    qr.id = 'qr-' + player.color;
    qr.alt = 'Join ' + player.color;
    qr.src = await QRCode.toDataURL(publicBaseUrl + '/player/?sessionId=' + session.id + '&joinToken=' + player.joinToken);
    const status = document.createElement('p');
    status.id = 'slot-status-' + player.color;
    status.className = 'player-status';
    status.textContent = 'SCAN QR TO JOIN';
    const count = document.createElement('strong');
    count.id = 'count-' + player.color;
    count.className = 'player-count';
    count.textContent = '0';
    const result = document.createElement('div');
    result.id = 'result-' + player.color;
    result.className = 'player-result';
    card.append(title, mascot, qr, status, count, result);
    $('#player-strip').append(card);
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
    type: Phaser.AUTO, parent: 'game-root', width: 1200, height: 700,
    backgroundColor: '#111827',
    scale: { mode: Phaser.Scale.RESIZE, width: 1200, height: 700 },
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
  if (!response.ok) { $('#login-error').textContent = data.error; return; }
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

if (token) {
  fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((response) => { if (!response.ok) throw new Error('Session expired'); return response.json(); })
    .then((data) => show(data.user))
    .catch(() => { sessionStorage.removeItem('rgb-token'); token = null; });
}
