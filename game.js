// game.js - Main game orchestrator
import * as THREE from 'three';
import { createEngine, loadCharacter, createTrack } from './engine.js';
import { buildQuestions, createGateGroup, createFinishLine, getGateColliders, shuffle } from './gates.js';

// ── DOM refs ────────────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
const progressBar    = document.getElementById('progress-bar');
const loadingStatus  = document.getElementById('loading-status');
const startScreen    = document.getElementById('start-screen');
const gameHud        = document.getElementById('game-hud');
const hudScore       = document.getElementById('hud-score');
const hudQuestion    = document.getElementById('hud-question');
const hudProgress    = document.getElementById('hud-progress');
const hudHearts      = document.getElementById('hud-hearts');
const feedbackOverlay= document.getElementById('feedback-overlay');
const feedbackContent= document.getElementById('feedback-content');
const resultScreen   = document.getElementById('result-screen');
const resultIcon     = document.getElementById('result-icon');
const resultTitle    = document.getElementById('result-title');
const resultMessage  = document.getElementById('result-message');
const resultCorrect  = document.getElementById('result-correct');
const resultWrong    = document.getElementById('result-wrong');
const resultScore    = document.getElementById('result-score');
const startBtn       = document.getElementById('start-btn');
const restartBtn     = document.getElementById('restart-btn');
const btnLeft        = document.getElementById('btn-left');
const btnRight       = document.getElementById('btn-right');
const btnUp          = document.getElementById('btn-up');
const btnDown        = document.getElementById('btn-down');
const ttsRepeat      = document.getElementById('tts-repeat');

// ── Canvas ──────────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
document.body.insertBefore(canvas, document.body.firstChild);
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;';

// ── Three.js globals ────────────────────────────────────────────────────────
let renderer, scene, camera, dirLight;
let charModel, mixer, animations = {};
let currentAnim = null;
let clock = new THREE.Clock();
let finishLineGroup = null;
let charBaseY = 0; // ground offset from auto-scaling

// ── Game State ───────────────────────────────────────────────────────────────
const LANE_X   = [-3, 0, 3];
const GATE_GAP = 45;
const TOTAL_Q  = 10;
const FINISH_Z = -(TOTAL_Q * GATE_GAP + 30);
const RUN_SPEED = 7;

let state = {};

function resetState() {
    return {
        running:     false,
        finished:    false,
        charZ:       0,
        charX:       0,
        targetLane:  1,   // 0 left, 1 center, 2 right
        laneX:       0,
        isJumping:   false,
        jumpVY:      0,
        charY:       0,
        isRolling:   false,
        rollTimer:   0,
        score:       0,
        hearts:      3,
        correctCount:0,
        wrongCount:  0,
        questionIdx: 0,
        questions:   buildQuestions().slice(0, TOTAL_Q),
        gates:       [],
        gateAnswered:[],
        nextGateActive: false,
        awaitingGate:   false,
        blockedTimer:   0,
        gameTime:       0,
    };
}

// ── SoundFX (Web Audio API) ──────────────────────────────────────────────────
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

const sfx = {
    jump: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    },
    roll: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    },
    correct: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.setValueAtTime(600, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    },
    wrong: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    },
    win: () => {
        setTimeout(() => sfx.correct(), 0);
        setTimeout(() => sfx.correct(), 150);
        setTimeout(() => sfx.correct(), 300);
    },
    move: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    },
    click: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    }
};

function unlockAudio() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance('');
        utter.volume = 0;
        window.speechSynthesis.speak(utter);
    }
}

// ── TTS ─────────────────────────────────────────────────────────────────────
function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.9;
    utter.pitch = 1.1;
    window.speechSynthesis.speak(utter);
}

// ── HUD helpers ──────────────────────────────────────────────────────────────
function getActionHint(height) {
    switch (height) {
        case 'low':  return '<i class="fa-solid fa-arrow-down"></i> GULING';
        case 'mid':  return '<i class="fa-solid fa-arrow-right"></i> LARI';
        case 'high': return '<i class="fa-solid fa-arrow-up"></i> LOMPAT';
        default:     return '';
    }
}

function updateHud() {
    hudScore.textContent    = state.score;
    hudProgress.textContent = `${state.questionIdx}/${TOTAL_Q}`;

    const heartSpans = hudHearts.querySelectorAll('span');
    heartSpans.forEach((s, i) => {
        s.classList.toggle('lost', i >= state.hearts);
    });

    if (state.questionIdx < TOTAL_Q && state.running) {
        const q = state.questions[state.questionIdx];
        if (q) {
            const action = getActionHint(q.correctHeight);
            hudQuestion.innerHTML = `<i class="fa-solid fa-lemon"></i> ${q.correct.toUpperCase()} &nbsp;&nbsp; ${action}`;
        }
    }
}

function showFeedback(isCorrect) {
    feedbackContent.innerHTML = isCorrect ? '<i class="fa-solid fa-check"></i> BENAR!' : '<i class="fa-solid fa-xmark"></i> YAH SALAH!';
    feedbackContent.className = isCorrect ? 'correct' : 'wrong';
    feedbackOverlay.classList.remove('hidden');

    // Screen flash
    const flash = document.createElement('div');
    flash.className = `screen-flash ${isCorrect ? 'correct' : 'wrong'}`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);

    setTimeout(() => feedbackOverlay.classList.add('hidden'), 900);
}

function showFeedbackCustom(message, type) {
    feedbackContent.innerHTML = message;
    feedbackContent.className = type;
    feedbackOverlay.classList.remove('hidden');

    const flash = document.createElement('div');
    flash.className = `screen-flash ${type}`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);

    setTimeout(() => feedbackOverlay.classList.add('hidden'), 1200);
}

function showResult() {
    const perfect = state.wrongCount === 0;
    if (perfect) {
        sfx.win();
    }
    resultIcon.innerHTML = perfect ? '<i class="fa-solid fa-trophy" style="color:#facc15"></i>' : state.correctCount >= TOTAL_Q / 2 ? '<i class="fa-solid fa-star" style="color:#facc15"></i>' : '<i class="fa-solid fa-face-smile" style="color:#3b82f6"></i>';
    resultTitle.textContent = perfect ? 'Wah, Hana Hebat!' : state.correctCount >= TOTAL_Q / 2 ? 'Pintar Sekali!' : 'Tetap Semangat Ya!';
    resultMessage.textContent = `Hana menjawab ${state.correctCount} dari ${TOTAL_Q} nama buah dengan benar.`;
    resultCorrect.textContent = state.correctCount;
    resultWrong.textContent   = state.wrongCount;
    resultScore.textContent   = state.score;
    resultScreen.classList.remove('hidden');
    speak(perfect ? 'Perfect run, amazing job!' : state.correctCount >= TOTAL_Q / 2 ? 'Great job, keep it up!' : 'Keep practicing, you can do it!');
}

// ── Animation helpers ────────────────────────────────────────────────────────
function playAnim(name, crossfade = 0.15) {
    if (!animations[name]) return;
    const next = animations[name];
    if (currentAnim === next && next.isRunning()) return;
    if (currentAnim && currentAnim !== next) {
        currentAnim.fadeOut(crossfade);
    }
    next.reset().fadeIn(crossfade).play();
    currentAnim = next;
}

// ── Gate flash on answer ─────────────────────────────────────────────────────
function flashGate(banner, isCorrect) {
    if (!banner || !banner.material) return;
    banner.material.color.set(isCorrect ? 0x22c55e : 0xef4444);
    setTimeout(() => { if (banner.material) banner.material.color.set(0xf0f0f0); }, 800);
}

// ── Handle gate collision ────────────────────────────────────────────────────
function checkPlayerAction() {
    if (state.isRolling) return 'low';
    if (state.isJumping && state.charY > 0.3) return 'high';
    return 'mid';
}

function handleGateHit(gate, gateGroup) {
    if (gateGroup.userData.answered) return;
    gateGroup.userData.answered = true;

    const isCorrectFruit  = gate.userData.isCorrect;
    const gateHeight      = gate.userData.height;
    const playerAction    = checkPlayerAction();
    const isCorrectAction = (playerAction === gateHeight);
    const isFullyCorrect  = isCorrectFruit && isCorrectAction;

    const banner = gate.userData.banner;
    flashGate(banner, isFullyCorrect);

    if (isFullyCorrect) {
        // Correct fruit + correct action
        sfx.correct();
        state.score += 100;
        state.correctCount++;
        showFeedback(true);
    } else if (isCorrectFruit && !isCorrectAction) {
        // Right fruit but wrong action
        sfx.wrong();
        state.hearts--;
        state.wrongCount++;
        showFeedbackCustom('<i class="fa-solid fa-lemon"></i> Buah benar, tapi salah gaya!', 'wrong');
        updateHearts();
        triggerWrongShake();
        if (state.hearts <= 0) { endGame(false); return; }
    } else {
        // Wrong fruit
        sfx.wrong();
        state.hearts--;
        state.wrongCount++;
        showFeedback(false);
        updateHearts();
        triggerWrongShake();
        if (state.hearts <= 0) { endGame(false); return; }
    }

    state.questionIdx++;
    updateHud();

    if (state.questionIdx < TOTAL_Q) {
        const q = state.questions[state.questionIdx];
        setTimeout(() => speak(q.correct), 1000);
    }
}

function updateHearts() {
    const icons = hudHearts.querySelectorAll('i');
    icons.forEach((icon, i) => icon.classList.toggle('lost', i >= state.hearts));
}

function triggerWrongShake() {
    canvas.style.animation = 'none';
    canvas.style.transform = 'translateX(-6px)';
    setTimeout(() => { canvas.style.transform = 'translateX(6px)'; }, 80);
    setTimeout(() => { canvas.style.transform = 'translateX(-4px)'; }, 160);
    setTimeout(() => { canvas.style.transform = ''; }, 240);
}

function endGame(won) {
    state.running  = false;
    state.finished = true;
    window.speechSynthesis.cancel();
    gameHud.classList.add('hidden');
    ttsRepeat.classList.add('hidden');
    setTimeout(showResult, 600);
}

// ── Keyboard & Touch input ───────────────────────────────────────────────────
function moveLeft() {
    if (!state.running) return;
    if (state.targetLane > 0) {
        sfx.move();
        state.targetLane--;
    }
}
function moveRight() {
    if (!state.running) return;
    if (state.targetLane < 2) {
        sfx.move();
        state.targetLane++;
    }
}
function doJump() {
    if (!state.running) return;
    if (!state.isJumping && !state.isRolling) {
        sfx.jump();
        state.isJumping = true;
        state.jumpVY    = 9;
        playAnim('jump', 0.1);
    }
}
function doRoll() {
    if (!state.running) return;
    if (!state.isJumping && !state.isRolling) {
        sfx.roll();
        state.isRolling  = true;
        state.rollTimer  = 0.8;
        playAnim('roll', 0.1);
    }
}

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'ArrowLeft') moveLeft();
    if (e.code === 'ArrowRight') moveRight();
    if (e.code === 'ArrowUp' || e.code === 'Space') doJump();
    if (e.code === 'ArrowDown') doRoll();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// On-screen buttons
btnLeft.addEventListener('pointerdown', moveLeft);
btnRight.addEventListener('pointerdown', moveRight);
btnUp.addEventListener('pointerdown', doJump);
btnDown.addEventListener('pointerdown', doRoll);

// Swipe gestures
let touchStartX = 0;
let touchStartY = 0;
window.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, {passive: false});

window.addEventListener('touchend', e => {
    if (!state.running) return;
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;
    
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return; // Tap, not a swipe
    
    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) moveRight();
        else moveLeft();
    } else {
        if (dy > 0) doRoll();
        else doJump();
    }
}, {passive: false});

window.addEventListener('touchmove', e => {
    if (state.running) e.preventDefault();
}, {passive: false});

// ── Main init ────────────────────────────────────────────────────────────────
async function init() {
    loadingStatus.textContent = 'Siap-siap ya Hana...';
    const eng = createEngine(canvas);
    renderer = eng.renderer;
    scene    = eng.scene;
    camera   = eng.camera;
    dirLight = eng.dirLight;

    loadingStatus.textContent = 'Membuat jalan raya...';
    progressBar.style.width   = '20%';
    createTrack(scene);

    loadingStatus.textContent = 'Memanggil karakter...';
    const char = await loadCharacter(scene, (p) => {
        progressBar.style.width = (20 + p * 60) + '%';
    });
    charModel  = char.model;
    mixer      = char.mixer;
    animations = char.animations;
    charBaseY  = charModel.position.y;

    // Set initial camera behind character
    camera.position.set(0, charBaseY + 5, 10);
    camera.lookAt(0, charBaseY + 1, 0);

    progressBar.style.width   = '100%';
    loadingStatus.textContent = 'Siap Bermain!';

    setTimeout(() => {
        loadingScreen.classList.add('hidden');
        startScreen.classList.remove('hidden');
    }, 600);

    requestAnimationFrame(gameLoop);
}

// ── Start game ───────────────────────────────────────────────────────────────
function startGame() {
    state = resetState();

    // Position character at start
    charModel.position.set(0, charBaseY, 0);
    charModel.rotation.y = Math.PI; // face forward (-Z direction)
    state.laneX = 0; // center lane x
    state.targetLane = 1;
    currentAnim = null;

    // Build gate groups at regular intervals
    state.questions.forEach((q, i) => {
        const z = -((i + 1) * GATE_GAP);
        const g = createGateGroup(scene, q, z);
        state.gates.push(g);
        state.gateAnswered.push(false);
    });

    // Finish line
    finishLineGroup = createFinishLine(scene, FINISH_Z);

    startScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    gameHud.classList.remove('hidden');
    ttsRepeat.classList.remove('hidden');

    state.running = true;

    // Play run animation
    setTimeout(() => {
        playAnim('run');
        updateHud();
    }, 200);
    // Speak synchronously to satisfy mobile browser policies
    speak(state.questions[0].correct);
}

// ── Camera follow (pre-allocated vectors to avoid GC stutter) ────────────────
const _camTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

function updateCamera() {
    _camTarget.set(
        charModel.position.x * 0.2,
        charBaseY + 4 + state.charY * 0.3,
        charModel.position.z + 8
    );
    camera.position.lerp(_camTarget, 0.1);
    _lookTarget.set(charModel.position.x, charBaseY + 1, charModel.position.z - 6);
    camera.lookAt(_lookTarget);
}

// ── Collision check (position-based, no bounding boxes) ─────────────────────
function checkCollisions() {
    if (!charModel) return;
    // Grace period: skip collision for first 1.5 seconds
    if (state.gameTime < 1.5) return;

    const charZ = state.charZ;
    const charLane = state.targetLane; // 0=left, 1=center, 2=right

    for (let gi = 0; gi < state.gates.length; gi++) {
        if (state.gateAnswered[gi]) continue;
        const gGroup = state.gates[gi];
        const gateZ = gGroup.position.z; // world Z of this gate set

        // Check if character Z is within ±1.0 unit of this gate
        if (charZ < gateZ + 1.0 && charZ > gateZ - 1.0) {
            state.gateAnswered[gi] = true;
            // Find the collider that matches the player's current lane
            const colliders = getGateColliders(gGroup);
            const hit = colliders.find(c => c.userData.laneIndex === charLane) || colliders[0];
            handleGateHit(hit, gGroup);
            break;
        }
    }
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function gameLoop() {
    requestAnimationFrame(gameLoop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (mixer) mixer.update(dt);

    if (state.running && charModel) {
        state.gameTime = (state.gameTime || 0) + dt;

        // Move forward
        state.charZ -= RUN_SPEED * dt;
        charModel.position.z = state.charZ;

        // Lane switching (smooth)
        state.laneX = THREE.MathUtils.lerp(state.laneX, LANE_X[state.targetLane], 8 * dt);
        charModel.position.x = state.laneX;

        // Jump physics (state.charY is offset above ground)
        if (state.isJumping) {
            state.jumpVY -= 22 * dt;
            state.charY  += state.jumpVY * dt;
            if (state.charY <= 0) {
                state.charY   = 0;
                state.isJumping = false;
                state.jumpVY  = 0;
                playAnim('run', 0.15);
            }
            charModel.position.y = charBaseY + state.charY;
        } else {
            charModel.position.y = charBaseY;
        }

        // Roll timer
        if (state.isRolling) {
            state.rollTimer -= dt;
            if (state.rollTimer <= 0) {
                state.isRolling = false;
                playAnim('run', 0.15);
            }
        }

        // Check finish
        if (state.charZ <= FINISH_Z + 3) {
            endGame(true);
        }

        checkCollisions();
        updateCamera();
        dirLight.position.set(charModel.position.x + 10, 20, charModel.position.z + 10);
    }

    renderer.render(scene, camera);
}

// ── Button listeners ─────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
    sfx.click();
    unlockAudio();
    startGame();
});
restartBtn.addEventListener('click', () => {
    sfx.click();
    unlockAudio();
    // Clean up old objects from scene
    state.gates.forEach(g => scene.remove(g));
    if (finishLineGroup) scene.remove(finishLineGroup);
    resultScreen.classList.add('hidden');
    startGame();
});
ttsRepeat.addEventListener('click', () => {
    sfx.click();
    if (state.questionIdx < TOTAL_Q) speak(state.questions[state.questionIdx].correct);
});



// ── Kick off ─────────────────────────────────────────────────────────────────
init().catch(err => {
    console.error('Init error:', err);
    loadingStatus.textContent = 'Error loading. Check console.';
});
