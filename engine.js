// engine.js - Core 3D engine with CSS-style environment
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();

export function createEngine(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a3e52); // Match fog color exactly
    scene.fog = new THREE.Fog(0x2a3e52, 10, 120); // Linear fog hides horizon completely

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 1, 0);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Moody lighting with warm directional glow
    const ambientLight = new THREE.AmbientLight(0x213343, 1.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffb74d, 1.5); // Warm orange glow
    dirLight.position.set(0, 5, -100); // Coming from distance
    scene.add(dirLight);

    return { renderer, scene, camera, dirLight };
}

export async function loadCharacter(scene, onProgress) {
    return new Promise((resolve, reject) => {
        gltfLoader.load('3D/siswa.glb', (gltf) => {
            const model = gltf.scene;

            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const scaleFactor = 1.5 / (size.y || 1);
            model.scale.set(scaleFactor, scaleFactor, scaleFactor);
            box.setFromObject(model);
            model.position.y = -box.min.y;

            model.traverse(c => { 
                if (c.isMesh) { 
                    c.castShadow = false; 
                    c.receiveShadow = false; 
                    if (c.material) {
                        // Make character ignore environment lighting (self-illuminating)
                        if (c.material.color) c.material.emissive.copy(c.material.color);
                        if (c.material.map) c.material.emissiveMap = c.material.map;
                        c.material.emissiveIntensity = 1.0;
                    }
                } 
            });
            scene.add(model);

            const mixer = new THREE.AnimationMixer(model);
            const animations = {};

            console.log('Animations:', gltf.animations.map(a => a.name));

            gltf.animations.forEach(clip => {
                const n = clip.name.toLowerCase();
                if (n.includes('aura')) animations.aura = mixer.clipAction(clip);
                else if (n.includes('fly')) animations.fly = mixer.clipAction(clip);
                else if (n.includes('sprint')) animations.sprint = mixer.clipAction(clip);
                else if (n.includes('injuredrun')) animations.injuredrun = mixer.clipAction(clip);
                else if (n.includes('zombie')) animations.zombie = mixer.clipAction(clip);
                else if (n.includes('crawl')) animations.crawl = mixer.clipAction(clip);
                else if (n.includes('jump2')) animations.jump2 = mixer.clipAction(clip);
                else if (n.includes('jump1')) animations.jump1 = mixer.clipAction(clip);
                else if (n.includes('injuredjump')) animations.injuredjump = mixer.clipAction(clip);
                else if (n.includes('roll') || n.includes('slide')) animations.roll = mixer.clipAction(clip);
                else if (n.includes('idle')) animations.idle = mixer.clipAction(clip);
                else if (n.includes('win') || n.includes('victory') || n.includes('celebrate') || n.includes('menang')) animations.win = mixer.clipAction(clip);
                else if (n.includes('lose') || n.includes('defeat') || n.includes('sad') || n.includes('kalah')) animations.lose = mixer.clipAction(clip);
                else if (n === 'run' || n === 'jog') animations.run = mixer.clipAction(clip);
                else if (n === 'jump') animations.jump1 = mixer.clipAction(clip); // fallback
            });

            // Fallbacks if some aren't perfectly named
            if (!animations.run) animations.run = animations.sprint || animations.idle;
            if (!animations.jump1) animations.jump1 = animations.jump2 || animations.roll;

            if (!animations.run && gltf.animations.length > 0) animations.run = mixer.clipAction(gltf.animations[0]);
            if (!animations.jump && gltf.animations.length > 1) animations.jump = mixer.clipAction(gltf.animations[1]);
            if (!animations.roll && gltf.animations.length > 2) animations.roll = mixer.clipAction(gltf.animations[2]);

            // Smooth looping for movement anims
            [animations.run, animations.sprint, animations.injuredrun, animations.aura, animations.fly, animations.zombie, animations.crawl].forEach(a => {
                if (a) {
                    a.setLoop(THREE.LoopRepeat);
                    a.clampWhenFinished = false;
                }
            });
            // One-shot for actions
            [animations.jump1, animations.jump2, animations.injuredjump, animations.roll, animations.win, animations.lose].forEach(a => {
                if (a) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
            });

            resolve({ model, mixer, animations });
        }, (xhr) => {
            if (onProgress && xhr.total) onProgress(xhr.loaded / xhr.total);
        }, reject);
    });
}

export function createTrack(scene) {
    // Huge dark ground to hide edges
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1500, 2400),
        new THREE.MeshBasicMaterial({ color: 0x06090e })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.1, -1100);
    scene.add(ground);

    // Road with smooth gradient edges, no light streaks
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.clearRect(0,0,1024,1024); // Transparent base
    
    // Gradient edges to blend smoothly into ground
    const grad = ctx.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, 'rgba(26, 39, 52, 0)'); // #1a2734 fade
    grad.addColorStop(0.15, 'rgba(26, 39, 52, 1)');
    grad.addColorStop(0.85, 'rgba(26, 39, 52, 1)');
    grad.addColorStop(1, 'rgba(26, 39, 52, 0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,1024,1024);

    // Grass effect edges (tiled sine noise) - high res
    ctx.fillStyle = '#06090e'; // ground color
    for(let y = 0; y < 1024; y += 16) {
        let theta = (y / 1024) * Math.PI * 2;
        // Generate pseudo-random organic lengths
        let n1 = Math.sin(theta * 5) * 40 + Math.cos(theta * 13) * 20 + Math.sin(theta * 21) * 10;
        let n2 = Math.cos(theta * 4) * 40 + Math.sin(theta * 11) * 20 + Math.cos(theta * 17) * 10;
        
        // Left side grass spikes
        ctx.beginPath();
        ctx.moveTo(0, y - 8);
        ctx.lineTo(100 + n1, y + 8);
        ctx.lineTo(0, y + 24);
        ctx.fill();

        // Right side grass spikes
        ctx.beginPath();
        ctx.moveTo(1024, y - 8);
        ctx.lineTo(924 - n2, y + 8);
        ctx.lineTo(1024, y + 24);
        ctx.fill();
    }
    
    const roadTex = new THREE.CanvasTexture(c);
    roadTex.colorSpace = THREE.SRGBColorSpace;
    roadTex.anisotropy = 16; // Fixes blur/pixelation on extreme angles
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.repeat.set(1, 4);

    const road = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 2400),
        new THREE.MeshBasicMaterial({ map: roadTex, transparent: true, depthWrite: false })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, -1100);
    scene.add(road);

    // ── Tall Silhouette Trees ──
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.9, 30.0, 5);
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x06090d }); // pure dark silhouette
    const coneGeo = new THREE.ConeGeometry(2.5, 12.0, 5);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0x06090d }); // dark canopy

    const treePos = [];
    for (let z = 20; z > -2300; z -= 3) {
        // Very dense random placements to form a forest wall
        treePos.push([-7 - Math.random() * 30, z]);
        treePos.push([7 + Math.random() * 30, z]);
    }

    const count = treePos.length;
    const trunks  = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const canopies = new THREE.InstancedMesh(coneGeo, coneMat, count);
    const td = new THREE.Object3D();

    treePos.forEach(([x, z], i) => {
        const s = 0.8 + Math.random() * 1.5;

        // Trunk
        td.position.set(x, 12.5 * s, z);
        td.scale.set(s, s, s);
        td.rotation.set(0, Math.random() * Math.PI, 0);
        td.updateMatrix();
        trunks.setMatrixAt(i, td.matrix);

        // Canopy top
        td.position.set(x, 20.0 * s, z);
        td.scale.set(s, s, s);
        td.updateMatrix();
        canopies.setMatrixAt(i, td.matrix);
    });

    scene.add(trunks);
    scene.add(canopies);

    // ── Rain Effect ──
    const rainCount = 1000;
    const rainGeo = new THREE.BufferGeometry();
    const rainDrops = new Float32Array(rainCount * 6);
    for (let i = 0; i < rainCount * 6; i+=6) {
        let x = Math.random() * 40 - 20;
        let y = Math.random() * 30;
        let z = Math.random() * 40 - 20;
        
        // Top vertex
        rainDrops[i] = x;
        rainDrops[i+1] = y + 1.5; // Drop length
        rainDrops[i+2] = z;
        
        // Bottom vertex
        rainDrops[i+3] = x;
        rainDrops[i+4] = y;
        rainDrops[i+5] = z;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainDrops, 3));
    const rainMat = new THREE.LineBasicMaterial({
        color: 0x8899aa,
        transparent: true,
        opacity: 0.3
    });
    rainParticles = new THREE.LineSegments(rainGeo, rainMat);
    scene.add(rainParticles);
}

let rainParticles = null;

export function updateEnvironment(dt, cameraZ) {
    if (rainParticles) {
        rainParticles.position.z = cameraZ - 10; // keep rain centered ahead of camera
        const positions = rainParticles.geometry.attributes.position.array;
        
        for (let i = 1; i < positions.length; i += 6) {
            let dy = 50 * dt; // fall speed
            
            // Move both top and bottom Y
            positions[i] -= dy; 
            positions[i+3] -= dy; 
            
            // If bottom hits 0, reset
            if (positions[i+3] < 0) {
                positions[i] = 30 + 1.5; // reset top Y
                positions[i+3] = 30; // reset bottom Y
                
                // Randomize X and Z slightly on reset
                let nx = Math.random() * 40 - 20;
                let nz = Math.random() * 40 - 20;
                positions[i-1] = nx; positions[i+2] = nx; // X
                positions[i+1] = nz; positions[i+4] = nz; // Z
            }
        }
        rainParticles.geometry.attributes.position.needsUpdate = true;
    }
}

