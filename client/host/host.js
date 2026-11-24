import QRCode from 'qrcode';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import './host.css';

const $ = (selector) => document.querySelector(selector);
const UFO_FLIGHT_PATHS = [
  { x:115, y:160, xEnd:115, yEnd:310, flipY:true },
  { x:115, y:170, xEnd:260, yEnd:170 },
  { x:580, y:240, xEnd:530, yEnd:205 },
  { x:580, y:240, xEnd:540, yEnd:330, flipY:true },
  { x:210, y:450, xEnd:270, yEnd:405 }
];
let token = sessionStorage.getItem('rgb-token');
let socket;
let game;
let currentState;
let renderRequestId = 0;
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
            : state.stage === 10 ? player.successCount + ' / ' + state.matrixTarget
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
function renderFinalResults(state) {
  const results = state.finalResults || [];
  const page = $('#results-page');
  const podium = $('#podium');
  const review = $('#review-results');
  const isResults = state.status === 'results' && Array.isArray(results);
  page.hidden = !isResults;
  review.hidden = !(state.stage === 10 && state.status === 'finished');
  if (!isResults) return;
  const medals = { 1: '🏆', 2: '🥈', 3: '🥉' };
  const labels = { 1: 'GOLD CHAMPION', 2: 'SILVER', 3: 'BRONZE' };
  podium.replaceChildren();
  for (const player of results) {
    const card = document.createElement('article');
    card.className = 'podium-card rank-' + player.rank;
    const trophy = document.createElement('div');
    trophy.className = 'trophy';
    trophy.textContent = medals[player.rank] || '🏅';
    const rank = document.createElement('p');
    rank.className = 'rank-label';
    rank.textContent = labels[player.rank] || (player.rank + ' PLACE');
    const name = document.createElement('h2');
    name.textContent = player.name;
    const color = document.createElement('p');
    color.className = 'rank-color';
    color.textContent = player.color + ' PLAYER';
    const points = document.createElement('strong');
    points.className = 'rank-points';
    points.textContent = player.totalPoints + ' POINTS';
    card.append(trophy, rank, name, color, points);
    podium.append(card);
  }
}

function ensureRaceDisplay() {
  const display = $('#race-display');
  if (!display || display.dataset.ready) return;
  display.dataset.ready = 'true';
  for (const color of ['RED', 'GREEN', 'BLUE']) {
    const column = document.createElement('section');
    column.className = 'race-column ' + color.toLowerCase();
    column.dataset.color = color;
    const header = document.createElement('header');
    header.className = 'race-column-header';
    const name = document.createElement('strong');
    name.className = 'race-player-name';
    name.textContent = color;
    const distance = document.createElement('strong');
    distance.className = 'race-distance';
    distance.textContent = '0 / 3,000 m';
    header.append(name, distance);
    const status = document.createElement('p');
    status.className = 'race-player-status';
    status.textContent = 'SCAN QR TO JOIN';
    const qr = document.createElement('img');
    qr.className = 'race-join-qr';
    qr.alt = 'Join ' + color;
    const road = document.createElement('div');
    road.className = 'host-race-road';
    road.innerHTML = '<div class="host-road-lane lane-a"></div><div class="host-road-lane lane-b"></div><div class="host-race-obstacles"></div><div class="host-race-car">🚗</div><div class="host-race-crash">CRASH!</div>';
    const scene = document.createElement('div');
    scene.className = 'host-individual-scene';
    scene.hidden = true;
    const footer = document.createElement('footer');
    footer.className = 'race-player-footer';
    footer.textContent = 'R  LEFT  ·  G  CENTRE  ·  B  RIGHT';
    column.append(header, status, qr, road, scene, footer);
    display.append(column);
  }
}

function footerText(column, stage) {
  const footer = column.querySelector('.race-player-footer');
  if (!footer) return;
  const labels = {
    3: 'R LEFT  ·  G CENTRE  ·  B RIGHT',
    4: 'TAP ANY COLOUR TO BOOST',
    5: 'R MEAT  ·  G LETTUCE  ·  B TOMATO',
    7: 'R RED  ·  G GREEN  ·  B BLUE',
    8: 'MATCH THE NEXT PIPE COLOUR',
    9: 'R MOVE LEFT  ·  B MOVE RIGHT'
  };
  footer.textContent = labels[stage] || '';
}

function renderRaceDisplay(state) {
  const display = $('#race-display');
  if (!display) return;
  ensureRaceDisplay();
  for (const player of state.players) {
    const column = display.querySelector('[data-color="' + player.color + '"]');
    if (!column) continue;
    const name = column.querySelector('.race-player-name');
    const distance = column.querySelector('.race-distance');
    const status = column.querySelector('.race-player-status');
    const qr = column.querySelector('.race-join-qr');
    const road = column.querySelector('.host-race-road');
    const car = column.querySelector('.host-race-car');
    const obstacles = column.querySelector('.host-race-obstacles');
    const crash = column.querySelector('.host-race-crash');
    const scene = column.querySelector('.host-individual-scene');
    name.textContent = player.player?.name || player.color;
    status.textContent = player.joined
      ? (player.connected ? 'CONNECTED' : 'DISCONNECTED') + (player.completed ? ' · ' + ordinal(player.place) + ' PLACE' : '')
      : 'SCAN QR TO JOIN';
    qr.hidden = player.joined;
    const sourceQr = $('#qr-' + player.color);
    if (sourceQr?.src) qr.src = sourceQr.src;
    const individual = [4,5,7,8,9].includes(state.stage);
    const highway = state.stage === 3;
    road.hidden = !player.joined || !highway;
    scene.hidden = !player.joined || !individual;
    const race = player.race || {};
    const stageProgress = {
      4: (player.flappy?.blockersPassed || 0) + ' / 20 BLOCKERS',
      5: (player.successCount || 0) + ' / ' + state.burgerTarget + ' BURGERS',
      7: 'R ' + (player.pieHits?.R || 0) + '/4 · G ' + (player.pieHits?.G || 0) + '/4 · B ' + (player.pieHits?.B || 0) + '/4',
      8: (player.tri?.score || 0) + ' / ' + state.triTarget + ' PIPES',
      9: (player.burgerStack?.successCount || 0) + ' / ' + state.burgerStackTarget + ' BURGERS'
    };
    distance.textContent = !player.joined ? 'WAITING' : individual ? (stageProgress[state.stage] || '') : highway ? Math.floor(race.distanceMeters || 0).toLocaleString() + ' / 3,000 m' : '';
    footerText(column, state.stage);
    if (!player.joined) continue;
    if (individual) {
      const icons = {4:'🚀',5:'🍔',7:'🥧',8:'🏝️',9:'🍔'};
      const details = {
        4: (player.flappy?.blockersPassed || 0) + ' blockers cleared',
        5: (player.burgerProgressIndex || 0) + ' ingredients stacked',
        7: (player.pieTotalHits || 0) + ' successful knife hits',
        8: 'Pipe score ' + (player.tri?.score || 0),
        9: 'Challenge ' + (player.burgerStack?.challengeNumber || 1) + ' · ' + (player.burgerStack?.stacked?.length || 0) + ' layers'
      };
            car.hidden = true;
      obstacles.hidden = true;
      crash.hidden = true;
      const board = ensureIndividualBoard(scene, state.stage);
      renderIndividualBoard(board, state, player);
      column.classList.toggle('completed', Boolean(player.completed));
      column.classList.toggle('disconnected', !player.connected);
      continue;
    }
    car.hidden = false;
    obstacles.hidden = false;
    car.style.left = ([20, 50, 80][race.lane ?? 1]) + '%';
    car.textContent = player.player?.avatar ? '' : '🚗';
    car.classList.toggle('has-avatar', Boolean(player.player?.avatar));
    if (player.player?.avatar) {
      let avatar = car.querySelector('img');
      if (!avatar) { avatar = document.createElement('img'); avatar.alt = 'Player avatar'; car.append(avatar); }
      avatar.src = player.player.avatar;
    } else car.querySelector('img')?.remove();
    const activeIds = new Set();
    for (const item of race.obstacles || []) {
      activeIds.add(String(item.id));
      let vehicle = obstacles.querySelector('[data-obstacle-id="' + item.id + '"]');
      if (!vehicle) {
        vehicle = document.createElement('span');
        vehicle.className = 'host-race-obstacle';
        vehicle.dataset.obstacleId = String(item.id);
        obstacles.append(vehicle);
      }
      vehicle.textContent = item.type || '🚙';
      vehicle.style.left = ([20, 50, 80][item.lane] ?? 50) + '%';
      vehicle.style.top = (Math.max(0, Math.min(1, item.progress)) * 100) + '%';
    }
    for (const node of obstacles.querySelectorAll('[data-obstacle-id]')) {
      if (!activeIds.has(node.dataset.obstacleId)) node.remove();
    }
    crash.hidden = !(race.penaltyMs > 0);
    column.classList.toggle('completed', Boolean(player.completed));
    column.classList.toggle('disconnected', !player.connected);
  }
}

function ensureIndividualBoard(scene, stage) {
  const type = ({4:'flappy',5:'burger',7:'pie',8:'tri',9:'stack'})[stage] || 'other';
  let board = scene.querySelector('.individual-board');
  if (!board || board.dataset.type !== type) {
    board = document.createElement('div');
    board.className = 'individual-board ' + type;
    board.dataset.type = type;
    if (type === 'flappy') {
      board.innerHTML = '<div class="flappy-sky"><div class="flappy-cloud cloud-a"></div><div class="flappy-cloud cloud-b"></div><div class="flappy-stars">✦　 ·　 ✧　 ·　 ✦</div><div class="flappy-obstacles"></div><div class="flappy-rocket">🚀</div><div class="flappy-ground"></div></div><div class="board-caption">ROCKET FLIGHT · FLY THROUGH THE GAPS</div>';
    } else if (type === 'burger') {
      board.innerHTML = '<div class="burger-stage"><div class="burger-sample"><small>MODEL BURGER</small><div class="burger-model"><div class="burger-bun burger-base"></div><div class="burger-model-layers burger-recipe"></div><div class="burger-bun burger-top"></div></div></div><div class="burger-plate"><div class="burger-stack"><div class="burger-bun burger-base"></div></div><div class="burger-feedback"></div></div></div><div class="burger-progress"></div>';
    } else if (type === 'ufo') {
      board.innerHTML = '<div class="ufo-board-title">UFO SPOTTER</div><div class="ufo-target-caption">WATCH THE TARGET</div><div class="ufo-target"></div><div class="ufo-options"></div><div class="board-caption"></div>';
    } else if (type === 'pie') {
      board.innerHTML = '<div class="pie-board-title">RGB KNIFE HIT</div><div class="pie-wheel-host"><div class="pie-sector red"></div><div class="pie-sector green"></div><div class="pie-sector blue"></div><div class="pie-wheel-core"></div><div class="pie-knives-host"></div></div><div class="pie-flight-host"><i class="pie-ready-knife" aria-hidden="true"></i></div><div class="pie-miss-host"></div><div class="board-caption"></div>';
    } else if (type === 'tri') {
      board.innerHTML = '<div class="tri-board-title">SHARK ISLAND · COLOUR STEPS</div><div class="tri-world-host"><div class="tri-platforms-host"></div><div class="tri-runner-host"><span class="tri-runner-fallback">🧑‍🚀</span></div><div class="tri-confetti-host"></div></div><div class="board-caption"></div>';
    } else if (type === 'stack') {
      board.innerHTML = '<div class="stack-board-title">BURGER STACK</div><div class="stack-world-host"><div class="stack-lanes-host"><i></i><i></i><i></i></div><div class="stack-drops-host"></div><div class="stack-catcher-host"><span class="stack-bread-base"></span></div><div class="stack-built-host"></div></div><div class="board-caption"></div>';
    } else board.innerHTML = '<div class="individual-fallback"></div>';
    scene.replaceChildren(board);
  }
  return board;
}

function playBurgerErrorBuzz() {
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    const context = successAudioContext || new AudioCtor();
    successAudioContext = context;
    if (context.state === 'suspended') context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(190, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(85, context.currentTime + 0.22);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.29);
  } catch { /* Audio may be blocked until a user gesture. */ }
}

function renderIndividualBoard(board, state, player) {
  if (state.stage === 4) {
    const flight = player.flappy || { y: 0.5, obstacles: [], blockersPassed: 0, penaltyMs: 0 };
    const rocket = board.querySelector('.flappy-rocket');
    rocket.style.top = (Math.max(0.04, Math.min(0.96, flight.y || 0.5)) * 100) + '%';
    rocket.classList.toggle('crashed', (flight.penaltyMs || 0) > 0);
    const obstacles = board.querySelector('.flappy-obstacles');
    const gap = Math.max(0.22, 0.38 - Math.floor((flight.blockersPassed || 0) / 6) * 0.035);
    const visibleObstacles = (flight.obstacles || []).length ? flight.obstacles : (state.status === 'waiting' ? [{x:0.68,gapY:0.42},{x:0.9,gapY:0.62}] : []);
    obstacles.innerHTML = visibleObstacles.map(item => {
      const topHeight = Math.max(8, (item.gapY - gap / 2) * 100);
      const bottomTop = (item.gapY + gap / 2) * 100;
      return '<div class="flappy-pipe top" style="left:' + (item.x * 100) + '%;height:' + topHeight + '%"></div><div class="flappy-pipe bottom" style="left:' + (item.x * 100) + '%;top:' + bottomTop + '%;height:' + (100-bottomTop) + '%"></div>';
    }).join('');
    board.querySelector('.board-caption').textContent = (flight.blockersPassed || 0) + ' / 20 BLOCKERS · ' + ((flight.penaltyMs || 0) > 0 ? 'CRASH RECOVERY' : 'TAP ANY COLOUR TO BOOST');
  } else if (state.stage === 5) {
    const sequence = state.burgerSequence || [];
    const completedSequence = state.burgerCompletedSequence || [];
    const progress = Math.max(0, Math.min(sequence.length, player.burgerProgressIndex || 0));
    const ingredientClass = {R:'tomato',G:'vegetable',B:'meat'};
    const targetOrder = [...sequence].reverse();
    const modelOrder = targetOrder.length ? targetOrder : ['B','G','R'];
    const model = board.querySelector('.burger-model');
    model.querySelector('.burger-recipe').innerHTML = modelOrder.map(key => '<span class="burger-block block-' + ingredientClass[key] + '"></span>').join('');
    const stack = board.querySelector('.burger-stack');
    const feedback = board.querySelector('.burger-feedback');
    const completedId = Number(state.burgerCompletedId || 0);
    if (player.color === state.burgerWinnerColor && completedId > Number(board.dataset.completedId || 0)) {
      board.dataset.completedId = String(completedId);
      feedback.innerHTML = '<span class="burger-success">O <b>+1</b></span>';
      feedback.classList.remove('show'); void feedback.offsetWidth; feedback.classList.add('show');
    }
    // The server resets burgerProgressIndex as soon as a player completes a
    // burger. Render that reset immediately instead of holding the completed
    // stack on screen until the next input arrives.
    const buildOrder = targetOrder.slice(0, progress);
    stack.innerHTML = '<div class="burger-bun burger-base"></div>' +
      buildOrder.map(key => '<span class="burger-block block-' + ingredientClass[key] + '"></span>').join('');
    const failureId = Number(player.burgerFailureId || 0);
    if (failureId > Number(board.dataset.failureId || 0)) {
      board.dataset.failureId = String(failureId);
      feedback.innerHTML = '<span class="burger-failure">✕</span>';
      feedback.classList.remove('show'); void feedback.offsetWidth; feedback.classList.add('show');
      playBurgerErrorBuzz();
    }
    board.querySelector('.burger-progress').textContent = 'BURGER ' + (player.successCount || 0) + ' / ' + state.burgerTarget + '  ·  INGREDIENT ' + progress + ' / ' + sequence.length;
  } else if (state.stage === 7) {
    const wheel = board.querySelector('.pie-wheel-host');
    wheel.style.transform = 'rotate(' + (-Number(state.pieAngle || 0) * 180 / Math.PI) + 'deg)';
    const readyKnife = board.querySelector('.pie-ready-knife');
    const throwPhase = player.pieThrow?.phase || '';
    readyKnife.classList.toggle('throwing', throwPhase === 'flying');
    readyKnife.classList.toggle('falling', throwPhase === 'falling');
    const knivesHost = board.querySelector('.pie-knives-host');
    const activeKnifeIds = new Set();
    for (const item of player.pieKnives || []) {
      activeKnifeIds.add(String(item.id));
      let knife = knivesHost.querySelector('[data-knife-id="' + item.id + '"]');
      if (!knife) {
        knife = document.createElement('i');
        knife.className = 'pie-stuck-knife';
        knife.dataset.knifeId = String(item.id);
        knivesHost.append(knife);
      }
      const knifeColors = {R:'#ef4444',G:'#22c55e',B:'#3b82f6'};
      knife.style.setProperty('--knife-angle', (90 + Number(item.angle || 0)*180/Math.PI) + 'deg');
      knife.style.setProperty('--knife-color', knifeColors[item.color] || '#f8fafc');
    }
    for (const node of knivesHost.querySelectorAll('[data-knife-id]')) {
      if (!activeKnifeIds.has(node.dataset.knifeId)) node.remove();
    }
    const flightHost = board.querySelector('.pie-flight-host');
    const hit = state.pieLastHit;
    if (hit && hit.playerColor === player.color && Number(board.dataset.lastHitId || 0) !== Number(hit.id)) {
      board.dataset.lastHitId = String(hit.id);
      const flyingKnife = document.createElement('i');
      flyingKnife.className = 'pie-flying-knife';
      flyingKnife.style.setProperty('--knife-color', ({R:'#ef4444',G:'#22c55e',B:'#3b82f6'})[hit.color] || '#f8fafc');
      flightHost.append(flyingKnife);
      flyingKnife.addEventListener('animationend', () => flyingKnife.remove(), {once:true});
    }
    const miss = state.pieLastMiss;
    const missHost = board.querySelector('.pie-miss-host');
    if (miss && miss.playerColor === player.color && Number(board.dataset.lastMissId || 0) !== miss.id) {
      board.dataset.lastMissId = String(miss.id);
      const fallenKnife = document.createElement('i');
      fallenKnife.className = 'pie-fallen-knife';
      fallenKnife.textContent = '🔪';
      fallenKnife.style.setProperty('--miss-color', ({R:'#ef4444',G:'#22c55e',B:'#3b82f6'})[miss.color] || '#fff');
      missHost.append(fallenKnife);
      fallenKnife.addEventListener('animationend', () => fallenKnife.remove(), {once:true});
      board.classList.add('pie-missed');
      window.setTimeout(() => board.classList.remove('pie-missed'), 260);
    }
    board.querySelector('.board-caption').textContent = 'THROW FROM THE BOTTOM EDGE · MATCH THE COLOUR · AVOID ATTACHED KNIVES';
  } else if (state.stage === 8) {
    const tri = player.tri || {pipes:[],score:0};
    const platformsHost = board.querySelector('.tri-platforms-host');
    const activePlatformIds = new Set();
    const colorClass = {R:'red',G:'green',B:'blue'};
    for (const platform of tri.pipes || []) {
      activePlatformIds.add(String(platform.id));
      let node = platformsHost.querySelector('[data-platform-id="' + platform.id + '"]');
      if (!node) {
        node = document.createElement('span');
        node.className = 'tri-platform';
        node.dataset.platformId = String(platform.id);
        platformsHost.append(node);
      }
      node.className = 'tri-platform ' + (colorClass[platform.color] || 'red');
      node.style.left = (platform.x * 100) + '%';
    }
    for (const node of platformsHost.querySelectorAll('[data-platform-id]')) {
      if (!activePlatformIds.has(node.dataset.platformId)) node.remove();
    }
    const runner = board.querySelector('.tri-runner-host');
    const avatar = player.player?.avatar;
    if (avatar) {
      let image = runner.querySelector('img');
      if (!image) { image = document.createElement('img'); runner.replaceChildren(image); }
      if (image.src !== avatar) image.src = avatar;
    } else {
      runner.innerHTML = '<span class="tri-runner-fallback">' + (player.player?.character === 'racer' ? '🏃' : '🧑‍🚀') + '</span>';
    }
    const score = tri.score || 0;
    // Start on the shore, then stand on the fixed stepping position after the first correct move.
    runner.style.left = '16.7%';
    runner.style.bottom = score > 0 ? 'calc(20% + clamp(9px,1.7vh,16px))' : '4%';
    if (runner.dataset.score !== String(score)) {
      runner.dataset.score = String(score);
      runner.classList.remove('stepping');
      void runner.offsetWidth;
      runner.classList.add('stepping');
    }
    runner.classList.toggle('wrong', player.roundFeedback === 'wrong');
    const world = board.querySelector('.tri-world-host');
    const confettiHost = board.querySelector('.tri-confetti-host');
    if (player.completed && world.dataset.completed !== 'true') {
      world.dataset.completed = 'true';
      confettiHost.innerHTML = Array.from({length:36},(_,i)=>'<i style="--x:'+((i*37)%100)+'%;--delay:'+((i%9)*55)+'ms;--turn:'+((i*47)%360)+'deg"></i>').join('');
      world.classList.add('tri-complete');
    } else if (!player.completed && world.dataset.completed === 'true') {
      world.dataset.completed = 'false';
      confettiHost.innerHTML = '';
      world.classList.remove('tri-complete');
    }
    board.querySelector('.board-caption').textContent = (tri.score || 0) + ' / ' + state.triTarget + ' PLATFORMS · MATCH THE NEXT PLATFORM';
  } else if (state.stage === 9) {
    const stack = player.burgerStack || {lane:1,drops:[],stacked:[],successCount:0,penaltyMs:0};
    const dropsHost = board.querySelector('.stack-drops-host');
    const activeDropIds = new Set();
    const food = {R:'tomato',G:'vegetable',B:'meat',T:'top'};
    for (const drop of stack.drops || []) {
      activeDropIds.add(String(drop.id));
      let node = dropsHost.querySelector('[data-drop-id="' + drop.id + '"]');
      if (!node) {
        node = document.createElement('span');
        node.className = 'stack-drop';
        node.dataset.dropId = String(drop.id);
        dropsHost.append(node);
      }
      node.textContent = '';
      node.className = 'stack-drop stack-block stack-block-' + (food[drop.ingredient] || 'tomato');
      node.style.left = ([16.5,50,83.5][drop.lane] ?? 50) + '%';
      node.style.top = (Math.max(0,Math.min(1,drop.y))*100) + '%';
    }
    for (const node of dropsHost.querySelectorAll('[data-drop-id]')) {
      if (!activeDropIds.has(node.dataset.dropId)) node.remove();
    }
    board.querySelector('.stack-catcher-host').style.left = ([16.5,50,83.5][stack.lane] ?? 50) + '%';
    const visibleStack = stack.completedStack?.length ? stack.completedStack : (stack.stacked || []);
    const builtHost = board.querySelector('.stack-built-host');
    builtHost.style.left = ([16.5,50,83.5][stack.lane] ?? 50) + '%';
    const activeLayerIndexes = new Set();
    visibleStack.forEach((item,index) => {
      activeLayerIndexes.add(String(index));
      let layer = builtHost.querySelector('[data-layer-index="' + index + '"]');
      if (!layer) {
        layer = document.createElement('span');
        layer.dataset.layerIndex = String(index);
        builtHost.append(layer);
      }
      layer.textContent = '';
      layer.className = 'stack-layer stack-block stack-block-' + (food[item.ingredient] || 'tomato');
    });
    for (const node of builtHost.querySelectorAll('[data-layer-index]')) {
      if (!activeLayerIndexes.has(node.dataset.layerIndex)) node.remove();
    }
    board.querySelector('.board-caption').textContent = 'CHALLENGE ' + (stack.challengeNumber || 1) + ' · ' + (stack.successCount || 0) + ' / ' + state.burgerStackTarget + ' COMPLETE' + ((stack.penaltyMs || 0)>0 ? ' · MISALIGNED!' : '');
  }
}

function applyState(state) {
  currentState = state;
  const requestId = ++renderRequestId;
  const levelSelect = $('#level-select');
  const startLevelButton = $('#start-level');
  if (levelSelect && document.activeElement !== levelSelect) levelSelect.value = String(state.stage);
  if (startLevelButton && !startLevelButton.dataset.pending) startLevelButton.disabled = false;
  const isIndividualDisplay = [3,4,5,7,8,9].includes(state.stage);
  const room = $('#room');
  room.classList.toggle('individual-mode', isIndividualDisplay);
  room.classList.toggle('shared-mode', !isIndividualDisplay);
  $('#race-display').hidden = !isIndividualDisplay;
  $('#game-root').hidden = isIndividualDisplay;
  $('#player-strip').hidden = isIndividualDisplay;
  $('#host-actions').hidden = false;
  if (isIndividualDisplay) renderRaceDisplay(state);
  renderSlots(state);
  renderFinalResults(state);
  if (game?.scene?.keys?.RGBScene) {
    const scene = game.scene.keys.RGBScene;
    scene.scene.setActive(true);
    scene.scene.setVisible(true);
    scene.updateState(state);
    requestAnimationFrame(() => {
      // Socket updates can arrive several times during a level switch. Ignore
      // stale frames so an older stage cannot overwrite the latest render.
      if (!game || requestId !== renderRequestId) return;
      const latestState = currentState || state;
      const latestIsIndividual = [3,4,5,7,8,9].includes(latestState.stage);
      const root = $('#game-root');
      root.hidden = latestIsIndividual;
      root.style.display = latestIsIndividual ? 'none' : 'block';
      if (latestIsIndividual) {
        game.canvas.style.display = 'none';
        return;
      }
      const width = Math.max(320, root.clientWidth || window.innerWidth);
      const height = Math.max(220, root.clientHeight || Math.round(window.innerHeight * 0.7));
      game.canvas.style.display = 'block';
      game.canvas.style.visibility = 'visible';
      game.scale.resize(width, height);
      scene.scene.setActive(true);
      scene.scene.setVisible(true);
      scene.layout(width, height);
      scene.updateState(latestState);
    });
  }
}

class RGBScene extends Phaser.Scene {
  constructor() { super('RGBScene'); this.celebrated = new Set(); this.successSeen = new Map(); this.lastDiceRound = null; this.lastBurgerRound = null; this.lastBurgerDrop = 0; this.lastBurgerComplete = 0; this.lastPieHit = 0; this.audioContext = null; }
  preload() { for(let id=1;id<=9;id++) this.load.svg('ufo-'+id,new URL('./ufo/ufo-'+String(id).padStart(2,'0')+'.svg',import.meta.url).href,{width:180,height:100}); }
  create() {
    this.cameras.main.setBackgroundColor('#111827');
    this.ufoCity = this.add.graphics().setDepth(-2).setVisible(false);
    this.ufoLegendGraphics = this.add.graphics().setDepth(-1).setVisible(false);
    this.title = this.add.text(0, 0, 'RGB SEQUENCE RUSH', { fontSize: '34px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5, 0);
    this.subtitle = this.add.text(0, 0, '', { fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.stageText = this.add.text(0, 0, 'LEVEL 1 · WAITING', { fontSize: '22px', color: '#fbbf24', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.sequenceText = this.add.text(0, 0, 'R     →     G     →     B', { fontSize: '48px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.statusText = this.add.text(0, 0, 'Waiting for players…', { fontSize: '22px', color: '#cbd5e1' }).setOrigin(0.5, 0);
    this.burgerStackText = this.add.text(0, 0, '🥬   🥩   🍅', { fontSize: '64px', color: '#ffffff' }).setOrigin(0.5);
    this.burgerFallingText = this.add.text(0, 0, '', { fontSize: '58px' }).setOrigin(0.5).setVisible(false);
    this.burgerTopBunText = this.add.text(0, 0, '🍞', { fontSize: '64px' }).setOrigin(0.5).setVisible(false);
    this.pieContainer=this.add.container(0,0).setVisible(false); this.pieGraphics=this.add.graphics(); this.pieContainer.add(this.pieGraphics); this.pieKnife=this.add.text(0,0,'🔪',{fontSize:'48px'}).setOrigin(.5).setVisible(false); this.pieHud=this.add.text(0,0,'R 0/4   G 0/4   B 0/4',{fontSize:'22px',fontStyle:'bold',color:'#fff'}).setOrigin(.5).setVisible(false);
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
    this.matrixCells = Array.from({ length: 9 }, () => this.add.text(0, 0, '', {
      fontSize: '28px', fontStyle: 'bold', color: '#f8fafc', align: 'center',
      backgroundColor: '#243247', padding: { x: 8, y: 8 }, lineSpacing: 2
    }).setOrigin(0.5).setVisible(false));
    this.matrixOptions = ['R · LEFT', 'G · MIDDLE', 'B · RIGHT'].map((label, index) =>
      this.add.text(0, 0, label, { fontSize: '17px', fontStyle: 'bold', color: ['#f87171','#4ade80','#60a5fa'][index], align: 'center' }).setOrigin(0.5).setVisible(false)
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
    if (this.ufoCity) {
      const city = this.ufoCity;
      city.clear();
      city.fillStyle(0x0f172a, 1);
      city.fillRect(0, height * 0.32, width, height * 0.68);
      const buildings = 9;
      for (let i = 0; i < buildings; i += 1) {
        const x = i * width / buildings;
        const buildingHeight = height * (0.22 + ((i * 7) % 4) * 0.055);
        city.fillStyle(i % 2 ? 0x1e293b : 0x273449, 1);
        city.fillRect(x + 2, height * 0.72 - buildingHeight, width / buildings - 4, buildingHeight);
        city.fillStyle(0xfbbf24, 0.48);
        for (let row = 0; row < 4; row += 1) {
          for (let col = 0; col < 3; col += 1) {
            const wx = x + 8 + col * Math.max(8, width / buildings * 0.27);
            const wy = height * 0.72 - buildingHeight + 12 + row * 17;
            if (wy < height * 0.7 - 4) city.fillRect(wx, wy, 5, 7);
          }
        }
      }
      city.fillStyle(0x334155, 1);
      city.fillRect(0, height * 0.72, width, height * 0.28);
    }
    this.title?.setPosition(center, height * 0.045).setFontSize(Math.max(20, Math.min(36, width * 0.03)));
    this.pieContainer?.setPosition(center,height*.52); this.pieHud?.setPosition(center,height*.88); this.pieKnife?.setPosition(center,height*.78);
    this.ufoWindow?.setPosition(center,height*.46).setSize(width*.78,Math.max(22,height*.055)).setVisible(false);
    this.ufoLegendGraphics?.clear();
    const legendColors=[0xff1100,0x00da09,0x2196f3];
    const legendPad=Math.max(5,width*.012), legendTop=height*.77, legendHeight=height*.23;
    const legendWidth=(width-legendPad*2)/3;
    legendColors.forEach((color,i)=>{this.ufoLegendGraphics?.fillStyle(color,1);this.ufoLegendGraphics?.fillRect(legendPad+i*legendWidth,legendTop,legendWidth-legendPad,legendHeight);});
    this.ufoOptions?.forEach((o,i)=>o.setPosition(width*(i+.5)/3,height*.865).setDisplaySize(Math.min(width*.16,112),Math.min(height*.17,104)));
    this.ufoOptionLabels?.forEach((o,i)=>o.setPosition(width*(i+.5)/3,height*.965).setFontSize(Math.max(12,Math.min(20,width*.018))));
    this.ufoTarget?.setDisplaySize(Math.min(width*.16,112),Math.min(height*.17,104));
    const matrixCellSize = Math.min(width * 0.19, height * 0.145, 138);
    const matrixGap = Math.min(width * 0.025, 22);
    const matrixTop = height * 0.38;
    this.matrixCells?.forEach((cell, index) => {
      const row = Math.floor(index / 3), col = index % 3;
      cell.setPosition(center + (col - 1) * (matrixCellSize + matrixGap), matrixTop + row * (matrixCellSize * 0.78))
        .setFontSize(Math.max(17, Math.min(32, matrixCellSize * 0.25)));
    });
    this.matrixOptions?.forEach((option, index) => option.setPosition(width * (index + 0.5) / 3, height * 0.83)
      .setFontSize(Math.max(12, Math.min(19, width * 0.017))));
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
      if (this.diceNumbers?.[index]) this.children.bringToTop(this.diceNumbers[index]);
      if (this.diceLabels?.[index]) this.children.bringToTop(this.diceLabels[index]);
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
    // Treat each session/level pair as a fresh scene. Phaser keeps scene
    // instances alive between levels, so clear transient animations and cached
    // round IDs before rendering a different level or a newly created room.
    const renderKey = String(state.id || '') + ':' + state.stage;
    if (this.renderKey !== renderKey) {
      this.renderKey = renderKey;
      this.tweens.killAll();
      this.time.removeAllEvents();
      this.celebrated.clear();
      this.successSeen.clear();
      this.lastDiceRound = null;
      this.lastBurgerRound = null;
      this.lastBurgerDrop = 0;
      this.lastBurgerComplete = 0;
      this.lastPieHit = 0;
      this.lastUfoRound = null;
      this.playerTexts.forEach((item) => item?.destroy());
      this.playerTexts = [];
      this.ufoTarget?.setVisible(false).setAlpha(1);
      this.ufoOptions?.forEach((item) => item.setVisible(false).setAlpha(1));
      this.ufoOptionLabels?.forEach((item) => item.setVisible(false));
      this.matrixCells?.forEach((item) => item.setVisible(false));
      this.matrixOptions?.forEach((item) => item.setVisible(false));
      this.diceNumbers?.forEach((item) => item.setVisible(false).setScale(1).setAngle(0));
      this.diceLabels?.forEach((item) => item.setVisible(false));
      this.diceGraphics?.setVisible(false).clear();
      this.ufoCity?.setVisible(false);
      this.ufoLegendGraphics?.setVisible(false).clear();
      this.burgerStackText?.setVisible(false);
      this.burgerFallingText?.setVisible(false).setAlpha(1).setScale(1);
      this.burgerTopBunText?.setVisible(false).setAlpha(1).setScale(1);
      this.pieContainer?.setVisible(false);
      this.piePointer?.setVisible(false);
      this.pieHud?.setVisible(false);
      this.pieKnife?.setVisible(false).setAlpha(1).setScale(1);
    }
    const isDice = state.stage === 2;
    const isRace = state.stage === 3;
    const isFlappy = state.stage === 4;
    const isBurger = state.stage === 5;
    const isUfo = state.stage === 6;
    const isPie = state.stage === 7;
    const isMatrix = state.stage === 10;
    this.title.setText(isMatrix ? 'MATRIX MASTER' : isPie ? 'RGB KNIFE HIT' : isUfo ? 'UFO SPOTTER' : isBurger ? 'BURGER BUILDER' : isFlappy ? 'ROCKET FLIGHT' : isRace ? 'HIGHWAY DODGE' : isDice ? 'DICE REACTION' : 'RGB SEQUENCE RUSH');
    this.stageText.setText('LEVEL ' + state.stage + ' · ' + (state.paused ? 'PAUSED' : state.status.toUpperCase()));
    this.subtitle.setText(isMatrix ? 'Complete the missing square · First to 6 correct answers wins.' : isPie ? 'Throw from the bottom edge · Match the colour and avoid attached knives.' : isUfo ? 'Watch the UFO fly past, then identify it from the three coloured choices · First to 10 correct answers wins.' : isBurger ? 'Build the target burger in the original ingredient order · First to 5 completed burgers wins.' : isFlappy ? 'Flap through 20 moving blockers · Each player flies their own rocket.' : isRace ? 'Three-lane highway race · Each player races on their own phone.' : isDice
      ? 'Three unique dice · First to 8 correct answers wins.'
      : 'Complete R → G → B. First to ' + state.targetCycles + ' cycles wins.');
    this.sequenceText.setVisible(!isMatrix && !isUfo);
    this.sequenceText.setText(isBurger ? 'STACK THE INGREDIENTS IN ORDER' : isFlappy ? 'TAP ANY BUTTON TO BOOST' : isRace || isDice ? 'R = LEFT       G = CENTRE       B = RIGHT' : 'R     →     G     →     B');
    if (isBurger) {
      const recipeLength = (state.burgerSequence || []).length;
      this.sequenceText.setFontSize(Math.max(18, Math.min(48, this.scale.width * 0.04, this.scale.width / Math.max(14, recipeLength * 4.5))));
    }
    this.statusText.setText(isMatrix ? (state.matrixPuzzle?.category || 'Mixed logic puzzles') + ' · ' + (state.matrixPuzzle?.difficulty ? ['','EASY','MEDIUM','HARD','EXPERT'][state.matrixPuzzle.difficulty] : 'READY') : state.status === 'waiting' ? 'Waiting for players'
      : state.status === 'finished' ? 'LEVEL COMPLETE · NEXT LEVEL READY'
      : state.paused ? 'GAME PAUSED'
      : isFlappy ? 'First to 20 blockers wins · Keep your rocket in the moving gaps!'
      : isRace ? 'First to 3,000 m wins · Avoid traffic and watch your speed!'
      : isDice ? 'Tap the colour matching the largest number'
      : isPie ? ('KNIFE WHEEL ' + (state.pieSpeed || 0.9).toFixed(1) + '× · THROW ON COLOUR') : isUfo ? (state.ufoPhase === 'flyby' ? 'SPOT THE UFO · ROUND ' + state.ufoCycle : state.ufoPhase === 'feedback' ? 'ROUND COMPLETE · NEXT UFO INCOMING' : 'WHICH UFO JUST FLEW PAST? · ROUND ' + state.ufoCycle)
      : isBurger ? 'R = MEAT     ·     G = VEGETABLE     ·     B = TOMATO'
      : 'Race to ' + state.targetCycles + ' completed cycles!');
    this.diceGraphics.setVisible(isDice);
    this.matrixCells.forEach((cell, index) => {
      const visible = isMatrix;
      cell.setVisible(visible);
      cell.setText(index === 8 ? '?' : (state.matrixPuzzle?.cells?.[index] || (state.status === 'waiting' ? ['●','▲','■','▲','■','●','■','●'][index] : '')));
      cell.setColor(index === 8 ? '#fbbf24' : '#f8fafc').setBackgroundColor(index === 8 ? '#493d20' : '#243247');
    });
    this.matrixOptions.forEach((option, index) => {
      option.setVisible(isMatrix);
      option.setText(['R','G','B'][index] + ' · ' + (state.matrixPuzzle?.options?.[index] || (state.status === 'waiting' ? ['●','▲','■'][index] : '')));
    });
    this.burgerStackText.setVisible(isBurger);
    this.pieContainer.setVisible(isPie); this.pieHud.setVisible(isPie); this.pieKnife.setVisible(isPie);
    this.ufoCity?.setVisible(isUfo);
    if(isPie){
      this.pieGraphics.clear();
      const radius=Math.min(this.scale.width*.19,this.scale.height*.29,190);
      const colors=[0xef4444,0x22c55e,0x3b82f6];
      for(let sector=0;sector<3;sector++){
        const start=-Math.PI/2-Math.PI/3+sector*Math.PI*2/3-state.pieAngle;
        const end=start+Math.PI*2/3; const points=[{x:0,y:0}];
        for(let step=0;step<=24;step++){const a=start+(end-start)*step/24;points.push({x:Math.cos(a)*radius,y:Math.sin(a)*radius});}
        this.pieGraphics.fillStyle(colors[sector],1);this.pieGraphics.fillPoints(points,true);
        this.pieGraphics.lineStyle(4,0x050505,1);this.pieGraphics.strokePoints(points,true);
      }
      this.pieGraphics.fillStyle(0x050505,1);this.pieGraphics.fillCircle(0,0,radius*.12);
      for(const player of state.players.filter(p=>p.joined)){
        for(const knife of player.pieKnives||[]){
          const a=knife.angle-state.pieAngle, x=Math.cos(a)*radius*.88, y=Math.sin(a)*radius*.88;
          this.pieGraphics.lineStyle(5,0xffffff,1);this.pieGraphics.lineBetween(x-Math.cos(a)*22,y-Math.sin(a)*22,x+Math.cos(a)*22,y+Math.sin(a)*22);
          this.pieGraphics.fillStyle(({R:0xef4444,G:0x22c55e,B:0x3b82f6})[knife.color]||0xffffff,1);this.pieGraphics.fillCircle(x,y,5);
        }
      }
      this.pieHud.setText('R / G / B · HIT THE MATCHING COLOUR');
      if(state.pieLastHitId!==this.lastPieHit){this.lastPieHit=state.pieLastHitId;this.pieKnife.setPosition(this.scale.width/2,this.scale.height*.78).setScale(.65).setAlpha(1);this.tweens.add({targets:this.pieKnife,y:this.scale.height*.57,scale:1.05,alpha:0,duration:300,ease:'Cubic.Out'});}
    } this.ufoWindow.setVisible(false);
    this.ufoLegendGraphics?.setVisible(isUfo);
    this.ufoOptions.forEach((o,i)=>{o.setVisible(isUfo);if(state.ufoOptions?.[i])o.setTexture('ufo-'+state.ufoOptions[i]);else o.setTexture('ufo-'+(i+1));});
    this.ufoOptionLabels.forEach(o=>o.setVisible(isUfo));
    if(isUfo && state.ufoRoundId!==this.lastUfoRound){
      this.lastUfoRound=state.ufoRoundId;
      const path=UFO_FLIGHT_PATHS[state.ufoPathIndex||0]||UFO_FLIGHT_PATHS[0];
      const sx=this.scale.width/600, sy=this.scale.height/600;
      this.tweens.killTweensOf(this.ufoTarget);
      this.ufoTarget.setTexture('ufo-'+(state.ufoTargetId||1))
        .setPosition(path.x*sx,path.y*sy).setFlipY(Boolean(path.flipY)).setAlpha(1).setVisible(true);
      this.tweens.add({targets:this.ufoTarget,x:path.xEnd*sx,y:path.yEnd*sy,duration:300,yoyo:true,ease:'Power1',
        onComplete:()=>this.ufoTarget.setVisible(false)});
    }
    if(!isUfo){this.ufoTarget.setVisible(false);this.ufoOptions.forEach(o=>o.setVisible(false));this.ufoOptionLabels.forEach(o=>o.setVisible(false));this.ufoLegendGraphics?.setVisible(false);}
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
      item.setText(isDice ? (state.diceValues ? String(state.diceValues[index] ?? '?') : '?') : '');
    });
    if (isDice && state.diceRoundId !== this.lastDiceRound) {
      this.lastDiceRound = state.diceRoundId;
      this.animateDiceRoll(state.diceValues || []);
    }
    this.diceLabels.forEach((item) => item.setVisible(isDice));
    const players = state.players.filter((player) => player.joined);
    const colors = { RED: '#f87171', GREEN: '#4ade80', BLUE: '#60a5fa' };
    if (!isDice && !isUfo && !isPie) {
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
      if (isDice || isUfo || isPie || isMatrix || !state.players[index]?.joined) {
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
  $('#results-page').hidden = true;
  $('#review-results').hidden = true;
  $('#session-id').textContent = 'Session ' + session.id;
  $('#dashboard').classList.add('room-active');
  $('#player-strip').innerHTML = '';
  $('#race-display').replaceChildren();
  delete $('#race-display').dataset.ready;
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
    const joinUrl = publicBaseUrl + '/player/?sessionId=' + encodeURIComponent(session.id) + '&joinToken=' + encodeURIComponent(player.joinToken);
    qr.src = await QRCode.toDataURL(joinUrl);
    const joinLink = document.createElement('a');
    joinLink.className = 'player-join-link';
    joinLink.href = joinUrl;
    joinLink.target = '_blank';
    joinLink.rel = 'noopener';
    joinLink.textContent = 'Open player link';
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
    card.append(title, mascot, qr, joinLink, status, count, result);
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
  game.events.once('ready', () => {
    const root = $('#game-root');
    const width = Math.max(320, root.clientWidth || window.innerWidth);
    const height = Math.max(220, root.clientHeight || Math.round(window.innerHeight * 0.7));
    game.scale.resize(width, height);
    game.scene.keys.RGBScene.layout(width, height);
    if (currentState) game.scene.keys.RGBScene.updateState(currentState);
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
$('#start-level').addEventListener('click', () => {
  const stage = Number($('#level-select').value);
  $('#start-level').disabled = true;
  $('#start-level').dataset.pending = 'true';
  $('#error').textContent = '';
  socket?.emit('host:control', { sessionId: currentState?.id, action: 'challenge', stage }, (ack) => {
    $('#start-level').disabled = false;
    delete $('#start-level').dataset.pending;
    if (!ack?.ok) $('#error').textContent = ack?.error || 'Could not start selected level';
    else $('#error').textContent = '';
  });
});
$('#review-results').addEventListener('click', () => {
  $('#review-results').disabled = true;
  socket?.emit('host:control', { sessionId: currentState?.id, action: 'review' }, (ack) => {
    $('#review-results').disabled = false;
    if (!ack?.ok) $('#error').textContent = ack?.error || 'Could not review tournament results';
    else $('#error').textContent = '';
  });
});

if (token) {
  fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((response) => { if (!response.ok) throw new Error('Session expired'); return response.json(); })
    .then((data) => show(data.user))
    .catch(() => { sessionStorage.removeItem('rgb-token'); token = null; });
}
