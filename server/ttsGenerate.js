// ---------------------------------------------------------------------------
// ttsGenerate.js  (server-side)
// TTS streaming lewat Fish Audio WebSocket (wss://api.fish.audio/v1/tts/live).
// Protokol: frame MessagePack. Client kirim start -> text -> flush -> stop;
// server balas frame {event:'audio', audio:<bytes>} berkali-kali lalu
// {event:'finish', reason}.
//
// generateSpeech(text) = async generator: yield Buffer chunk mp3 begitu datang,
// jadi server bisa langsung relay ke browser (audio mulai bunyi sebelum kalimat
// selesai di-generate). Satu pemanggilan = satu kalimat = satu file mp3 utuh.
// ---------------------------------------------------------------------------
import WebSocket from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { WAIFU_VOICE_REFERENCE_ID } from './voiceConfig.js';

const TTS_ENDPOINT = 'wss://api.fish.audio/v1/tts/live';
const TTS_MODEL = 's2.1-pro-free'; // tier gratis. 's2.1-pro' (tanpa -free) berbayar -> 402 kalau saldo 0.
const TTS_FORMAT = 'mp3'; // chunk mp3 kecil, cocok untuk streaming latensi rendah

export async function* generateSpeech(text) {
  const apiKey = process.env.FISH_API_KEY;
  if (!apiKey) throw new Error('FISH_API_KEY belum di-set (cek .env).');

  const ws = new WebSocket(TTS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}`, model: TTS_MODEL },
  });

  // Jembatan event WS (push) -> async generator (pull).
  const queue = [];
  let finished = false;
  let failure = null;
  let wake = null;
  const signal = () => {
    if (wake) {
      wake();
      wake = null;
    }
  };

  ws.on('open', () => {
    // start dengan text kosong; teks asli dikirim lewat TextEvent.
    ws.send(
      encode({
        event: 'start',
        request: {
          text: '',
          reference_id: WAIFU_VOICE_REFERENCE_ID,
          format: TTS_FORMAT,
          latency: 'low',
        },
      }),
    );
    ws.send(encode({ event: 'text', text }));
    ws.send(encode({ event: 'flush' }));
    ws.send(encode({ event: 'stop' }));
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = decode(data);
    } catch {
      return;
    }
    if (msg.event === 'audio' && msg.audio) {
      queue.push(Buffer.from(msg.audio));
      signal();
    } else if (msg.event === 'finish') {
      if (msg.reason === 'error') failure = new Error('Fish Audio: finish error.');
      finished = true;
      signal();
    }
  });

  ws.on('error', (err) => {
    failure = err;
    finished = true;
    signal();
  });
  ws.on('close', () => {
    finished = true;
    signal();
  });

  try {
    while (true) {
      if (queue.length) {
        yield queue.shift();
        continue;
      }
      if (failure) throw failure;
      if (finished) return;
      await new Promise((res) => {
        wake = res;
      });
    }
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}
