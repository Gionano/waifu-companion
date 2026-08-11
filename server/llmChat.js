// ---------------------------------------------------------------------------
// llmChat.js  (server-side)
// Percakapan utama waifu lewat model "deepseek-v4-flash" (streaming).
// generateReply() adalah async generator: yield potongan teks (delta) begitu
// datang, supaya route /api/chat bisa mem-forward token demi token ke browser
// (dan nanti gampang dipecah per-kalimat untuk TTS).
// ---------------------------------------------------------------------------
import { client } from './nineInferenceClient.js';
import { WAIFU_SYSTEM_PROMPT } from './personality.js';

const CHAT_MODEL = 'deepseek-v4-flash';
const HISTORY_LIMIT = 8; // batasi histori biar hemat token

export async function* generateReply(
  conversationHistory,
  userMessage,
  visionDescription,
) {
  const messages = [{ role: 'system', content: WAIFU_SYSTEM_PROMPT }];

  // Histori singkat percakapan (ambil beberapa turn terakhir saja).
  for (const turn of (conversationHistory ?? []).slice(-HISTORY_LIMIT)) {
    messages.push({ role: turn.role, content: turn.content });
  }

  // Konteks vision disisipkan tepat sebelum pesan user.
  if (visionDescription) {
    messages.push({
      role: 'system',
      content: `[User sedang menunjukkan: ${visionDescription}]`,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  const stream = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

// Ambil kalimat lengkap paling awal dari `buf`. Return { sentence, rest } atau
// null kalau belum ada kalimat utuh. Batas kalimat = . ! ? … atau newline yang
// diikuti spasi/akhir. Titik desimal ("3.14") tidak dihitung sebagai batas.
export function takeSentence(buf) {
  const ENDERS = '.!?…\n';
  for (let i = 0; i < buf.length; i++) {
    if (!ENDERS.includes(buf[i])) continue;
    // Titik desimal: digit "." digit -> bukan akhir kalimat.
    if (buf[i] === '.' && /\d/.test(buf[i - 1] ?? '') && /\d/.test(buf[i + 1] ?? '')) {
      continue;
    }
    // Serap tanda baca beruntun (?!, …).
    let j = i;
    while (j + 1 < buf.length && ENDERS.includes(buf[j + 1])) j++;
    const after = buf[j + 1];
    // Butuh whitespace sesudahnya biar tak motong ".!?" di tengah token. TAPI
    // newline itu sendiri sudah jadi pemisah -> selalu valid. Kalau ender di
    // ujung buffer (after undefined) & bukan newline, tunggu token berikutnya.
    if (after === ' ' || after === '\n' || after === '\t' || buf[j] === '\n') {
      const sentence = buf.slice(0, j + 1).trim();
      const rest = buf.slice(j + 1).replace(/^\s+/, '');
      if (sentence) return { sentence, rest };
    }
  }
  return null;
}

// Bungkus generateReply: yield {type:'delta', text} tiap token (buat streaming
// teks ke browser) DAN {type:'sentence', text} tiap kalimat selesai (buat TTS).
export async function* generateReplyStream(
  conversationHistory,
  userMessage,
  visionDescription,
) {
  let buf = '';
  for await (const delta of generateReply(
    conversationHistory,
    userMessage,
    visionDescription,
  )) {
    yield { type: 'delta', text: delta };
    buf += delta;
    let hit;
    while ((hit = takeSentence(buf))) {
      yield { type: 'sentence', text: hit.sentence };
      buf = hit.rest;
    }
  }
  const tail = buf.trim();
  if (tail) yield { type: 'sentence', text: tail };
}

// Self-check parser: `node server/llmChat.js`
if (process.argv[1] && process.argv[1].endsWith('llmChat.js')) {
  const assert = (c, m) => {
    if (!c) throw new Error('FAIL: ' + m);
  };
  const a = takeSentence('Halo dunia. Sisa teks');
  assert(a && a.sentence === 'Halo dunia.' && a.rest === 'Sisa teks', 'kalimat-1');
  assert(takeSentence('Belum selesai tanpa titik') === null, 'belum-lengkap');
  assert(takeSentence('Harga 3.14 dolar ') === null, 'desimal-bukan-batas');
  const b = takeSentence('Wah, keren?! Terus?');
  assert(b && b.sentence === 'Wah, keren?!' && b.rest === 'Terus?', 'punct-beruntun');
  const c = takeSentence('Baris satu\nBaris dua');
  assert(c && c.sentence === 'Baris satu' && c.rest === 'Baris dua', 'newline-batas');
  console.log('llmChat self-check OK');
}
