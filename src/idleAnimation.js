// ---------------------------------------------------------------------------
// idleAnimation.js
// Idle animation self-driven: breathing + weight shift/sway + gerakan kepala
// halus + auto-blink acak. Dipanggil TIAP FRAME dari render loop lewat
// applyIdleAnimation(vrm, elapsedTime).
//
// Desain override: fungsi ini menulis rotasi ABSOLUT ke bone hips/chest/head
// tiap frame. Saat tracking webcam aktif nanti, cukup JANGAN panggil fungsi
// ini (atau panggil bergantian) — karena tidak akumulatif, tracking bisa
// menulis bone yang sama tanpa sisa dari idle. Bone lengan tidak disentuh di
// sini (itu urusan idlePose.js), jadi keduanya tidak bentrok.
//
// Semua sine wave pakai periode & phase offset berbeda-beda (banyak rasio
// tak-bulat) supaya hasilnya organik, tidak sinkron/robotic.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

// State auto-blink (module-level, persist antar frame).
let nextBlinkAt = 1.5; // kapan kedip berikutnya (detik, skala elapsedTime)
let blinkDur = 0.12; // durasi kedip aktif saat ini (detik)

// --- Breathing -------------------------------------------------------------
// Periode ~3.5s (napas natural). Diterapkan sebagai rotasi kecil chest/spine;
// kalau bone itu tidak ada, fallback ke naik-turun hips.
const BREATH_PERIOD = 3.5;
const BREATH_ROT = 0.035; // radian
const BREATH_POS = 0.008; // meter (fallback)

// --- Sway / weight shift ---------------------------------------------------
// Periode lebih lambat dari napas, phase beda supaya tidak sinkron.
const SWAY_Z_PERIOD = 5.5;
const SWAY_X_PERIOD = 6.5;
const SWAY_Z_AMP = 0.015; // radian
const SWAY_X_AMP = 0.008; // radian

function updateBlink(vrm, t) {
  const mgr = vrm.expressionManager;
  if (!mgr) return;

  if (t >= nextBlinkAt && t < nextBlinkAt + blinkDur) {
    // Kurva kedip: 0 → 1 → 0 halus dalam durasi blink.
    const p = (t - nextBlinkAt) / blinkDur;
    mgr.setValue('blink', Math.sin(p * Math.PI));
  } else if (t >= nextBlinkAt + blinkDur) {
    // Kedip selesai: reset & jadwalkan berikutnya dengan interval acak 2-6s,
    // durasi acak 100-150ms — biar tidak terasa robotic.
    mgr.setValue('blink', 0);
    nextBlinkAt = t + 2 + Math.random() * 4;
    blinkDur = 0.1 + Math.random() * 0.05;
  } else {
    mgr.setValue('blink', 0);
  }
}

export function applyIdleAnimation(vrm, t) {
  if (!vrm || !vrm.humanoid) return;

  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  const chest =
    vrm.humanoid.getNormalizedBoneNode('chest') ||
    vrm.humanoid.getNormalizedBoneNode('upperChest') ||
    vrm.humanoid.getNormalizedBoneNode('spine');
  const head =
    vrm.humanoid.getNormalizedBoneNode('head') ||
    vrm.humanoid.getNormalizedBoneNode('neck');

  // 1) Breathing — sine periode ~3.5s.
  const breath = Math.sin((t / BREATH_PERIOD) * TAU);
  if (chest) {
    chest.rotation.x = breath * BREATH_ROT;
  } else if (hips) {
    hips.position.y = breath * BREATH_POS;
  }

  // 2) Sway / weight shift — hips, periode lebih lambat, phase offset beda.
  if (hips) {
    hips.rotation.z = Math.sin((t / SWAY_Z_PERIOD) * TAU + 1.3) * SWAY_Z_AMP;
    hips.rotation.x = Math.sin((t / SWAY_X_PERIOD) * TAU + 2.1) * SWAY_X_AMP;
  }

  // 3) Gerakan kepala — kombinasi dua sine berperiode tak-bulat & beda fase
  //    per sumbu, supaya tidak berulang persis (organik).
  if (head) {
    head.rotation.y =
      Math.sin((t / 7.3) * TAU + 0.5) * 0.06 +
      Math.sin((t / 4.1) * TAU + 2.7) * 0.02;
    head.rotation.x =
      Math.sin((t / 11.1) * TAU + 1.9) * 0.04 +
      Math.sin((t / 5.9) * TAU + 0.8) * 0.015;
  }

  // 4) Auto-blink acak.
  updateBlink(vrm, t);
}
