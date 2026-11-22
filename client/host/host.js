import QRCode from 'qrcode';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import './host.css';

const $ = (selector) => document.querySelector(selector);
let token = sessionStorage.getItem('rgb-token');
let socket;
let game;
let currentState;
let successAudioContext;

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
    const mascot = $('#mascot-' + player.color);
    const avatar = $('#avatar-' + player.color);
    if (mascot) { mascot.hidden = !player.joined; mascot.className = 'player-mascot ' + (player.player?.character || 'astronaut'); }
    if (avatar) { if (player.player?.avatar) { avatar.src = player.player.avatar; avatar.hidden = false; } else { avatar.removeAttribute('src'); avatar.hidden = true; } }
    if (status) status.textContent = player.joined
      ? (player.player?.name || 'Player') + (player.connected ? ' · CONNECTED' : ' · DISCONNECTED')
      : 'SCAN QR TO JOIN';
    if (qr) qr.hidden = player.joined;
    if (count) {
      count.hidden = !player.joined;
      count.textContent = state.stage === 2
        ? player.successCount + ' / ' + state.diceTarget
        : state.stage === 3 ? Math.floor(player.race?.distanceMeters || 0).toLocaleString() + ' m'
           : state.stage === 4 ? (player.flappy?.blockersPassed || 0) + ' / 20'
          : state.stage === 5 ? player.successCount + ' / ' + state.burgerTarget
          : state.stage === 6 ? player.successCount + ' / ' + state.ufoTarget
            : state.stage === 7 ? 'R ' + (player.pieHits?.R || 0) + '  G ' + (player.pieHits?.G || 0) + '  B ' + (player.pieHits?.B || 0)
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
  constructor() { super('RGBScene'); this.celebrated = new Set(); this.successSeen = new Map(); this.lastDiceRound = null; this.lastBurgerRound = null; this.lastBurgerDrop = 0; this.lastBurgerComplete = 0; this.lastPieHit = 0; this.audioContext = null; }
  preload() { for(let id=1;id<=8;id++) this.load.svg('ufo-'+id,new URL('./ufo/ufo-'+String(id).padStart(2,'0')+'.svg',import.meta.url).href,{width:180,height:100}); }
  create() {
    this.cameras.main.setBackgroundColor('#111827');
    this.title = this.add.text(0, 0, 'RGB SEQUENCE RUSH', { fontSize: '34px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5, 0);
    this.subtitle = this.add.text(0, 0, '', { fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.stageText = this.add.text(0, 0, 'LEVEL 1 · WAITING', { fontSize: '22px', color: '#fbbf24', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.sequenceText = this.add.text(0, 0, 'R     →     G     →     B', { fontSize: '48px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.statusText = this.add.text(0, 0, 'Waiting for players…', { fontSize: '22px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.burgerStackText = this.add.text(0, 0, '🥬   🥩   🍅', { fontSize: '64px', color: '#ffffff' }).setOrigin(0.5);
    this.burgerFallingText = this.add.text(0, 0, '', { fontSize: '58px' }).setOrigin(0.5).setVisible(false);
    this.burgerTopBunText = this.add.text(0, 0, '🍞', { fontSize: '64px' }).setOrigin(0.5).setVisible(false);
    this.pieContainer=this.add.container(0,0).setVisible(false); this.pieGraphics=this.add.graphics(); this.pieContainer.add(this.pieGraphics); this.piePointer=this.add.triangle(0,0,0,0,28,0,14,22,0xf8fafc).setVisible(false); this.pieKnife=this.add.text(0,0,'🔪',{fontSize:'48px'}).setOrigin(.5).setVisible(false); this.pieHud=this.add.text(0,0,'R 0/6   G 0/6   B 0/6',{fontSize:'22px',fontStyle:'bold',color:'#fff'}).setOrigin(.5).setVisible(false);
    this.ufoWindow=this.add.rectangle(0,0,100,40,0x0b1020).setStrokeStyle(3,0x93c5fd).setVisible(false);
    this.ufoTarget=this.add.image(0,0,'ufo-1').setVisible(false);
    this.ufoOptions=[0,1,2].map(()=>this.add.image(0,0,'ufo-1').setVisible(false));
    this.ufoOptionLabels=['R · LEFT','G · MIDDLE','B · RIGHT'].map(t=>this.add.text(0,0,t,{fontSize:'16px',fontStyle:'bold',color:'#e2e8f0'}).setOrigin(.5));
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
    this.pieContainer?.setPosition(center,height*.52); this.piePointer?.setPosition(center,height*.20); this.pieHud?.setPosition(center,height*.88); this.pieKnife?.setPosition(center,height*.78); this.ufoWindow?.setPosition(center,height*.46).setSize(width*.78,Math.max(34,height*.075)); this.ufoTarget?.setPosition(center,height*.46);
    this.ufoOptions?.forEach((o,i)=>o.setPosition(width*(i+.5)/3,height*.72).setDisplaySize(Math.min(width*.2,150),Math.min(height*.19,100)));
    this.ufoOptionLabels?.forEach((o,i)=>o.setPosition(width*(i+.5)/3,height*.9));
    this.subtitle?.setPosition(center, height * 0.16).setFontSize(Math.max(12, Math.min(20, width * 0.017)));
    this.stageText?.setPosition(center, height * 0.26).setFontSize(Math.max(16, Math.min(25, width * 0.021)));
    this.sequenceText?.setPosition(center, height * 0.39).setFontSize(Math.max(19, Math.min(48, width * 0.04)));
    this.burgerStackText?.setPosition(center, height * 0.69).setFontSize(Math.max(38, Math.min(76, width * 0.065)));
    this.burgerFallingText?.setPosition(center, height * 0.22);
    this.burgerTopBunText?.setPosition(center, height * 0.62);
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
  animateBurgerDrop(ingredient, color) {
    this.tweens.killTweensOf(this.burgerFallingText);
    this.burgerFallingText.setText(ingredient || '🥩').setColor(({ RED: '#f87171', GREEN: '#4ade80', BLUE: '#60a5fa' })[color] || '#ffffff')
      .setPosition(this.scale.width / 2, this.scale.height * 0.22).setAlpha(1).setScale(0.7).setVisible(true);
    this.tweens.add({ targets: this.burgerFallingText, y: this.scale.height * 0.66, scale: 1.15, duration: 430, ease: 'Bounce.Out',
      onComplete: () => this.burgerFallingText.setVisible(false) });
  }
  animateBurgerClose() {
    this.tweens.killTweensOf(this.burgerTopBunText);
    this.time.delayedCall(430, () => {
      if (!this.burgerTopBunText?.active) return;
      this.burgerTopBunText.setPosition(this.scale.width / 2, this.scale.height * 0.48).setScale(0.65).setAlpha(1).setVisible(true);
      this.tweens.add({ targets: this.burgerTopBunText, y: this.scale.height * 0.64, scale: 1.12, duration: 480, ease: 'Bounce.Out',
        onComplete: () => this.time.delayedCall(450, () => this.burgerTopBunText.setVisible(false)) });
    });
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
        this.audioContext ||= successAudioContext || new AudioCtor();
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
    const isRace = state.stage === 3;
    const isFlappy = state.stage === 4;
    const isBurger = state.stage === 5;
    const isUfo = state.stage === 6;
    const isPie = state.stage === 7;
    this.title.setText(isPie ? 'RGB KNIFE HIT' : isUfo ? 'UFO SPOTTER' : isBurger ? 'BURGER BUILDER' : isFlappy ? 'ROCKET FLIGHT' : isRace ? 'HIGHWAY DODGE' : isDice ? 'DICE REACTION' : 'RGB SEQUENCE RUSH');
    this.stageText.setText('LEVEL ' + state.stage + ' · ' + (state.paused ? 'PAUSED' : state.status.toUpperCase()));
    this.subtitle.setText(isPie ? 'Hit each rotating colour zone 6 times · First to finish wins.' : isUfo ? 'Memorise the UFO through the 1 cm viewing slit · First to 10 points wins.' : isBurger ? 'Build the shown burger in order · First to 6 completed burgers wins.' : isFlappy ? 'Flap through 20 moving blockers · Each player flies their own rocket.' : isRace ? 'Three-lane highway race · Each player races on their own phone.' : isDice
      ? 'Three unique dice · First to 8 correct answers wins.'
      : 'Complete R → G → B. First to ' + state.targetCycles + ' cycles wins.');
    this.sequenceText.setText(isBurger ? (state.burgerSequence || []).map((a) => ({ R: '🥩', G: '🥬', B: '🍅' }[a])).join('  →  ') : isFlappy ? 'TAP ANY BUTTON TO BOOST' : isRace || isDice ? 'R = LEFT       G = CENTRE       B = RIGHT' : 'R     →     G     →     B');
    if (isBurger) {
      const recipeLength = (state.burgerSequence || []).length;
      this.sequenceText.setFontSize(Math.max(18, Math.min(48, this.scale.width * 0.04, this.scale.width / Math.max(14, recipeLength * 4.5))));
    }
    this.statusText.setText(state.status === 'waiting' ? 'Waiting for players'
      : state.status === 'finished' ? 'LEVEL COMPLETE · NEXT LEVEL READY'
      : state.paused ? 'GAME PAUSED'
      : isFlappy ? 'First to 20 blockers wins · Keep your rocket in the moving gaps!'
      : isRace ? 'First to 3,000 m wins · Avoid traffic and watch your speed!'
      : isDice ? 'Tap the colour matching the largest number'
      : isPie ? ('PIE SPIN ' + (state.pieSpeed || 0.9).toFixed(1) + '× · ' + (state.pieDirection < 0 ? 'ANTICLOCKWISE' : 'CLOCKWISE')) : isUfo ? (state.ufoPhase === 'flyby' ? 'WATCH THE UFO · ' + (state.ufoDurationMs / 1000).toFixed(1) + ' SECOND PASS' : 'WHICH UFO JUST FLEW PAST? · CYCLE ' + state.ufoCycle)
      : isBurger ? 'R = MEAT     ·     G = VEGETABLE     ·     B = TOMATO'
      : 'Race to ' + state.targetCycles + ' completed cycles!');
    this.diceGraphics.setVisible(isDice);
    this.burgerStackText.setVisible(isBurger);
    this.pieContainer.setVisible(isPie); this.piePointer.setVisible(isPie); this.pieHud.setVisible(isPie); this.pieKnife.setVisible(isPie); if(isPie){ this.pieGraphics.clear(); const radius=Math.min(this.scale.width*.19,this.scale.height*.29,190); const colors=[0xef4444,0x22c55e,0x3b82f6]; for(let sector=0;sector<3;sector++){ const start=-Math.PI/2-Math.PI/3+sector*Math.PI*2/3-state.pieAngle; const end=start+Math.PI*2/3; const points=[{x:0,y:0}]; for(let step=0;step<=24;step++){const a=start+(end-start)*step/24;points.push({x:Math.cos(a)*radius,y:Math.sin(a)*radius});} this.pieGraphics.fillStyle(colors[sector],1); this.pieGraphics.fillPoints(points,true); this.pieGraphics.lineStyle(5,0xffffff,.95); this.pieGraphics.strokePoints(points,true); } this.pieGraphics.fillStyle(0x111827,1); this.pieGraphics.fillCircle(0,0,radius*.16); this.pieHud.setText('HIT THE COLOUR AT THE POINTER'); if(state.pieLastHitId!==this.lastPieHit){this.lastPieHit=state.pieLastHitId;this.pieKnife.setPosition(this.scale.width/2,this.scale.height*.78).setScale(.65).setAlpha(1);this.tweens.add({targets:this.pieKnife,y:this.scale.height*.57,scale:1.05,alpha:0,duration:300,ease:'Cubic.Out'});} } this.ufoWindow.setVisible(isUfo); this.ufoTarget.setVisible(isUfo && state.ufoPhase==='flyby');
    this.ufoOptions.forEach((o,i)=>{o.setVisible(isUfo && state.ufoPhase==='choose');if(state.ufoOptions?.[i])o.setTexture('ufo-'+state.ufoOptions[i]);});
    this.ufoOptionLabels.forEach(o=>o.setVisible(isUfo && state.ufoPhase==='choose'));
    if(isUfo && state.ufoRoundId!==this.lastUfoRound){this.lastUfoRound=state.ufoRoundId;this.tweens.killTweensOf(this.ufoTarget);this.ufoTarget.setTexture('ufo-'+(state.ufoTargetId||1)).setPosition(this.scale.width+100,this.scale.height*.46).setVisible(true);this.tweens.add({targets:this.ufoTarget,x:-100,duration:state.ufoDurationMs||2000,ease:'Linear',onComplete:()=>this.ufoTarget.setVisible(false)});}
    if(!isUfo){this.ufoTarget.setVisible(false);this.ufoOptions.forEach(o=>o.setVisible(false));this.ufoOptionLabels.forEach(o=>o.setVisible(false));}
    if (!isBurger) { this.burgerFallingText.setVisible(false); this.burgerTopBunText.setVisible(false); }
    if (isBurger && state.burgerLastDrop && state.burgerLastDropId !== this.lastBurgerDrop) {
      this.lastBurgerDrop = state.burgerLastDropId;
      this.animateBurgerDrop(state.burgerLastDrop.ingredient, state.burgerLastDrop.color);
    }
    if (isBurger && state.burgerCompletedId !== this.lastBurgerComplete) {
      this.lastBurgerComplete = state.burgerCompletedId;
      this.animateBurgerClose();
    }
    if (isBurger && state.burgerRoundId !== this.lastBurgerRound) this.lastBurgerRound = state.burgerRoundId;
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
    if (!isDice && !isBurger && !isUfo && !isPie) {
      players.forEach((player) => {
        const index = state.players.findIndex((slot) => slot.color === player.color);
        const placeLine = player.place ? '\\n' + ordinal(player.place) + ' PLACE  ·  +' + player.pointsEarned + ' POINTS' : '';
        const progressLine = isFlappy
          ? (player.flappy?.blockersPassed || 0) + ' / 20 blockers\\n' + ['EASY','WIND','TIGHT GAPS','TURBULENCE'][Math.min(3, Math.floor((player.flappy?.blockersPassed || 0) / 6))]
          : isRace ? Math.floor(player.race?.distanceMeters || 0).toLocaleString() + ' / 3,000 m\\n' + (player.race?.speedMultiplier || 1).toFixed(1) + '× SPEED'
          : isBurger ? player.successCount + ' / ' + state.burgerTarget + ' burgers\\n' + (player.burgerProgressIndex || 0) + ' / ' + ((state.burgerSequence || []).length || 0) + ' ingredients'
          : player.cycles + ' / ' + state.targetCycles + ' cycles';
        const label = (player.player?.name || player.color) +
          '\\n' + progressLine +
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
      if (isDice || isBurger || isUfo || isPie || !state.players[index]?.joined) {
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
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) { successAudioContext ||= new AudioCtor(); successAudioContext.resume(); }
  } catch { /* Sound remains optional if the browser blocks audio. */ }
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
