// gates.js - Gate creation with height levels
import * as THREE from 'three';

const LANE_X = [-3, 0, 3];
const PLANT_QUESTIONS = [
    { q: "Tempat utama terjadinya fotosintesis", a: "Daun", w: ["Akar", "Bunga"] },
    { q: "Menyerap air dan mineral dari tanah", a: "Akar", w: ["Batang", "Daun"] },
    { q: "Zat hijau daun disebut", a: "Klorofil", w: ["Stomata", "Glukosa"] },
    { q: "Gas yang dihirup tumbuhan", a: "Karbon dioksida", w: ["Oksigen", "Nitrogen"] },
    { q: "Gas yang dihasilkan fotosintesis", a: "Oksigen", w: ["Karbon", "Air"] },
    { q: "Sumber energi utama fotosintesis", a: "Matahari", w: ["Angin", "Hujan"] },
    { q: "Menopang tumbuhan agar tegak", a: "Batang", w: ["Daun", "Akar"] },
    { q: "Alat perkembangbiakan tumbuhan", a: "Bunga", w: ["Batang", "Akar"] },
    { q: "Makanan hasil fotosintesis", a: "Glukosa", w: ["Garam", "Vitamin"] },
    { q: "Lubang napas di daun", a: "Stomata", w: ["Lentisel", "Akar"] }
];
const HEIGHT_LEVELS = ['low', 'mid', 'high'];

// Adjusted heights:
// LOW: bar at 0.9m → must roll
// MID: bar at 1.6m → walk through (was 3.2, halved)
// HIGH: bar at 2.8m → must jump (close to old mid ~3.0)
const HEIGHT_CONFIG = {
    low:  { imageY: 0.55, barY: 0.9,  postHeight: 0.9, imageSize: 1.6 },
    mid:  { imageY: 1.1,  barY: 1.6,  postHeight: 1.6, imageSize: 1.8 },
    high: { imageY: 2.7,  barY: 3.5,  postHeight: 3.5, imageSize: 2.0 },
};

export function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function buildQuestions() {
    return shuffle(PLANT_QUESTIONS).map(item => {
        const correct = item.a;
        const options = shuffle([correct, ...item.w]);
        const heights = shuffle([...HEIGHT_LEVELS]);
        const optionsWithHeight = options.map((answer, i) => ({
            answer,
            height: heights[i],
        }));
        const correctEntry = optionsWithHeight.find(o => o.answer === correct);
        return { 
            questionText: item.q,
            correct: correct, 
            options: optionsWithHeight, 
            correctHeight: correctEntry.height 
        };
    });
}

// Text to Canvas texture
const textureCache = {};
function getTextTexture(text) {
    if (textureCache[text]) return textureCache[text];

    const S = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');

    // Transparent background — no box
    ctx.clearRect(0, 0, S, S);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const words = text.split(' ');
    const lines = [];
    if (words.length <= 1) {
        lines.push(text);
    } else if (words.length === 2) {
        lines.push(words[0], words[1]);
    } else {
        lines.push(words.slice(0, Math.ceil(words.length / 2)).join(' '));
        lines.push(words.slice(Math.ceil(words.length / 2)).join(' '));
    }

    // Fixed large font size for all gates (uniform)
    let fontSize = 240;
    ctx.font = `bold ${fontSize}px "Lilita One", sans-serif`;

    const lineH = fontSize * 1.15;
    const totalH = lines.length * lineH;
    const startY = (S - totalH) / 2 + fontSize * 0.55;

    ctx.font = `bold ${fontSize}px "Lilita One", sans-serif`;
    lines.forEach((line, i) => {
        const ly = startY + i * lineH;
        // Thick black stroke for depth
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = fontSize * 0.22;
        ctx.strokeText(line, S / 2, ly);
        // White fill
        ctx.fillStyle = '#ffffff';
        ctx.fillText(line, S / 2, ly);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache[text] = texture;
    return texture;
}

// Cache glow textures per color (only 3 ever created)
const glowCache = {};
function createGlowTexture(hexColor) {
    if (glowCache[hexColor]) return glowCache[hexColor];

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, hexColor + 'dd');
    gradient.addColorStop(0.3, hexColor + 'aa');
    gradient.addColorStop(0.6, hexColor + '55');
    gradient.addColorStop(1, hexColor + '00');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    glowCache[hexColor] = tex;
    return tex;
}

function getGlowColor(level) {
    return '#ff1111';
}

function getBarColor(level) {
    return 0x333333;
}

export function createGateGroup(scene, question, zPos) {
    const group = new THREE.Group();
    group.position.z = zPos;
    group.userData.answered = false;
    group.userData.correct = question.correct;
    group.userData.correctHeight = question.correctHeight;

    question.options.forEach((opt, i) => {
        const x = LANE_X[i];
        const answer = opt.answer;
        const level = opt.height;
        const isCorrect = answer === question.correct;
        const hc = HEIGHT_CONFIG[level];
        const barColor = getBarColor(level);

        // Side posts — original dark style
        const postGeo = new THREE.CylinderGeometry(0.06, 0.06, hc.postHeight, 8);
        const postMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.2 });
        const left  = new THREE.Mesh(postGeo, postMat);
        const right = new THREE.Mesh(postGeo, postMat);
        left.position.set(x - 1.1, hc.postHeight / 2, 0);
        right.position.set(x + 1.1, hc.postHeight / 2, 0);
        group.add(left, right);

        // Top bar — original dark style
        const topGeo = new THREE.BoxGeometry(2.3, 0.12, 0.12);
        const topMat = new THREE.MeshStandardMaterial({
            color: 0x333333, roughness: 0.3, metalness: 0.2,
        });
        const top = new THREE.Mesh(topGeo, topMat);
        top.position.set(x, hc.barY, 0);
        top.userData.breakable = true;
        top.userData.breakType = 'bar';
        top.userData.laneIdx = i;
        group.add(top);

        // ── Inner panel (gradient glow inside the frame) ──────────────────────
        const panelW = 2.1;        // just inside the posts
        const panelH = hc.barY;   // floor to top bar
        const panelY = panelH / 2;

        const panelCanvas = document.createElement('canvas');
        panelCanvas.width = 256;
        panelCanvas.height = 512;
        const pc = panelCanvas.getContext('2d');

        // Gradient: transparent red
        const grad = pc.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0,   'rgba(200, 0, 0, 0.0)');
        grad.addColorStop(0.4, 'rgba(220, 20, 20, 0.55)');
        grad.addColorStop(1,   'rgba(180, 0, 0, 0.75)');
        pc.fillStyle = grad;
        pc.fillRect(0, 0, 256, 512);

        const panelTex = new THREE.CanvasTexture(panelCanvas);
        panelTex.colorSpace = THREE.SRGBColorSpace;

        const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
        const panelMat = new THREE.MeshBasicMaterial({
            map: panelTex,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(x, panelY, -0.05);
        panel.userData.isImageContent = true;
        group.add(panel);

        // ── Text label floating above the gate (no height limit) ──────────────────
        const textSize = 2.0;
        const imgGeo = new THREE.PlaneGeometry(textSize, textSize);
        const imgMat = new THREE.MeshBasicMaterial({
            map: getTextTexture(answer),
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const img = new THREE.Mesh(imgGeo, imgMat);
        img.position.set(x, hc.barY + 0.3, 0.02); // floating slightly above top bar
        img.userData.isImageContent = true;
        group.add(img);


        // (Action icon removed to declutter interface)

        // Solid wall for high gates — visual cue to jump
        if (level === 'high') {
            const wallHeight = 1.3;
            const wallGeo = new THREE.BoxGeometry(2.2, wallHeight, 0.1);
            const wallMat = new THREE.MeshStandardMaterial({
                color: 0x222222,
                roughness: 0.7,
            });
            const wall = new THREE.Mesh(wallGeo, wallMat);
            wall.position.set(x, wallHeight / 2, 0);
            wall.userData.breakable = true;
            wall.userData.breakType = 'wall';
            wall.userData.laneIdx = i;
            group.add(wall);
        }

        // Invisible collider
        const colGeo = new THREE.BoxGeometry(1.9, 4, 1.0);
        const colMat = new THREE.MeshBasicMaterial({ visible: false });
        const collider = new THREE.Mesh(colGeo, colMat);
        collider.position.set(x, 2, 0);
        collider.userData.isGate = true;
        collider.userData.fruit = answer;
        collider.userData.isCorrect = isCorrect;
        collider.userData.laneIndex = i;
        collider.userData.height = level;
        group.add(collider);
    });

    scene.add(group);
    return group;
}

export function createFinishLine(scene, zPos) {
    const group = new THREE.Group();
    group.position.z = zPos;

    // Posts
    const postGeo = new THREE.CylinderGeometry(0.2, 0.2, 7, 8);
    const postMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    [-5, 5].forEach(x => {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, 3.5, 0);
        group.add(post);
    });

    // Top bar
    const top = new THREE.Mesh(
        new THREE.BoxGeometry(10.4, 0.4, 0.4),
        postMat
    );
    top.position.set(0, 7, 0);
    group.add(top);

    // FINISH banner
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff1111';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', 256, 48);
    const bannerTex = new THREE.CanvasTexture(c);
    const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 1.2),
        new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
    );
    banner.position.set(0, 6.2, 0);
    group.add(banner);

    // Checkered ground
    const cc = document.createElement('canvas');
    cc.width = 128; cc.height = 16;
    const cctx = cc.getContext('2d');
    for (let cx = 0; cx < 128; cx += 8) {
        for (let cy = 0; cy < 16; cy += 8) {
            cctx.fillStyle = ((cx / 8 + cy / 8) % 2 === 0) ? '#fff' : '#222';
            cctx.fillRect(cx, cy, 8, 8);
        }
    }
    const checkerMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 2),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cc) })
    );
    checkerMesh.rotation.x = -Math.PI / 2;
    checkerMesh.position.set(0, 0.03, 0);
    group.add(checkerMesh);

    scene.add(group);
    return group;
}

export function getGateColliders(gateGroup) {
    const colliders = [];
    gateGroup.traverse(child => {
        if (child.userData.isGate) colliders.push(child);
    });
    return colliders;
}
