// engine.js - Core 3D engine with CSS-style environment
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();

// Create sky gradient + clouds as scene background
function createSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Sky gradient: #1d77fa (top) → #9bd3e7 (bottom)
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1d77fa');
    grad.addColorStop(0.6, '#6db8ec');
    grad.addColorStop(1, '#9bd3e7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Draw clouds with purple shadows
    function drawCloud(cx, cy, w, h) {
        // Purple shadow
        ctx.fillStyle = 'rgba(180, 160, 220, 0.5)';
        drawCloudShape(ctx, cx + 3, cy + 6, w, h);
        // White top
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        drawCloudShape(ctx, cx, cy, w, h);
    }

    function drawCloudShape(ctx, cx, cy, w, h) {
        ctx.beginPath();
        // Multiple overlapping ellipses for fluffy look
        ctx.ellipse(cx, cy, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx - w * 0.3, cy + h * 0.1, w * 0.35, h * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + w * 0.3, cy + h * 0.05, w * 0.4, h * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx - w * 0.15, cy - h * 0.15, w * 0.3, h * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + w * 0.15, cy - h * 0.2, w * 0.25, h * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Several cloud clusters
    drawCloud(80, 140, 100, 50);
    drawCloud(250, 100, 70, 35);
    drawCloud(420, 130, 110, 55);
    drawCloud(150, 200, 60, 30);
    drawCloud(380, 190, 80, 40);
    drawCloud(50, 260, 90, 45);
    drawCloud(460, 250, 75, 38);

    // Large clouds at sides (like the reference)
    // Left big cloud
    ctx.fillStyle = 'rgba(180, 155, 215, 0.6)';
    drawCloudShape(ctx, 35, 340, 130, 80);
    ctx.fillStyle = 'rgba(240, 235, 255, 0.85)';
    drawCloudShape(ctx, 30, 330, 130, 80);

    // Right big cloud
    ctx.fillStyle = 'rgba(180, 155, 215, 0.6)';
    drawCloudShape(ctx, 480, 310, 120, 75);
    ctx.fillStyle = 'rgba(240, 235, 255, 0.85)';
    drawCloudShape(ctx, 475, 300, 120, 75);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function createEngine(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = createSkyTexture();

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 1, 0);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Flat lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
    scene.add(ambientLight);
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight.position.set(5, 15, 8);
    scene.add(dirLight);

    return { renderer, scene, camera, dirLight };
}

export async function loadCharacter(scene, onProgress) {
    return new Promise((resolve, reject) => {
        gltfLoader.load('3D/girl.glb', (gltf) => {
            const model = gltf.scene;

            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const scaleFactor = 1.5 / (size.y || 1);
            model.scale.set(scaleFactor, scaleFactor, scaleFactor);
            box.setFromObject(model);
            model.position.y = -box.min.y;

            model.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
            scene.add(model);

            const mixer = new THREE.AnimationMixer(model);
            const animations = {};

            console.log('Animations:', gltf.animations.map(a => a.name));

            gltf.animations.forEach(clip => {
                const n = clip.name.toLowerCase();
                if (!animations.run && (n.includes('run') || n.includes('jog'))) animations.run = mixer.clipAction(clip);
                else if (!animations.jump && n.includes('jump')) animations.jump = mixer.clipAction(clip);
                else if (!animations.roll && (n.includes('roll') || n.includes('slide'))) animations.roll = mixer.clipAction(clip);
                else if (!animations.idle && n.includes('idle')) animations.idle = mixer.clipAction(clip);
            });

            if (!animations.run && gltf.animations.length > 0) animations.run = mixer.clipAction(gltf.animations[0]);
            if (!animations.jump && gltf.animations.length > 1) animations.jump = mixer.clipAction(gltf.animations[1]);
            if (!animations.roll && gltf.animations.length > 2) animations.roll = mixer.clipAction(gltf.animations[2]);

            // Smooth looping for run
            if (animations.run) {
                animations.run.setLoop(THREE.LoopRepeat);
                animations.run.clampWhenFinished = false;
            }
            // One-shot for jump/roll
            [animations.jump, animations.roll].forEach(a => {
                if (a) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
            });

            resolve({ model, mixer, animations });
        }, (xhr) => {
            if (onProgress && xhr.total) onProgress(xhr.loaded / xhr.total);
        }, reject);
    });
}

export function createTrack(scene) {
    // Solid green grass (#8fc300)
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 600),
        new THREE.MeshBasicMaterial({ color: 0x8fc300 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -250);
    scene.add(ground);

    // Gray road
    const road = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 600),
        new THREE.MeshBasicMaterial({ color: 0x666666 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, -250);
    scene.add(road);

    // Lane markings — single InstancedMesh
    const markGeo = new THREE.PlaneGeometry(0.15, 2.5);
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const marks = [];
    for (let z = 0; z > -550; z -= 8) { marks.push([-1.8, z], [1.8, z]); }
    const markMesh = new THREE.InstancedMesh(markGeo, markMat, marks.length);
    const d = new THREE.Object3D();
    marks.forEach(([x, z], i) => {
        d.position.set(x, 0.02, z);
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.updateMatrix();
        markMesh.setMatrixAt(i, d.matrix);
    });
    scene.add(markMesh);

    // ── Trees: trunk + branch + 2 leaf spheres ──
    // Shared geometry & materials
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 2.0, 6);
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x7a5c30 });
    const branchGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.8, 5);
    const branchMat = new THREE.MeshBasicMaterial({ color: 0x8B6914 });
    const leafGeo = new THREE.SphereGeometry(0.8, 8, 6);
    const leafMat = new THREE.MeshBasicMaterial({ color: 0x2dba1e });
    const leafMat2 = new THREE.MeshBasicMaterial({ color: 0x3ed630 });

    const treePos = [];
    for (let z = -8; z > -530; z -= 18) {
        treePos.push([-7.5 + (Math.random() - 0.5) * 2, z]);
        treePos.push([7.5 + (Math.random() - 0.5) * 2, z]);
    }

    // 4 InstancedMeshes: trunk, branch, leaf1, leaf2
    const count = treePos.length;
    const trunks  = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const branches = new THREE.InstancedMesh(branchGeo, branchMat, count);
    const leaf1s  = new THREE.InstancedMesh(leafGeo, leafMat, count);
    const leaf2s  = new THREE.InstancedMesh(leafGeo, leafMat2, count);
    const td = new THREE.Object3D();

    treePos.forEach(([x, z], i) => {
        const s = 0.7 + Math.random() * 0.5;
        const dir = Math.random() > 0.5 ? 1 : -1; // Branch goes left or right

        // Main trunk
        td.position.set(x, 1.0 * s, z);
        td.scale.set(s, s, s);
        td.rotation.set(0, 0, 0);
        td.updateMatrix();
        trunks.setMatrixAt(i, td.matrix);

        // Branch (angled off trunk)
        td.position.set(x + dir * 0.25 * s, 1.4 * s, z);
        td.rotation.set(0, 0, -dir * 0.6); // Angle outwards
        td.updateMatrix();
        branches.setMatrixAt(i, td.matrix);

        // Leaf cluster 1 (top of trunk)
        td.position.set(x, 2.2 * s, z);
        td.rotation.set(0, 0, 0);
        td.scale.set(s * 1.0, s * 0.9, s * 1.0);
        td.updateMatrix();
        leaf1s.setMatrixAt(i, td.matrix);

        // Leaf cluster 2 (end of branch)
        td.position.set(x + dir * 0.5 * s, 1.8 * s, z);
        td.scale.set(s * 0.65, s * 0.6, s * 0.65);
        td.updateMatrix();
        leaf2s.setMatrixAt(i, td.matrix);
    });

    scene.add(trunks);
    scene.add(branches);
    scene.add(leaf1s);
    scene.add(leaf2s);
}

