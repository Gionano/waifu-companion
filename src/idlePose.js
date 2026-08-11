// ---------------------------------------------------------------------------
// idlePose.js
// Pose default (idle) untuk avatar VRM, dipisah dari main.js supaya gampang
// di-override oleh tracking webcam di tahap berikutnya. Kode tracking cukup
// menulis rotasi ke bone yang sama (lewat getNormalizedBoneNode) — karena
// idle pose hanya di-apply SEKALI saat load, tracking bisa menimpanya tanpa
// konflik. Breathing (napas) jalan di scene root (vrm.scene.position.y), BUKAN
// di bone hips — jadi semua bone humanoid, termasuk hips, bebas dikontrol
// tracking tanpa bentrok dengan napas.
// ---------------------------------------------------------------------------

const deg = (d) => (d * Math.PI) / 180;

// Rotasi lokal tiap bone humanoid (radian). Sumbu mengikuti normalized bone
// space three-vrm. Nilai z pada upper arm = seberapa jauh lengan turun dari
// T-pose. ~72° memberi lengan rileks di samping badan.
//
// CATATAN: kalau lengan malah terangkat ke atas / menyilang, balik tanda (+/-)
// pada nilai z upper arm — arah putaran tergantung rig model.
export const IDLE_POSE = {
  leftUpperArm: { z: deg(72) },
  rightUpperArm: { z: deg(-72) },
  // Sedikit tekuk siku supaya tidak kaku lurus.
  leftLowerArm: { y: deg(-12), z: deg(6) },
  rightLowerArm: { y: deg(12), z: deg(-6) },
};

// Parameter animasi napas kini hidup di idleAnimation.js (self-driven per
// frame), jadi tidak ada konstanta breathing di sini lagi.

// Terapkan sekumpulan rotasi bone ke VRM. `pose` = object { boneName: {x,y,z} }.
// Dipakai untuk idle pose sekarang, dan bisa dipakai ulang oleh layer tracking.
export function applyPose(vrm, pose) {
  if (!vrm || !vrm.humanoid) return;
  for (const [boneName, rot] of Object.entries(pose)) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) {
      console.warn(`[idlePose] Bone tidak ditemukan: ${boneName}`);
      continue;
    }
    node.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
  }
}
