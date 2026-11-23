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
let lastKnifeMissId = 0;
let lastKnifeHitId = 0;
let lastBurgerStackFlashId = 0;
let lastBurgerStackMissId = 0;
let errorAudioContext;
function playErrorSound() {
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    errorAudioContext ||= new AudioCtor();
    if (errorAudioContext.state === 'suspended') errorAudioContext.resume();
    const now = errorAudioContext.currentTime;
    const oscillator = errorAudioContext.createOscillator();
    const gain = errorAudioContext.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(260, now);
    oscillator.frequency.exponentialRampToValueAtTime(115, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain); gain.connect(errorAudioContext.destination);
    oscillator.start(now); oscillator.stop(now + 0.23);
  } catch { /* Audio remains optional when the browser blocks playback. */ }
}
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
    if (!result.ok) { playErrorSound(); setFeedback(readableError(result.error), 'warning'); }
  });
}

function renderController(name, color, state) {
  root.innerHTML = '<header><div><h1 id="player-name"></h1><p id="player-color"></p></div><span id="connection-state">Connected</span></header>' +
    '<p id="feedback" aria-live="polite">Waiting for the game to start</p>' +
    '<section id="level-intro" class="level-intro" hidden><strong id="level-intro-title"></strong><p id="level-intro-copy"></p><small>Game begins when the player controller starts the level.</small></section>' +
    '<section id="burger-quiz" class="burger-quiz" hidden><strong>BUILD THIS BURGER</strong><div class="burger-quiz-columns"><div><small>RECIPE</small><div id="burger-quiz-stack" class="burger-quiz-stack"></div></div><div><small>YOUR BURGER</small><div id="burger-built-stack" class="burger-quiz-stack"><span>🍞</span></div></div></div></section>' +
    '<section id="pie-screen" class="pie-screen" hidden><div class="pie-hud"><strong>KNIFE HIT</strong><span id="pie-score"></span></div><div class="pie-stage"><div id="pie-wheel" class="pie-wheel"><span class="pie-centre"></span></div><div class="pie-pointer"></div><div id="pie-knife" class="pie-knife">🔪</div><div id="pie-reject" class="pie-reject">✕</div></div><p id="pie-next-hint">Match the colour at the pointer</p></section>' +
    '<div class="sequence" id="sequence"><span>R</span><span>G</span><span>B</span></div>' +
    '<p id="input-hint" class="input-hint">Tap R → G → B in order</p>' +
    '<section id="flappy-screen" class="flappy-screen" hidden><div class="flappy-hud"><strong id="flappy-count">0 / 20 BLOCKERS</strong><span id="flappy-difficulty">EASY FLIGHT</span></div><div id="flappy-world" class="flappy-world" role="button" tabindex="0" aria-label="Tap to boost rocket"><div class="flappy-stars"></div><div id="flappy-obstacles" class="flappy-obstacles"></div><div id="flappy-rocket" class="flappy-rocket"><div class="rocket-window"><img id="flappy-avatar" alt="Your profile" hidden><span id="flappy-default">🚀</span></div><div class="rocket-flame"></div></div><div id="flappy-crash" class="flappy-crash">BOOST AGAIN!</div><div class="flappy-tap-hint">TAP ANYWHERE TO BOOST</div></div><div class="flappy-progress"><div id="flappy-progress-fill"></div></div></section>' +
    '<section id="burger-builder-screen" class="burger-builder-screen" hidden><div class="burger-builder-hud"><strong id="burger-builder-score">Score: 0</strong><span id="burger-builder-progress">0 / 6 BURGERS</span></div><div class="burger-builder-board"><div class="burger-builder-current"><span class="burger-caption">YOUR BURGER</span><div id="burger-builder-layers" class="burger-builder-layers"></div></div><div class="burger-builder-target"><span class="burger-caption">TARGET BURGER</span><div id="burger-builder-recipe" class="burger-builder-layers"></div></div></div><div id="burger-builder-result" class="burger-builder-result"></div></section>' +
    '<section id="burger-stack-screen" class="burger-stack-screen" hidden><div class="burger-stack-hud"><strong id="burger-stack-progress">0 / 4 BURGERS</strong><span id="burger-stack-difficulty">EASY STACK</span></div><div class="burger-stack-world"><div class="burger-stack-lanes"><span></span><span></span><span></span></div><div id="burger-stack-drops" class="burger-stack-drops"></div><div id="burger-stack-player" class="burger-stack-player">👨‍🍳</div><div id="burger-stack-base" class="burger-stack-base"><span>🍞</span><div id="burger-stack-layers"></div><span>🍞</span></div><div id="burger-stack-effect" class="burger-stack-effect">PERFECT STACK!</div><div id="burger-stack-miss" class="burger-stack-miss">MISALIGNED! -1 SEC</div></div><div class="burger-stack-status"><span id="burger-stack-challenge">CHALLENGE 1</span><span id="burger-stack-penalty"></span></div></section>' +
    '<section id="knife-wheel-screen" class="knife-wheel-screen" hidden><div class="knife-wheel-hud"><strong id="knife-wheel-score">R: 0/4　G: 0/4　B: 0/4</strong><span id="knife-wheel-speed">ROTATING WHEEL</span></div><div class="knife-wheel-world"><div id="knife-wheel" class="knife-wheel"><div class="knife-wheel-core"></div><div id="knife-wheel-knives" class="knife-wheel-knives"></div></div><div class="knife-launch">🔪</div><div id="knife-wheel-miss" class="knife-wheel-miss">CLASH! TRY AGAIN</div></div></section>' +
    '<section id="island-screen" class="island-screen" hidden><div class="island-hud"><strong id="island-progress">0 / 50 SHARKS</strong><span id="island-milestone">START</span></div><div class="island-world"><div class="island-sky"></div><div class="island-sea"></div><div class="island-destination">🏝️<small>DESTINATION</small></div><div id="island-preview" class="island-preview"></div><div id="island-steps" class="island-steps"></div><div id="island-player" class="island-player">🧑‍🚀</div><div id="island-shark" class="island-shark">🦈</div><div id="island-bite" class="island-bite">CHOMP! -1 SEC</div></div><div class="island-progress"><div id="island-progress-fill"></div></div></section>' +
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
      const payload = { action: latestState?.stage === 4 ? 'JUMP' : button.dataset.a, inputId: thisInput };
      if (latestState?.stage === 2) payload.roundId = latestState.diceRoundId;
      if (latestState?.stage === 5) payload.roundId = latestState.burgerRoundId;
      if (latestState?.stage === 6) payload.roundId = latestState.ufoRoundId;
      if (latestState?.stage === 10) payload.roundId = latestState.matrixRoundId;
      socket.emit('player:input', payload, (result) => {
        button.classList.remove('pressed');
        if (!result.ok) { playErrorSound(); setFeedback(readableError(result.error), 'warning'); }
        else if (!result.correct) { playErrorSound(); if (latestState?.stage === 7) { const reject = root.querySelector('#pie-reject'); reject.classList.remove('show'); void reject.offsetWidth; reject.classList.add('show'); const knife = root.querySelector('#pie-knife'); knife.classList.remove('reject'); void knife.offsetWidth; knife.classList.add('reject'); } setFeedback(latestState?.stage === 5
          ? '✕ Wrong ingredient — wait for the next burger'
          : latestState?.stage === 2 ? '✕ Wrong position — wait for the next dice roll'
            : 'Wrong colour — sequence restarted', 'warning'); }
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
  const isBurgerStack = state.stage === 9;
  const isMatrix = state.stage === 10;
  const individualScreen = state.stage >= 3 && state.stage <= 9;
  const intro = root.querySelector('#level-intro');
  intro.hidden = state.status !== 'waiting' || !individualScreen;
  const introCopy = {
    3:['HIGHWAY DODGE','Use R, G and B to switch lanes. Avoid traffic.'],
    4:['ROCKET FLIGHT','Tap any R, G or B button to boost your rocket.'],
    5:['BURGER BUILDER','Use R, G and B to select the correct ingredient.'],
    6:['UFO SPOTTER','Watch the UFO, then choose its matching position.'],
    7:['KNIFE HIT','Use R, G and B to throw at the matching pie colour.'],
    8:['SHARK ISLAND CROSSING','Match each shark colour using R, G and B.'],
    9:['BURGER STACK','Use R and B to move left and right to catch ingredients.']
  };
  if (introCopy[state.stage]) {
    root.querySelector('#level-intro-title').textContent = introCopy[state.stage][0];
    root.querySelector('#level-intro-copy').textContent = introCopy[state.stage][1];
  }
  root.querySelectorAll('[data-a]').forEach((button) => {
    button.hidden = isBurgerStack && button.dataset.a === 'G';
    button.disabled = state.status !== 'playing' || state.paused || mine.completed ||
      !mine.activeForRound || (isDice && mine.roundAttempted) ||
      (isBurger && mine.burgerRoundAttempted) ||
      (isUfo && (state.ufoPhase !== 'choose' || mine.ufoRoundAttempted)) ||
      (isMatrix && mine.matrixRoundAttempted) ||
      (isRace && (mine.race?.penaltyMs || 0) > 0) ||
      (isIsland && (mine.island?.penaltyMs || 0) > 0) ||
      (isBurgerStack && (mine.burgerStack?.penaltyMs || 0) > 0);
  });
  const sequence = root.querySelector('#sequence');
  const hint = root.querySelector('#input-hint');
  sequence.hidden = individualScreen || isMatrix;
  hint.hidden = individualScreen || isMatrix;
  for (const selector of ['#race-screen','#burger-quiz','#pie-screen','#flappy-screen','#burger-builder-screen','#burger-stack-screen','#knife-wheel-screen','#island-screen']) {
    const element = root.querySelector(selector);
    if (element) element.hidden = true;
  }
  root.querySelector('.pad').hidden = false;
  root.querySelector('.pad').classList.toggle('burger-stack-pad', isBurgerStack);
  if (isDice) {
    sequence.hidden = false;
    hint.hidden = false;
    sequence.innerHTML = '<span>R</span><span>G</span><span>B</span>';
    hint.textContent = 'R = LEFT  ·  G = MIDDLE  ·  B = RIGHT';
  } else if (isMatrix) {
    sequence.hidden = false;
    hint.hidden = false;
    hint.textContent = 'Choose the missing square · R LEFT · G MIDDLE · B RIGHT';
  }
  if (mine.completed) setFeedback('You finished — ' + ordinal(mine.place) + ' place!', 'success');
  else if (state.status === 'finished') setFeedback('Level complete. Next level is ready.', 'success');
  else if (state.paused) setFeedback('Game paused', 'warning');
  else if (state.status === 'waiting') setFeedback('Waiting for the game to start', '');
  else if (!mine.activeForRound) setFeedback('Ready for the next level', '');
  else if (isRace && (mine.race?.penaltyMs || 0) > 0) setFeedback('CRASH! 2-second penalty — hold tight', 'warning');
  else if (isFlappy && (mine.flappy?.penaltyMs || 0) > 0) setFeedback('ROCKET BUMPED — GET READY TO BOOST', 'warning');
  else if (isFlappy) setFeedback('Tap R, G or B to boost your rocket!', '');
  else if (isRace) setFeedback('Dodge traffic! R left · G centre · B right', '');
  else if (isPie && mine.roundFeedback === 'wrong') setFeedback(state.pieLastMiss?.occupied ? 'Knife collision! That position is already occupied.' : 'Wrong colour — time your throw with the rotating wheel.', 'warning');
  else if (isPie) setFeedback('Throw when the matching colour reaches the top. Avoid embedded knives!', '');
  else if (isIsland && mine.island?.penaltyMs > 0) setFeedback('SHARK BITE! Recovering for 1 second…', 'warning');
  else if (isIsland && mine.roundFeedback === 'bitten') setFeedback('Wrong colour! You fell back to the last island checkpoint.', 'warning');
  else if (isIsland) setFeedback('Preview the sharks, then press the matching colour to move forward!', '');
  else if (isBurgerStack && (mine.burgerStack?.penaltyMs || 0) > 0) setFeedback('MISALIGNED! Recovering for 1 second…', 'warning');
  else if (isBurger && mine.roundFeedback === 'wrong') setFeedback('Wrong ingredient — wait for the next burger recipe.', 'warning');
  else if (isBurger) setFeedback('Build the target burger in order: R meat · G lettuce · B tomato.', '');
  else if (isBurgerStack && mine.burgerStack?.successCount > 0) setFeedback('Burger challenge ' + mine.burgerStack.successCount + ' complete — keep stacking!', 'success');
  else if (isBurgerStack) setFeedback('Catch each ingredient in the matching lane to build a perfect burger!', '');
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
  else if (isMatrix && mine.matrixRoundAttempted && mine.roundFeedback === 'wrong') setFeedback('✕ Incorrect — wait for the next puzzle', 'warning');
  else if (isMatrix && mine.roundFeedback === 'correct') setFeedback('Correct pattern! +1 point', 'success');
  else if (isMatrix) setFeedback('Find the missing square in the matrix', '');
  else setFeedback('Tap R → G → B in order', '');
  renderControls(state);
  const target = root.querySelector('#target-cycles');
  if (target && document.activeElement !== target) target.value = state.targetCycles;
}

function renderBurgerBuilder(state, mine) {
  const recipe=state.burgerSequence||[],built=recipe.slice(0,mine.burgerProgressIndex||0),emoji={R:'🥩',G:'🥬',B:'🍅'};
  root.querySelector('#burger-builder-score').textContent='Score: '+(mine.totalPoints||0);
  root.querySelector('#burger-builder-progress').textContent=(mine.successCount||0)+' / '+state.burgerTarget+' BURGERS';
  const layers=(items,complete)=>'<span class="bun top">🍞</span>'+items.map(a=>'<span class="burger-layer '+a.toLowerCase()+'">'+emoji[a]+'</span>').join('')+(complete?'<span class="bun bottom">🍞</span>':'');
  root.querySelector('#burger-builder-layers').innerHTML=layers(built,built.length===recipe.length&&recipe.length>0);
  root.querySelector('#burger-builder-recipe').innerHTML=layers(recipe,true);
  root.querySelector('#burger-builder-result').textContent=built.length?'INGREDIENTS '+built.length+' / '+recipe.length:'BUILD THE SHOWN RECIPE';
}
function renderKnifeWheel(state,mine) {
  root.querySelector('#knife-wheel').style.transform='rotate('+(-(state.pieAngle||0)*180/Math.PI)+'deg)';
  root.querySelector('#knife-wheel-score').textContent='R: '+(mine.pieHits?.R||0)+'/4　G: '+(mine.pieHits?.G||0)+'/4　B: '+(mine.pieHits?.B||0)+'/4';
  root.querySelector('#knife-wheel-speed').textContent='SPEED '+(state.pieSpeed||0.9).toFixed(1)+'×';
  root.querySelector('#knife-wheel-knives').innerHTML=(mine.pieKnives||[]).map(k=>'<span class="embedded-knife '+k.color.toLowerCase()+'" style="--knife-angle:'+k.angle*180/Math.PI+'deg">🔪</span>').join('');
  if((state.pieLastHitId||0)>lastKnifeHitId){lastKnifeHitId=state.pieLastHitId;const launch=root.querySelector('.knife-launch');launch.classList.remove('throw');void launch.offsetWidth;launch.classList.add('throw');}
  if((state.pieMissId||0)>lastKnifeMissId){lastKnifeMissId=state.pieMissId;const el=root.querySelector('#knife-wheel-miss');el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
}
function renderBurgerStack(state, mine) {
  const stack = mine.burgerStack || {};
  const successes = stack.successCount || 0;
  const lane = stack.lane ?? 1;
  root.querySelector('#burger-stack-progress').textContent = successes + ' / 4 BURGERS';
  root.querySelector('#burger-stack-difficulty').textContent = ['EASY STACK','QUICKER DROPS','FAST STACKING','MASTER CHEF'][Math.min(3, successes)];
  root.querySelector('#burger-stack-challenge').textContent = 'CHALLENGE ' + (stack.challengeNumber || 1) + ' · ' + (stack.challengeLength || 5) + ' LAYERS';
  const remaining = Math.ceil((stack.penaltyMs || 0) / 100) / 10;
  root.querySelector('#burger-stack-penalty').textContent = remaining > 0 ? 'RECOVERING ' + remaining.toFixed(1) + 's' : '';
  root.querySelector('#burger-stack-player').style.left = [20,50,80][lane] + '%';
  root.querySelector('#burger-stack-base').style.left = [20,50,80][lane] + '%';
  const layers = root.querySelector('#burger-stack-layers');
  layers.innerHTML = ((stack.stacked && stack.stacked.length ? stack.stacked : stack.completedStack) || []).map((item) => '<span>' + ({R:'🥩',G:'🥬',B:'🍅',Y:'🧀',P:'🥒'}[item.ingredient] || '🍔') + '</span>').join('');
  const drops = root.querySelector('#burger-stack-drops');
  drops.innerHTML = (stack.drops || []).map((drop) => '<span class="burger-stack-drop" style="left:' + [20,50,80][drop.lane] + '%;top:' + (drop.y * 100) + '%">' + ({R:'🥩',G:'🥬',B:'🍅',Y:'🧀',P:'🥒'}[drop.ingredient] || '🍔') + '</span>').join('');
  if ((stack.stackFlashId || 0) > lastBurgerStackFlashId) {
    lastBurgerStackFlashId = stack.stackFlashId;
    const base = root.querySelector('#burger-stack-base');
    base.classList.remove('stack-flash'); void base.offsetWidth; base.classList.add('stack-flash');
    const effect = root.querySelector('#burger-stack-effect');
    effect.classList.remove('show'); void effect.offsetWidth; effect.classList.add('show');
  }
  if ((stack.missId || 0) > lastBurgerStackMissId) {
    lastBurgerStackMissId = stack.missId;
    const overlay = root.querySelector('#burger-stack-miss');
    overlay.classList.remove('show'); void overlay.offsetWidth; overlay.classList.add('show');
  }
}

function renderPie(state, mine) {
  const wheel = root.querySelector('#pie-wheel');
  wheel.style.transform = 'rotate(' + ((state.pieAngle || 0) * 180 / Math.PI) + 'deg)';
  root.querySelector('#pie-score').textContent = 'R ' + (mine.pieHits?.R || 0) + '/6 · G ' + (mine.pieHits?.G || 0) + '/6 · B ' + (mine.pieHits?.B || 0) + '/6';
  root.querySelector('#pie-next-hint').textContent = 'Watch the pointer · Press the matching colour';
  if ((state.pieLastHitId || 0) > lastPieHitId) {
    lastPieHitId = state.pieLastHitId;
    if (state.pieLastHit?.playerColor === playerColor) {
      const knife = root.querySelector('#pie-knife');
      knife.classList.remove('stick'); void knife.offsetWidth; knife.classList.add('stick');
    }
  }
}

function renderIsland(state, mine) {
  const island = mine.island || { progress:0, milestone:0, sharks:[], penaltyMs:0, biteId:0 };
  const progress = island.progress || 0;
  root.querySelector('#island-progress').textContent = progress + ' / 50 SHARKS';
  root.querySelector('#island-milestone').textContent = island.milestone ? 'CHECKPOINT ' + island.milestone : 'START ISLAND';
  root.querySelector('#island-progress-fill').style.width = (progress / 50 * 100) + '%';
  const player = root.querySelector('#island-player');
  player.style.left = '50%'; player.style.top = (88 - progress / 50 * 58) + '%';
  if (progress !== lastIslandProgress) { lastIslandProgress = progress; player.classList.remove('step-forward'); void player.offsetWidth; if (progress > 0 && island.penaltyMs <= 0) player.classList.add('step-forward'); }
  player.classList.toggle('bitten', (island.penaltyMs || 0) > 0);
  const colors={R:'#ef4444',G:'#22c55e',B:'#3b82f6'};
  root.querySelector('#island-preview').innerHTML=(island.sharks||[]).slice(progress,progress+6).map((color,index)=>'<span class="shark-preview '+(island.orientations?.[progress+index]||'horizontal')+'" style="--shark-color:'+colors[color]+'">🦈</span>').join('');
  const shark=root.querySelector('#island-shark'),currentColor=island.sharks?.[progress]||'R';
  shark.textContent='🦈';shark.style.filter='drop-shadow(0 0 12px '+colors[currentColor]+')';
  shark.style.left='50%';shark.style.top=Math.max(24,88-progress/50*58+10)+'%';
  shark.classList.toggle('vertical',island.orientations?.[progress]==='vertical');
  root.querySelector('#island-world').classList.toggle('island-nudge',(island.nudgeId||0)>lastIslandBiteId);
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
    FLAPPY_RECOVERING: 'Rocket recovering — tap again in a moment',
    BURGER_STACK_RECOVERING: 'Recovering from a missed ingredient — wait 1 second'
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
