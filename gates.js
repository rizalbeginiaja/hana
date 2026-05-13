// gates.js - Gate creation with height levels
import * as THREE from 'three';

const LANE_X = [-3, 0, 3];
const FRUITS = ['apple','avocado','banana','cherry','coconut','grape','mango','strawberry','tomato','watermelon'];
const HEIGHT_LEVELS = ['low', 'mid', 'high'];

// Adjusted heights:
// LOW: bar at 0.9m → must roll
// MID: bar at 1.6m → walk through (was 3.2, halved)
// HIGH: bar at 2.8m → must jump (close to old mid ~3.0)
const HEIGHT_CONFIG = {
    low:  { imageY: 0.55, barY: 0.9,  postHeight: 0.9, imageSize: 0.8 },
    mid:  { imageY: 1.1,  barY: 1.6,  postHeight: 1.6, imageSize: 1.0 },
    high: { imageY: 2.7,  barY: 3.5,  postHeight: 3.5, imageSize: 1.1 },
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
    return shuffle(FRUITS).map(correct => {
        const wrongs = shuffle(FRUITS.filter(f => f !== correct)).slice(0, 2);
        const options = shuffle([correct, ...wrongs]);
        const heights = shuffle([...HEIGHT_LEVELS]);
        const optionsWithHeight = options.map((fruit, i) => ({
            fruit,
            height: heights[i],
        }));
        const correctEntry = optionsWithHeight.find(o => o.fruit === correct);
        return { correct, options: optionsWithHeight, correctHeight: correctEntry.height };
    });
}

// SVG to Canvas texture
const textureCache = {};
function getFruitTexture(name) {
    if (textureCache[name]) return textureCache[name];

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache[name] = texture;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        ctx.clearRect(0, 0, 256, 256);
        const s = Math.min(256 / img.width, 256 / img.height) * 0.9;
        const w = img.width * s;
        const h = img.height * s;
        ctx.drawImage(img, (256 - w) / 2, (256 - h) / 2, w, h);
        texture.needsUpdate = true;
    };
    img.onerror = () => {
        ctx.fillStyle = '#333';
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 128, 128);
        texture.needsUpdate = true;
    };
    img.src = `img/${name}.svg`;
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
    switch (level) {
        case 'low':  return '#3b82f6';
        case 'mid':  return '#22c55e';
        case 'high': return '#f59e0b';
    }
}

function getBarColor(level) {
    switch (level) {
        case 'low':  return 0x3b82f6;
        case 'mid':  return 0x22c55e;
        case 'high': return 0xf59e0b;
    }
}

export function createGateGroup(scene, question, zPos) {
    const group = new THREE.Group();
    group.position.z = zPos;
    group.userData.answered = false;
    group.userData.correct = question.correct;
    group.userData.correctHeight = question.correctHeight;

    question.options.forEach((opt, i) => {
        const x = LANE_X[i];
        const fruit = opt.fruit;
        const level = opt.height;
        const isCorrect = fruit === question.correct;
        const hc = HEIGHT_CONFIG[level];
        const barColor = getBarColor(level);

        // Side posts
        const postGeo = new THREE.CylinderGeometry(0.06, 0.06, hc.postHeight, 8);
        const postMat = new THREE.MeshStandardMaterial({ color: barColor, roughness: 0.4, metalness: 0.2 });
        const left  = new THREE.Mesh(postGeo, postMat);
        const right = new THREE.Mesh(postGeo, postMat);
        left.position.set(x - 1.1, hc.postHeight / 2, 0);
        right.position.set(x + 1.1, hc.postHeight / 2, 0);
        group.add(left, right);

        // Top bar
        const topGeo = new THREE.BoxGeometry(2.3, 0.12, 0.12);
        const topMat = new THREE.MeshStandardMaterial({
            color: barColor, roughness: 0.3, metalness: 0.2,
            emissive: barColor, emissiveIntensity: 0.3,
        });
        const top = new THREE.Mesh(topGeo, topMat);
        top.position.set(x, hc.barY, 0);
        group.add(top);

        // Glow behind fruit (stronger opacity)
        const glowSize = hc.imageSize * 2.0;
        const glowGeo = new THREE.PlaneGeometry(glowSize, glowSize);
        const glowMat = new THREE.MeshBasicMaterial({
            map: createGlowTexture(getGlowColor(level)),
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(x, hc.imageY, -0.05);
        group.add(glow);

        // Fruit image (floating)
        const imgGeo = new THREE.PlaneGeometry(hc.imageSize, hc.imageSize);
        const imgMat = new THREE.MeshBasicMaterial({
            map: getFruitTexture(fruit),
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const img = new THREE.Mesh(imgGeo, imgMat);
        img.position.set(x, hc.imageY, 0.01);
        group.add(img);

        // Action icon below fruit
        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 64;
        iconCanvas.height = 64;
        const ictx = iconCanvas.getContext('2d');
        ictx.font = 'bold 40px Arial';
        ictx.textAlign = 'center';
        ictx.textBaseline = 'middle';
        ictx.fillStyle = getGlowColor(level);
        ictx.fillText(level === 'low' ? '⬇' : level === 'mid' ? '➡' : '⬆', 32, 32);
        const iconTex = new THREE.CanvasTexture(iconCanvas);
        const iconMat = new THREE.MeshBasicMaterial({ map: iconTex, transparent: true, side: THREE.DoubleSide });
        const iconMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), iconMat);
        iconMesh.position.set(x, hc.imageY - hc.imageSize * 0.65, 0.02);
        group.add(iconMesh);

        // Invisible collider
        const colGeo = new THREE.BoxGeometry(1.9, 4, 1.0);
        const colMat = new THREE.MeshBasicMaterial({ visible: false });
        const collider = new THREE.Mesh(colGeo, colMat);
        collider.position.set(x, 2, 0);
        collider.userData.isGate = true;
        collider.userData.fruit = fruit;
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
    const postMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
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
    ctx.fillStyle = '#7c3aed';
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
