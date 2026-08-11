// ---------------------------------------------------------------------------
// visionCapture.js  (server-side)
// Kirim satu frame (data URL JPEG base64) ke model vision "kimi-k3" dan
// kembalikan deskripsi singkat. Dipanggil oleh route POST /api/vision.
// ---------------------------------------------------------------------------
import { client } from './nineInferenceClient.js';

const VISION_MODEL = 'minimax-m3';
const VISION_PROMPT =
  'Deskripsikan singkat 1-2 kalimat objek yang sedang ditunjukkan ke kamera ini.';

// imageDataUrl = "data:image/jpeg;base64,....."
export async function describeFrame(imageDataUrl) {
  const res = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
  });

  return res.choices[0]?.message?.content?.trim() ?? '';
}

// Deteksi apakah user sedang ingin menunjukkan sesuatu ke kamera, berdasar
// teks (hasil STT). Dipakai server sebelum memutuskan capture frame + vision.
//
// ponytail: heuristik keyword sederhana. Tuning daftar di bawah kalau kurang
// akurat; upgrade ke klasifikasi LLM kalau butuh lebih pintar.
const VISION_HINTS = [
  'ini apa', 'apa ini', 'apa nih', 'ini apaan', 'benda ini', 'ini namanya',
  'lihat', 'liat', 'perhatikan', 'perhatiin', 'coba lihat', 'coba liat',
  'kamu lihat', 'kamu liat', 'aku tunjukkan', 'aku pegang', 'aku bawa',
  'menurut kamu ini', 'gimana ini', 'warna apa', 'ini warna',
];

export function detectVisionIntent(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return VISION_HINTS.some((k) => t.includes(k));
}

// Self-check: `node server/visionCapture.js`
if (process.argv[1] && process.argv[1].endsWith('visionCapture.js')) {
  const assert = (c, m) => {
    if (!c) throw new Error('FAIL: ' + m);
  };
  assert(detectVisionIntent('ini apa sih?') === true, 'positif');
  assert(detectVisionIntent('coba lihat dong') === true, 'positif-2');
  assert(detectVisionIntent('halo apa kabar') === false, 'negatif');
  assert(detectVisionIntent('') === false, 'kosong');
  console.log('visionCapture self-check OK');
}
