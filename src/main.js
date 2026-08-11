import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { IDLE_POSE, applyPose } from './idlePose.js';
import { applyIdleAnimation } from './idleAnimation.js';
import { applyArmSway, applyTalkingGesture } from './armGesture.js';

// ---------------------------------------------------------------------------
// Scene, camera, renderer
// ---------------------------------------------------------------------------
const canvas = document.getElementById('app');

const scene = new THREE.Scene();
// Hapus background supaya transparan (alpha: true)
// scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(
  30,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  20,
);
// Sekitar tinggi dada/wajah avatar, sedikit mundur biar full body kelihatan.
camera.position.set(0, 1.3, 2.5);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
// false = jangan set inline width/height di canvas, biarkan CSS yang atur
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------------------------------------------------------------------------
// Controls — biar avatar bisa diputar-putar pakai mouse untuk testing
// ---------------------------------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0); // arahkan ke sekitar wajah
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// ---------------------------------------------------------------------------
// Lighting — ambient + directional supaya tekstur avatar jelas
// ---------------------------------------------------------------------------
const ambient = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambient);

const directional = new THREE.DirectionalLight(0xffffff, 1.5);
directional.position.set(1, 2, 1.5);
scene.add(directional);

// ---------------------------------------------------------------------------
// VRM loading
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('status');

let currentVrm = null;

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(
  '/models/avatar.vrm',
  (gltf) => {
    const vrm = gltf.userData.vrm;

    // Buang joint/geometri yang tidak terpakai — good practice dari three-vrm.
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);

    // VRM 0.x menghadap +Z (membelakangi kamera). Rotate 180° di sumbu Y
    // supaya menghadap kamera. VRM 1.0 sudah menghadap -Z; util ini
    // menyesuaikan otomatis berdasarkan versi model.
    VRMUtils.rotateVRM0(vrm);

    currentVrm = vrm;
    scene.add(vrm.scene);

    // Turunkan lengan dari T-pose ke pose rileks. Di-apply sekali; tracking
    // webcam nanti bisa menimpa rotasi bone yang sama tanpa konflik.
    applyPose(vrm, IDLE_POSE);

    // Log daftar expression yang terdeteksi dari model.
    logExpressions(vrm);

    statusEl.textContent = 'Model ter-load. Silakan uji ekspresi.';
    console.log('[VRM] Model berhasil di-load:', vrm);
  },
  (progress) => {
    if (progress.total > 0) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      statusEl.textContent = `Memuat model… ${pct}%`;
    }
  },
  (error) => {
    console.error('[VRM] Gagal memuat model:', error);
    statusEl.textContent =
      'Gagal memuat model. Pastikan public/models/avatar.vrm ada.';
  },
);

// ---------------------------------------------------------------------------
// Expression helpers
// ---------------------------------------------------------------------------
function logExpressions(vrm) {
  const manager = vrm.expressionManager;
  if (!manager) {
    console.warn('[VRM] Model tidak punya expressionManager.');
    return;
  }
  const names = manager.expressions.map((e) => e.expressionName);
  console.log('[VRM] Expression yang terdeteksi:', names);
}

// Reset semua expression ke 0 sebelum set yang baru (biar tidak menumpuk).
function resetExpressions(vrm) {
  const manager = vrm.expressionManager;
  if (!manager) return;
  for (const expr of manager.expressions) {
    manager.setValue(expr.expressionName, 0);
  }
}

function applyExpression(name) {
  if (!currentVrm || !currentVrm.expressionManager) {
    console.warn('[VRM] expressionManager belum siap.');
    return;
  }
  resetExpressions(currentVrm);

  if (name !== 'neutral') {
    // three-vrm memakai preset name: happy, sad, surprised, blink, dll.
    currentVrm.expressionManager.setValue(name, 1.0);
  }
  console.log(`[VRM] Set expression: ${name}`);
}

// Wire tombol debug.
document.querySelectorAll('#debug-panel button').forEach((btn) => {
  btn.addEventListener('click', () => applyExpression(btn.dataset.expression));
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0; // waktu terakumulasi untuk osilasi napas

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}

function animate() {
  requestAnimationFrame(animate);

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  const delta = clock.getDelta();
  elapsed += delta;

  controls.update();

  if (currentVrm) {
    // Idle animation self-driven: breathing + sway + gerakan kepala + blink.
    // Ditulis absolut tiap frame, jadi mudah di-disable/override saat webcam
    // tracking aktif (cukup berhenti memanggil applyIdleAnimation).
    applyIdleAnimation(currentVrm, elapsed);

    // Lip-sync kasar berbasis volume: companion.js menaruh sampler amplitudo
    // audio TTS di window.__waifuLipSync (0..1). Kalau tak ada audio, sampler
    // balik ~0. Nilai ini dipakai buat mulut "aa" DAN gestur lengan bicara.
    const level = window.__waifuLipSync ? window.__waifuLipSync() : 0;
    if (currentVrm.expressionManager) {
      currentVrm.expressionManager.setValue('aa', level);
    }

    // Lengan: sway idle SELALU jalan; gestur bicara ADITIF proporsional level.
    // Saat TTS diam (level≈0) gestur = 0 -> otomatis balik ke sway biasa.
    applyArmSway(currentVrm, elapsed);
    applyTalkingGesture(currentVrm, level, elapsed);

    // Penting: VRM butuh update tiap frame — meng-commit rotasi normalized ke
    // raw bone, plus spring bone. Auto-blink kita set lewat expressionManager
    // di applyIdleAnimation, lalu di-flush oleh update() ini.
    currentVrm.update(delta);
  }

  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------------------
// Resize handling (sekarang dihandle otomatis oleh resizeRendererToDisplaySize di dalam animate())
// ---------------------------------------------------------------------------
