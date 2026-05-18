// game.js - Main game orchestrator
import * as THREE from 'three';
import { createEngine, loadCharacter, createTrack, updateEnvironment } from './engine.js';
import { buildQuestions, createGateGroup, createFinishLine, getGateColliders, shuffle } from './gates.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ── DOM refs ────────────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
const progressBar    = document.getElementById('progress-bar');
const loadingStatus  = document.getElementById('loading-status');
const startScreen    = document.getElementById('start-screen');
const gameHud        = document.getElementById('game-hud');
const hudScore       = document.getElementById('hud-score');
const hudStarCount   = document.getElementById('hud-star-count');
const hudQuestion    = document.getElementById('hud-question');
const hudProgress    = document.getElementById('hud-progress');
const hudHearts      = document.getElementById('hud-hearts');
const hudNext        = document.getElementById('hud-next');
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

// ── Game Models ─────────────────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
const models = {};

function normalizeScale(model, targetHeight) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = targetHeight / (size.y || 1);
    model.scale.set(scale, scale, scale);
    box.setFromObject(model);
    // Center mesh
    model.position.y = -box.min.y;
}

function makeBlackSilhouette(model) {
    model.traverse(c => {
        if (c.isMesh) {
            c.material = new THREE.MeshBasicMaterial({ color: 0x06090d });
        }
    });
}

function makeEmissive(model) {
    model.traverse(c => {
        if (c.isMesh && c.material) {
            if (c.material.color) c.material.emissive = c.material.color.clone();
            if (c.material.map) c.material.emissiveMap = c.material.map;
            c.material.emissiveIntensity = 1.0;
        }
    });
}

function makeUnlit(model) {
    model.traverse(c => {
        if (c.isMesh && c.material) {
            const oldMat = c.material;
            c.material = new THREE.MeshBasicMaterial({
                color: oldMat.color || 0xffffff,
                map: oldMat.map || null,
                transparent: oldMat.transparent || false,
                opacity: oldMat.opacity !== undefined ? oldMat.opacity : 1.0,
                side: oldMat.side || THREE.FrontSide,
                vertexColors: oldMat.vertexColors || false
            });
        }
    });
}

async function loadGameModels() {
    return new Promise(resolve => {
        let loaded = 0;
        const total = 4;
        const check = () => { if (++loaded === total) resolve(); };

        gltfLoader.load('3D/giraffe.glb', gltf => {
            const m = gltf.scene;
            normalizeScale(m, 10.0); // Jerapah lebih masive
            makeBlackSilhouette(m);
            models.giraffe = { mesh: m, animations: gltf.animations };
            check();
        });
        gltfLoader.load('3D/wolf.glb', gltf => {
            const m = gltf.scene;
            normalizeScale(m, 1.5);
            makeBlackSilhouette(m);
            models.wolf = { mesh: m, animations: gltf.animations };
            check();
        });
        gltfLoader.load('3D/star.glb', gltf => {
            const m = gltf.scene;
            normalizeScale(m, 0.175); // 70% dari versi 0.25
            m.rotation.x = Math.PI / 2; // Berdiri tidak rebahan
            
            const group = new THREE.Group();
            group.add(m);
            
            group.traverse(c => { 
                if(c.isMesh) {
                    c.material = new THREE.MeshBasicMaterial({ color: 0xffd700 });
                }
            });
            models.star = group;
            check();
        });
        gltfLoader.load('3D/book.glb', gltf => {
            const m = gltf.scene;
            normalizeScale(m, 1.0);
            makeUnlit(m); // Keep original colors but unlit (bright)
            models.book = m;
            check();
        });
    });
}

// ── Game State ───────────────────────────────────────────────────────────────
const LANE_X   = [-3, 0, 3];
const GATE_GAP = 65; // increased from 45 for more gap
const TOTAL_Q  = 10;
const FINISH_Z = -(TOTAL_Q * GATE_GAP + 80);
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
        hearts:      4,
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
        combo:       0,
        tier:        0, // -3 to 3
        items:       [],
        starCount:   0,
    };
}

// ── SoundFX (Web Audio API) ──────────────────────────────────────────────────
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

const ambienceAudio = new Audio('sfx/ambience.mp3');
ambienceAudio.loop = true;
ambienceAudio.volume = 0.3;

const correctAudio = new Audio('sfx/correct.mp3');
const wrongAudio = new Audio('sfx/wrong.mp3');

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
        correctAudio.currentTime = 0;
        correctAudio.play().catch(e => console.log('Correct sfx error:', e));
    },
    wrong: () => {
        wrongAudio.currentTime = 0;
        wrongAudio.play().catch(e => console.log('Wrong sfx error:', e));
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
    utter.lang = 'id-ID';
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
    let scoreText = state.score.toString();
    if (state.combo > 1) {
        scoreText += ` (x${state.combo})`;
    }
    hudScore.textContent = scoreText;
    hudProgress.textContent = `${state.questionIdx}/${TOTAL_Q}`;

    const heartSpans = hudHearts.querySelectorAll('span');
    heartSpans.forEach((s, i) => {
        s.classList.toggle('lost', i >= state.hearts);
    });

    if (state.questionIdx < TOTAL_Q && state.running) {
        const q = state.questions[state.questionIdx];
        if (q) {
            hudQuestion.innerHTML = q.questionText;
        }
    }

    // Next question preview (Zuma style)
    const nextIdx = state.questionIdx + 1;
    if (nextIdx < TOTAL_Q) {
        hudNext.textContent = `NEXT: ${state.questions[nextIdx].questionText}`;
    } else {
        hudNext.textContent = '';
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
    speak(perfect ? 'Luar biasa, sempurna sekali!' : state.correctCount >= TOTAL_Q / 2 ? 'Hebat, pertahankan terus!' : 'Ayo semangat, kamu pasti bisa!');
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

// ── Gate crash effect ────────────────────────────────────────────────────────
const debris = [];

function crashGate(gateGroup, laneIndex) {
    // Determine which gate height this lane has
    const gateHeight = gateGroup.userData.correctHeight;
    // For low/mid: break only the bar. For high: break only the wall.
    let targetBreakType;
    // Find the actual height of the collided lane
    let collidedHeight = null;
    gateGroup.traverse(child => {
        if (child.isMesh && child.userData.isGate && child.userData.laneIndex === laneIndex) {
            collidedHeight = child.userData.height;
        }
    });

    if (collidedHeight === 'high') {
        targetBreakType = 'wall';
    } else {
        targetBreakType = 'bar';
    }

    const toBreak = [];
    gateGroup.traverse(child => {
        if (child.isMesh && child.userData.breakable
            && child.userData.laneIdx === laneIndex
            && child.userData.breakType === targetBreakType) {
            toBreak.push(child);
        }
    });

    toBreak.forEach(mesh => {
        const color = mesh.material.color ? mesh.material.color.getHex() : 0x333333;
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);

        // More pieces for wall, fewer for bar
        const isWall = targetBreakType === 'wall';
        const count = isWall ? 18 : 10;
        const spreadX = isWall ? 2.0 : 2.2;
        const spreadY = isWall ? 1.2 : 0.3;

        for (let i = 0; i < count; i++) {
            // Mix of flat planks and thin splinters
            let w, h, d;
            if (Math.random() > 0.4) {
                // Flat plank shard
                w = 0.03 + Math.random() * 0.08;
                h = 0.08 + Math.random() * 0.15;
                d = 0.01 + Math.random() * 0.02;
            } else {
                // Long thin splinter
                w = 0.01 + Math.random() * 0.02;
                h = 0.1 + Math.random() * 0.25;
                d = 0.01 + Math.random() * 0.02;
            }
            const geo = new THREE.BoxGeometry(w, h, d);
            const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true });
            const piece = new THREE.Mesh(geo, mat);

            piece.position.set(
                worldPos.x + (Math.random() - 0.5) * spreadX,
                worldPos.y + (Math.random() - 0.5) * spreadY,
                worldPos.z
            );
            // Random initial rotation
            piece.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );

            // Velocity: mostly outward + up, some straight down
            const outward = (Math.random() - 0.5) * 5;
            piece.userData.vx = outward;
            piece.userData.vy = 1 + Math.random() * 6;
            piece.userData.vz = 1.5 + Math.random() * 3;
            piece.userData.rx = (Math.random() - 0.5) * 12;
            piece.userData.ry = (Math.random() - 0.5) * 8;
            piece.userData.rz = (Math.random() - 0.5) * 10;
            piece.userData.life = 1.0 + Math.random() * 0.5;

            scene.add(piece);
            debris.push(piece);
        }

        mesh.visible = false;
    });
}

function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
        const p = debris[i];
        p.userData.vy -= 12 * dt; // gravity
        p.position.x += p.userData.vx * dt;
        p.position.y += p.userData.vy * dt;
        p.position.z += p.userData.vz * dt;
        p.rotation.x += (p.userData.rx || 5) * dt;
        p.rotation.y += (p.userData.ry || 3) * dt;
        p.rotation.z += (p.userData.rz || 4) * dt;
        p.userData.life -= dt;
        p.material.opacity = Math.max(0, p.userData.life / 1.0);
        
        if (p.userData.life <= 0 || p.position.y < -2) {
            scene.remove(p);
            p.geometry.dispose();
            p.material.dispose();
            debris.splice(i, 1);
        }
    }
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

    // Hide images and glows so they don't block the camera after passing
    gateGroup.traverse(child => {
        if (child.isMesh && child.userData.isImageContent) {
            child.visible = false;
        }
    });

    if (isFullyCorrect) {
        // Correct fruit + correct action
        sfx.correct();
        state.combo++;
        state.score += 100 * state.combo;
        state.correctCount++;
        updateTier(1);
        showFeedback(true);
    } else if (isCorrectFruit && !isCorrectAction) {
        // Right fruit but wrong action — crash through gate
        sfx.wrong();
        state.combo = 0;
        state.hearts--;
        state.wrongCount++;
        updateTier(-1);
        crashGate(gateGroup, gate.userData.laneIndex);
        showFeedbackCustom('<i class="fa-solid fa-lemon"></i> Buah benar, tapi salah gaya!', 'wrong');
        updateHearts();
        triggerWrongShake();
        if (state.hearts <= 0) { endGame(false); return; }
    } else {
        // Wrong fruit — crash through gate
        sfx.wrong();
        state.combo = 0;
        state.hearts--;
        state.wrongCount++;
        updateTier(-1);
        crashGate(gateGroup, gate.userData.laneIndex);
        showFeedback(false);
        updateHearts();
        triggerWrongShake();
        if (state.hearts <= 0) { endGame(false); return; }
    }

    state.questionIdx++;
    updateHud();

    if (state.questionIdx < TOTAL_Q) {
        const q = state.questions[state.questionIdx];
        setTimeout(() => speak(q.questionText), 1000);
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
    
    if (!won || (state.correctCount < TOTAL_Q / 2 && state.wrongCount > 0)) {
        if (animations.lose) playAnim('lose', 0.2);
        else playAnim('idle', 0.2);
    } else {
        if (animations.win) playAnim('win', 0.2);
        else playAnim('idle', 0.2);
    }

    setTimeout(showResult, 2000); // 2 second delay to watch animation
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
        
        let animName = null;
        if (state.tier === 3 || state.tier === 2) {
            animName = null; // JS only jump
            state.jumpVY = 8;
        } else if (state.tier === 1) {
            animName = 'jump2';
            state.jumpVY = 8;
        } else if (state.tier === 0) {
            animName = 'jump1';
            state.jumpVY = 7.5;
        } else if (state.tier === -1 || state.tier === -2) {
            animName = 'injuredjump';
            state.jumpVY = 7;
        } else if (state.tier === -3) {
            animName = null; // crawl has no jump anim
            state.jumpVY = 5; // barely lifts
        }
        
        if (animName) playAnim(animName, 0.1);
        else playAnim(getRunAnim(), 0.1); // Continue run animation while jumping purely via JS
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

    loadingStatus.textContent = 'Memuat Item Game...';
    await loadGameModels();

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
    
    if (mixer) {
        mixer.stopAllAction();
    }
    currentAnim = null;

    // Build gate groups at regular intervals
    state.questions.forEach((q, i) => {
        // First gate has an extra 0.5 gap (longer intro run)
        const z = -((i + 1.5) * GATE_GAP);
        const g = createGateGroup(scene, q, z);
        state.gates.push(g);
        state.gateAnswered.push(false);
    });

    // Finish line
    finishLineGroup = createFinishLine(scene, FINISH_Z);

    // Spawn items
    let lastStarLane = 1;
    let starStreak = 0;

    for (let z = -20; z > FINISH_Z + 20; z -= 8) {
        // don't spawn too close to a gate
        let nearGate = false;
        for (let g of state.gates) {
            if (Math.abs(g.position.z - z) < 10) nearGate = true;
        }
        if (nearGate) continue;
        
        const r = Math.random();
        let type = null;
        
        if (z > FINISH_Z / 2) {
            // First half of the track (no books, player still learning)
            if (r < 0.03) type = 'wolf';        // 3% (sangat jarang)
            else if (r < 0.06) type = 'giraffe';// 3% (sangat jarang)
            else type = 'star';                 // 94%
        } else {
            // Second half of the track (books introduced)
            if (r < 0.03) type = 'wolf';        // 3% (sangat jarang)
            else if (r < 0.06) type = 'giraffe';// 3% (sangat jarang)
            else if (r < 0.95) type = 'star';   // 89%
            else type = 'book';                 // 5% (jarang)
        }
        
        if (type) {
            let mesh, mixer, side, lane;
            const isObstacle = (type === 'wolf' || type === 'giraffe');
            
            if (isObstacle) {
                mesh = SkeletonUtils.clone(models[type].mesh);
                mixer = new THREE.AnimationMixer(mesh);
                const clipName = type === 'wolf' ? 'Take 001' : 'run';
                const clip = models[type].animations.find(a => a.name === clipName);
                if (clip) mixer.clipAction(clip).play();
                
                side = Math.random() > 0.5 ? 1 : -1;
                // Mulai dari luar arena
                mesh.position.set(side * 10, -50, z); // Hide deep underground, start closer
                mesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
                
                state.items.push({ mesh, type, lane: 0, z, active: true, mixer, crossing: false, side });
            } else {
                mesh = models[type].clone();
                if (type === 'star') {
                    // Buat bintang mengalir (streak) di satu lane
                    if (starStreak <= 0 || Math.random() < 0.2) {
                        lastStarLane = Math.floor(Math.random() * 3);
                        starStreak = 3 + Math.floor(Math.random() * 5); // 3-7 stars
                    }
                    lane = lastStarLane;
                    starStreak--;
                } else {
                    lane = Math.floor(Math.random() * 3);
                }
                
                mesh.position.set(LANE_X[lane], 1.0, z);
                state.items.push({ mesh, type, lane, z, active: true });
            }
            scene.add(mesh);
        }
    }

    startScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    gameHud.classList.remove('hidden');
    ttsRepeat.classList.remove('hidden');

    ambienceAudio.play().catch(e => console.log('Ambience error:', e));
    state.running = true;

    // Play run animation
    setTimeout(() => {
        playAnim('run');
        updateHud();
    }, 200);
    // Speak synchronously to satisfy mobile browser policies
    speak(state.questions[0].questionText);
}

// ── Camera follow (pre-allocated vectors to avoid GC stutter) ────────────────
const _camTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
let cameraAngle = 0; // For outro orbit

function updateCamera() {
    if (state.gameTime < 2.5 && state.running) {
        // Intro sweeping camera
        const progress = state.gameTime / 2.5;
        // Ease out cubic
        const ease = 1 - Math.pow(1 - progress, 3);
        
        const startPos = new THREE.Vector3(charModel.position.x, charBaseY + 12, charModel.position.z + 18);
        const endPos = new THREE.Vector3(charModel.position.x * 0.2, charBaseY + 2.5 + state.charY * 0.3, charModel.position.z + 5);
        
        _camTarget.lerpVectors(startPos, endPos, ease);
        camera.position.copy(_camTarget);
        
        // Look ahead during the sweep
        _lookTarget.set(charModel.position.x, charBaseY + 1.2, charModel.position.z - 5);
        camera.lookAt(_lookTarget);
        return;
    }

    if (!state.running && state.finished) {
        // Outro orbiting camera (fast, stops at front)
        if (cameraAngle > -Math.PI) {
            cameraAngle -= 0.08;
            if (cameraAngle < -Math.PI) cameraAngle = -Math.PI;
        }
        const radius = 7;
        _camTarget.set(
            charModel.position.x + Math.sin(cameraAngle) * radius,
            charBaseY + 2.5,
            charModel.position.z + Math.cos(cameraAngle) * radius
        );
        camera.position.lerp(_camTarget, 0.1);
        _lookTarget.set(charModel.position.x, charBaseY + 1.5, charModel.position.z);
        camera.lookAt(_lookTarget);
        return;
    }

    // Closer camera angle
    _camTarget.set(
        charModel.position.x * 0.2,
        charBaseY + 2.5 + state.charY * 0.3,
        charModel.position.z + 5
    );
    camera.position.lerp(_camTarget, 0.1);
    _lookTarget.set(charModel.position.x, charBaseY + 1.2, charModel.position.z - 3);
    camera.lookAt(_lookTarget);
}

// ── Collision check (position-based, no bounding boxes) ─────────────────────
function checkCollisions() {
    if (!charModel) return;
    // Grace period: skip collision for first 1.5 seconds
    if (state.gameTime < 1.5) return;

    const charZ = state.charZ;
    const charLane = state.targetLane; // 0=left, 1=center, 2=right

    // Check gates
    for (let i = 0; i < state.gates.length; i++) {
        const g = state.gates[i];
        if (!state.gateAnswered[i] && Math.abs(g.position.z - charZ) < 0.8) {
            state.gateAnswered[i] = true;
            const colliders = getGateColliders(g);
            const hit = colliders.find(c => c.userData.laneIndex === charLane) || colliders[0];
            handleGateHit(hit, g);
        }
    }

    // Check items
    for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        if (!item.active) continue;
        
        // Radius collision — cek jarak 3D aktual antara karakter dan item
        const dx = item.mesh.position.x - charModel.position.x;
        const dz = item.z - charZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < 1.2) {
            let hit = true;
            if (item.type === 'wolf' && state.isJumping && state.charY > 0.5) hit = false;
            if (item.type === 'giraffe' && state.isRolling) hit = false;
            if (item.type === 'star' || item.type === 'book') hit = true; // Always collect

            if (hit) {
                item.active = false;
                item.mesh.visible = false;
                
                if (item.type === 'wolf' || item.type === 'giraffe') {
                    sfx.wrong();
                    updateTier(-1);
                    showFeedbackCustom('<i class="fa-solid fa-triangle-exclamation"></i> Awas Hewan!', 'wrong');
                    triggerWrongShake();
                } else if (item.type === 'star') {
                    sfx.click(); // Using click as coin sound
                    state.starCount++;
                    
                    if (hudStarCount) hudStarCount.textContent = `${state.starCount}/10`;
                    
                    // Flying star animation to HUD
                    const fStar = document.createElement('i');
                    fStar.className = 'fa-solid fa-star';
                    fStar.style.cssText = 'position:fixed; top:50%; left:50%; color:#ffd700; font-size:4rem; z-index:1000; transition: all 0.7s cubic-bezier(0.25, 1, 0.5, 1); transform:translate(-50%,-50%); text-shadow:0 4px 0 #b45309;';
                    document.body.appendChild(fStar);
                    
                    setTimeout(() => {
                        const rect = hudStarCount ? hudStarCount.getBoundingClientRect() : {top:20, left:window.innerWidth/2};
                        fStar.style.top = (rect.top + 10) + 'px';
                        fStar.style.left = (rect.left + 15) + 'px';
                        fStar.style.fontSize = '1.5rem';
                        fStar.style.opacity = '0.2';
                    }, 50);
                    setTimeout(() => fStar.remove(), 750);

                    if (state.starCount >= 10) {
                        state.starCount = 0;
                        if (hudStarCount) hudStarCount.textContent = `0/10`;
                        updateTier(1);
                        showFeedbackCustom('<i class="fa-solid fa-star"></i> 10 Bintang! Level Naik!', 'correct');
                        sfx.correct();
                    }
                } else if (item.type === 'book') {
                    sfx.correct();
                    updateTier(1);
                    showFeedbackCustom('<i class="fa-solid fa-book"></i> Dapat Buku! Level Naik!', 'correct');
                }
            }
        }
    }
}

function updateTier(change) {
    state.tier = THREE.MathUtils.clamp(state.tier + change, -3, 3);
    if (!state.isJumping && !state.isRolling) {
        playAnim(getRunAnim(), 0.2);
    }
}

function getSpeed() {
    switch(state.tier) {
        case 3: return RUN_SPEED * 2.5;
        case 2: return RUN_SPEED * 1.8;
        case 1: return RUN_SPEED * 1.4;
        case 0: return RUN_SPEED * 1.0;
        case -1: return RUN_SPEED * 0.6;
        case -2: return RUN_SPEED * 0.4;
        case -3: return RUN_SPEED * 0.2;
        default: return RUN_SPEED;
    }
}

function getRunAnim() {
    switch(state.tier) {
        case 3: return 'aura';
        case 2: return 'fly';
        case 1: return 'sprint';
        case 0: return 'run';
        case -1: return 'injuredrun';
        case -2: return 'zombie';
        case -3: return 'crawl';
        default: return 'run';
    }
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function gameLoop() {
    requestAnimationFrame(gameLoop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (mixer) mixer.update(dt);
    
    updateEnvironment(dt, camera.position.z);

    if (state.running && charModel) {
        state.gameTime = (state.gameTime || 0) + dt;

        // Move forward
        let currentSpeed = getSpeed();
        state.charZ -= currentSpeed * dt;
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
                playAnim(getRunAnim(), 0.15);
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
                playAnim(getRunAnim(), 0.15);
            }
        }

        // Check finish
        if (state.charZ <= FINISH_Z + 3) {
            endGame(true);
        }

        checkCollisions();

        // Jumpscare trigger based on TIME rather than fixed distance
        for (let item of state.items) {
            if (!item.active) continue;
            
            if (item.type === 'star' || item.type === 'book') {
                item.mesh.rotation.y += dt * 3;
            } else if (item.mixer) {
                item.mixer.update(dt);
                
                const distAhead = state.charZ - item.z;
                const currentSpeed = getSpeed();
                const timeToReach = distAhead / (currentSpeed || 1);
                
                // Minimal jarak 14 unit agar saat lambat tidak terlalu mendadak (kedepanin)
                const triggerDistance = Math.max(1.2 * currentSpeed, 14);

                // Muncul sebelum pemain sampai
                if (!item.crossing && distAhead > 0 && distAhead <= triggerDistance) {
                    item.crossing = true;
                    item.mesh.position.y = 0; // Muncul tiba-tiba dari bawah tanah
                    
                    // Incar jalur karakter saat ini agar wajib dihindari!
                    const targetX = LANE_X[state.targetLane];
                    const distToCross = Math.abs(item.mesh.position.x - targetX);
                    const actualTimeToReach = distAhead / (currentSpeed || 1); // Waktu asli dengan jarak trigger saat ini
                    item.crossSpeed = Math.min(Math.max(distToCross / actualTimeToReach, 8), 40);
                }
                
                if (item.crossing) {
                    const dir = item.side > 0 ? -1 : 1;
                    item.mesh.position.x += item.crossSpeed * dir * dt;
                }
            }
        }
    }

    if (charModel) {
        updateCamera();
        dirLight.position.set(charModel.position.x + 10, 20, charModel.position.z + 10);
    }

    updateDebris(dt);
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
    state.items.forEach(i => scene.remove(i.mesh));
    if (finishLineGroup) scene.remove(finishLineGroup);
    resultScreen.classList.add('hidden');
    startGame();
});
ttsRepeat.addEventListener('click', () => {
    sfx.click();
    if (state.questionIdx < TOTAL_Q) speak(state.questions[state.questionIdx].questionText);
});



// ── Kick off ─────────────────────────────────────────────────────────────────
init().catch(err => {
    console.error('Init error:', err);
    loadingStatus.textContent = 'Error loading. Check console.';
});
