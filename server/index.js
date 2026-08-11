// ---------------------------------------------------------------------------
// index.js  (server entry)
// Node/Express proxy kecil yang memegang API key 9inference di sisi server.
// Browser TIDAK pernah memegang key — ia memanggil /api/* yang di-proxy Vite
// (lihat vite.config.js) ke server ini.
//
//   POST /api/vision  { image }                          -> { description }
//   POST /api/chat    { history, message, visionDescription } -> SSE token stream
// ---------------------------------------------------------------------------
import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { describeFrame, detectVisionIntent } from './visionCapture.js';
import { generateReply, generateReplyStream } from './llmChat.js';
import { transcribeAudio } from './sttTranscribe.js';
import { generateSpeech } from './ttsGenerate.js';
import { isVoiceConfigured } from './voiceConfig.js';

const app = express();
// Frame base64 bisa lumayan besar — naikkan limit body JSON.
app.use(express.json({ limit: '12mb' }));

app.post('/api/vision', async (req, res) => {
  try {
    const { image } = req.body ?? {};
    if (!image) {
      return res.status(400).json({ error: 'Field "image" (data URL) wajib.' });
    }
    const description = await describeFrame(image);
    res.json({ description });
  } catch (err) {
    console.error('[vision] error:', err);
    res.status(500).json({ error: err.message ?? 'Vision gagal.' });
  }
});

app.post('/api/chat', async (req, res) => {
  // Server-Sent Events: satu event per potongan token.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { history, message, visionDescription } = req.body ?? {};
    if (!message) {
      res.write(
        `data: ${JSON.stringify({ error: 'Field "message" wajib.' })}\n\n`,
      );
      return res.end();
    }
    for await (const delta of generateReply(history, message, visionDescription)) {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[chat] error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message ?? 'Chat gagal.' })}\n\n`);
    res.end();
  }
});

// --- WebSocket: STT hands-free (VAD dari browser) -> (vision) -> chat -------
// Protokol pesan:
//   client -> server: { type:'audio_input', data:<base64>, mime, image?, durationMs }
//   server -> client: { type:'user_said', text } | { type:'vision', text }
//                     | { type:'audio_output', data, format } | { type:'audio_end' }
//                     | { type:'amika_replied', text } | { type:'error', message }
function extFromMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) {
    return 'm4a';
  }
  return 'webm';
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  const history = []; // histori percakapan per-koneksi
  const send = (obj) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj));
  };

  socket.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== 'audio_input') return;

    const { data, mime, image, durationMs } = msg;

    // Guard: audio kosong / terlalu pendek -> skip diam-diam. VAD kadang kirim
    // blip pendek; jangan spam error di log hands-free.
    if (!data || (typeof durationMs === 'number' && durationMs < 400)) return;

    try {
      const buf = Buffer.from(data, 'base64');
      if (buf.length < 512) return;

      // --- timing diagnostics (ponytail: hapus blok [timing] kalau tak perlu) --
      // Semua durasi relatif ke saat audio_input valid diterima (tPipe).
      const tPipe = performance.now();
      const ms = (a, b) => Math.round((b ?? performance.now()) - a);

      // 1) STT (Groq Whisper)
      const tSttStart = performance.now();
      const text = await transcribeAudio(buf, `audio.${extFromMime(mime)}`);
      const tSttEnd = performance.now();
      console.log(`[timing] STT: ${ms(tSttStart, tSttEnd)}ms (t+${ms(tPipe, tSttEnd)})`);

      // Filter noise: transkripsi kosong / terlalu pendek -> skip seluruh
      // pipeline (jangan buang API call untuk napas/dengkuran/suara latar).
      // ponytail: kalau Whisper masih halusinasi ("terima kasih") pas hening,
      // ganti sttTranscribe ke verbose_json & saring no_speech_prob.
      if (text.length < 3) {
        console.log('[stt] skip, noise/pendek:', JSON.stringify(text));
        return;
      }
      send({ type: 'user_said', text });

      // 2) Vision — hanya kalau ada intent DAN browser mengirim frame.
      let vision = null;
      if (detectVisionIntent(text) && image) {
        try {
          const tVisStart = performance.now();
          vision = await describeFrame(image);
          console.log(`[timing] vision: ${ms(tVisStart)}ms (t+${ms(tPipe)})`);
          send({ type: 'vision', text: vision });
        } catch (err) {
          console.error('[vision] error:', err);
          send({ type: 'error', message: `Vision gagal: ${err.message}` });
        }
      }

      // 3) Chat streaming + TTS per kalimat. generateReplyStream yield
      // {type:'delta'} (akumulasi teks) & {type:'sentence'} (kalimat utuh ->
      // TTS). Audio antar-kalimat di-serialize lewat ttsChain biar urut.
      // Streaming SUDAH benar: TTS kalimat pertama jalan begitu {sentence}
      // pertama muncul, tak nunggu LLM selesai (lihat [timing] di bawah).
      let full = '';
      const ttsOn = isVoiceConfigured();
      let ttsChain = Promise.resolve();

      // Milestone timing (di-set sekali; 0 = belum kejadian).
      let tLlmFirstToken = 0;
      let tLlmFirstSentence = 0;
      let tTtsStart = 0;
      let tTtsFirstChunk = 0;
      let tFirstAudioOut = 0;
      let sentenceIdx = 0;

      async function speak(sentence, idx) {
        try {
          const isFirst = idx === 0;
          if (isFirst) tTtsStart = performance.now();
          for await (const chunk of generateSpeech(sentence)) {
            if (isFirst && !tTtsFirstChunk) tTtsFirstChunk = performance.now();
            send({
              type: 'audio_output',
              data: chunk.toString('base64'),
              format: 'mp3',
            });
            if (isFirst && !tFirstAudioOut) {
              tFirstAudioOut = performance.now();
              // Ringkasan satu baris: audio_input -> audio pertama terdengar.
              console.log(
                `[timing] STT selesai: ${ms(tPipe, tSttEnd)}ms` +
                  ` | LLM first token: ${ms(tPipe, tLlmFirstToken)}ms` +
                  ` | LLM first sentence: ${ms(tPipe, tLlmFirstSentence)}ms` +
                  ` | TTS req->first chunk: ${ms(tTtsStart, tTtsFirstChunk)}ms` +
                  ` | total to first audio: ${ms(tPipe, tFirstAudioOut)}ms`,
              );
            }
          }
          send({ type: 'audio_end' }); // penanda satu kalimat mp3 selesai
        } catch (err) {
          // TTS gagal -> log & skip, jangan macetkan percakapan.
          console.error('[tts] gagal, skip kalimat:', err.message);
        }
      }

      const tLlmStart = performance.now(); // = saat request LLM dimulai
      for await (const ev of generateReplyStream(history, text, vision)) {
        if (ev.type === 'delta') {
          if (!tLlmFirstToken) {
            tLlmFirstToken = performance.now();
            console.log(`[timing] LLM first token: ${ms(tLlmStart, tLlmFirstToken)}ms (req->ttft, t+${ms(tPipe)})`);
          }
          full += ev.text;
        } else if (ev.type === 'sentence') {
          if (!tLlmFirstSentence) {
            tLlmFirstSentence = performance.now();
            console.log(`[timing] LLM first sentence: ${ms(tLlmStart, tLlmFirstSentence)}ms (req->sentence, t+${ms(tPipe)})`);
          }
          if (ttsOn) {
            const idx = sentenceIdx++;
            ttsChain = ttsChain.then(() => speak(ev.text, idx));
          }
        }
      }
      await ttsChain; // pastikan semua audio ke-flush sebelum turn ditutup
      send({ type: 'amika_replied', text: full });

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: full });
    } catch (err) {
      console.error('[stt] error:', err);
      send({ type: 'error', message: err.message ?? 'STT gagal.' });
    }
  });
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(
    `[server] 9inference + STT proxy jalan di http://localhost:${PORT} (ws: /ws)`,
  );
});
