// ---------------------------------------------------------------------------
// armGesture.js
// Dua lapis gerakan lengan, dipanggil tiap frame di render loop (pola sama
// seperti applyIdleAnimation):
//
//   1) applyArmSway(vrm, t)             — ayun idle halus, SELALU jalan.
//   2) applyTalkingGesture(vrm, amp, t) — gestur bicara, ADITIF di atas sway,
//      proporsional amplitudo audio TTS (0..1, dari sampler lip-sync).
//
// applyArmSway menulis rotasi ABSOLUT (base IDLE_POSE + sway). applyTalkingGesture
// MENAMBAH di atasnya (rotation.x += ...). Urutan panggil: sway dulu, lalu
// talking. Karena talking proporsional amplitudo, saat TTS diam (amp≈0) ia tak
// menambah apa-apa -> otomatis balik ke sway biasa. Itu "state yang sama dengan
// lip-sync": amplitudo audio yang lagi diputar.
//
// Keduanya cuma menyentuh bone lengan — tak bentrok dg idleAnimation (hips/
// chest/head) maupun idlePose (yg cuma set sekali saat load).
//
// Periode sway sengaja beda & tak-bulat vs breathing/sway badan (3.5/5.5/6.5s)
// dan head (7.3/4.1/11.1/5.9s) biar tak sinkron; kiri & kanan beda periode +
// fase biar tak simetris/robotik.
//
// ponytail: sumbu/tanda rotasi tergantung rig model (lihat catatan idlePose.js).
// Kalau arah gerak kebalik/aneh, balik tanda konstanta TALK_* / SWAY_* di bawah
// — bukan tulis ulang.
// ---------------------------------------------------------------------------
import { IDLE_POSE } from './idlePose.js';

const TAU = Math.PI * 2;

// Base pose lengan (radian) dari IDLE_POSE; sumbu yg tak diset di IDLE_POSE = 0.
const base = (bone, axis) => IDLE_POSE[bone]?.[axis] ?? 0;

// --- Idle sway (selalu) ------------------------------------------------------
const SWAY_UP_Z = 0.04; // ayun utama upper arm (~2.3°)
const SWAY_UP_X = 0.02; // drift maju-mundur upper arm (~1.1°)
const SWAY_LO_Y = 0.03; // ayun lower arm/siku (~1.7°)
const P_L = 4.7; // periode kiri (s) — beda dari badan & dari kanan
const P_R = 6.1; // periode kanan (s)
const P_X_L = 8.3;
const P_X_R = 7.1;
const PHASE_R = 1.7; // fase kanan digeser -> tak cermin dg kiri

export function applyArmSway(vrm, t) {
  if (!vrm || !vrm.humanoid) return;
  const g = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const lu = g('leftUpperArm');
  const ru = g('rightUpperArm');
  const ll = g('leftLowerArm');
  const rl = g('rightLowerArm');

  const zL = Math.sin((t / P_L) * TAU);
  const zR = Math.sin((t / P_R) * TAU + PHASE_R);
  const xL = Math.sin((t / P_X_L) * TAU + 0.9);
  const xR = Math.sin((t / P_X_R) * TAU + 2.4);

  if (lu) {
    lu.rotation.set(base('leftUpperArm', 'x') + xL * SWAY_UP_X, base('leftUpperArm', 'y'), base('leftUpperArm', 'z') + zL * SWAY_UP_Z);
  }
  if (ru) {
    ru.rotation.set(base('rightUpperArm', 'x') + xR * SWAY_UP_X, base('rightUpperArm', 'y'), base('rightUpperArm', 'z') + zR * SWAY_UP_Z);
  }
  if (ll) {
    ll.rotation.set(base('leftLowerArm', 'x'), base('leftLowerArm', 'y') + zL * SWAY_LO_Y, base('leftLowerArm', 'z'));
  }
  if (rl) {
    rl.rotation.set(base('rightLowerArm', 'x'), base('rightLowerArm', 'y') + zR * SWAY_LO_Y, base('rightLowerArm', 'z'));
  }
}

// --- Talking gesture (aditif, saat TTS bicara) -------------------------------
// amplitude 0..1 dari sampler lip-sync. Di-clamp ke AMP_CAP dulu biar volume
// tiba-tiba keras tak bikin lengan ekstrem, lalu dinormalisasi 0..1. Dicampur
// sine ritme biar gerak ikut irama bicara, bukan cuma "dorong" statis.
const AMP_CAP = 0.6; // amplitudo >= ini dianggap = max (clamp req 5)
const TALK_UP_MAX = 0.06; // rotasi maks tambahan upper arm (~3.4°)
const TALK_LO_MAX = 0.16; // rotasi maks tambahan lower arm/siku (~9°) — gestur utama

export function applyTalkingGesture(vrm, amplitude, t) {
  if (!vrm || !vrm.humanoid) return;
  const amp = Math.min(Math.max(amplitude, 0), AMP_CAP) / AMP_CAP; // 0..1 ter-clamp
  if (amp <= 0.001) return; // TTS diam -> jangan tambah apa-apa (balik ke sway)

  const g = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const lu = g('leftUpperArm');
  const ru = g('rightUpperArm');
  const ll = g('leftLowerArm');
  const rl = g('rightLowerArm');

  // Ritme per sisi: freq/fase beda -> gerak halus tak seragam. Range 0.2..1.0
  // (selalu positif) jadi siku menekuk ke arah gestur, magnitudo berdenyut.
  const rL = 0.6 + 0.4 * Math.sin(t * 6.5);
  const rR = 0.6 + 0.4 * Math.sin(t * 5.3 + 1.1);

  // ADITIF di atas sway. Siku (lower arm) = gestur utama; upper arm sedikit.
  if (lu) lu.rotation.x += amp * TALK_UP_MAX * rL;
  if (ru) ru.rotation.x += amp * TALK_UP_MAX * rR;
  if (ll) ll.rotation.x -= amp * TALK_LO_MAX * rL; // tekuk siku ke depan
  if (rl) rl.rotation.x -= amp * TALK_LO_MAX * rR;
}

// --- self-check (node saja; aman di browser via guard typeof process) --------
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('armGesture.js')) {
  const assert = (c, m) => {
    if (!c) throw new Error('FAIL: ' + m);
  };
  const mk = () => ({ rotation: { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } } });
  const N = { leftUpperArm: mk(), rightUpperArm: mk(), leftLowerArm: mk(), rightLowerArm: mk() };
  const vrm = { humanoid: { getNormalizedBoneNode: (n) => N[n] } };
  const BASE_LU_Z = (72 * Math.PI) / 180;

  // sway berubah terhadap waktu, dan berpusat di base IDLE_POSE
  applyArmSway(vrm, 0);
  const z0 = N.leftUpperArm.rotation.z;
  applyArmSway(vrm, 1.3);
  assert(N.leftUpperArm.rotation.z !== z0, 'sway harus berubah tiap waktu');
  assert(Math.abs(N.leftUpperArm.rotation.z - BASE_LU_Z) <= SWAY_UP_Z + 1e-9, 'sway di sekitar base IDLE_POSE');

  // amp 0 -> talking tak menambah apa-apa
  applyArmSway(vrm, 2.0);
  const before = N.leftLowerArm.rotation.x;
  applyTalkingGesture(vrm, 0, 2.0);
  assert(N.leftLowerArm.rotation.x === before, 'amp 0 tak menambah apa-apa');

  // amplitudo "meledak" -> delta ter-clamp <= TALK_LO_MAX
  applyArmSway(vrm, 3.0);
  const b2 = N.leftLowerArm.rotation.x;
  applyTalkingGesture(vrm, 999, 3.0);
  assert(Math.abs(N.leftLowerArm.rotation.x - b2) <= TALK_LO_MAX + 1e-9, 'rotasi talking ter-clamp <= TALK_LO_MAX');

  console.log('armGesture self-check OK');
}
