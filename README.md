# Waifu VRM Starter

Fondasi awal proyek **waifu AI companion** — render avatar VRM 3D di browser pakai [Three.js](https://threejs.org/) + [@pixiv/three-vrm](https://github.com/pixiv/three-vrm), di-bundle dengan Vite.

## Fitur

- Scene Three.js dasar: renderer, `PerspectiveCamera`, `OrbitControls` (putar avatar pakai mouse).
- Lighting: ambient + directional light.
- Load `.vrm` via `VRMLoaderPlugin`.
- Orientasi avatar otomatis menghadap kamera (`VRMUtils.rotateVRM0`).
- Render loop dengan `vrm.update(deltaTime)` tiap frame → auto-blink & spring bone jalan.
- Panel debug HTML untuk trigger ekspresi manual (Happy / Sad / Surprised / Blink / Reset).
- Log daftar expression yang terdeteksi dari model ke console.
- **Companion hands-free**: mic selalu mendengar (VAD Web Audio, tanpa tombol rekam), STT (Whisper) → LLM (streaming) → TTS (Fish Audio) otomatis. Panel kanan = log percakapan + indikator mic (hijau saat mendengar).
- **Lip-sync "aa"**: mulut avatar buka-tutup mengikuti amplitudo audio TTS real-time.
- **Gerakan lengan**: idle sway halus selalu jalan + gestur bicara aditif yang ikut amplitudo audio saat TTS bunyi (`src/armGesture.js`).
- **Log latensi**: server cetak `[timing]` per tahap (STT / LLM first token / first sentence / TTS first chunk / total to first audio) buat diagnosa delay.

## Cara Menjalankan

```bash
npm install
```

Salin `.env.example` jadi `.env`, lalu isi ketiga key (semua server-side):

```
NINEINFERENCE_API_KEY=sk-....   # vision (kimi-k3) + chat (deepseek-v4-flash)
GROQ_API_KEY=gsk_....           # STT (Whisper large v3 turbo)
FISH_API_KEY=....               # TTS (Fish Audio s2.1-pro-free) — opsional
```

Untuk **suara** (TTS), selain `FISH_API_KEY` isi juga id voice di
`server/voiceConfig.js` (`WAIFU_VOICE_REFERENCE_ID`) dengan Reference ID dari
[fish.audio](https://fish.audio). Selama masih placeholder, TTS otomatis di-skip
(chat teks + STT tetap jalan).

Jalankan **server proxy + frontend** sekaligus:

```bash
npm run dev:all
```

Atau dua terminal terpisah:

```bash
npm run server   # Node proxy 9inference di :8787
npm run dev       # Vite di :5173 (proxy /api -> :8787)
```

Lalu buka URL yang ditampilkan Vite (biasanya `http://localhost:5173`).

> **Kenapa ada server?** Semua API key (`NINEINFERENCE_API_KEY`, `GROQ_API_KEY`,
> `FISH_API_KEY`) cuma boleh hidup di sisi server. Browser memanggil `/api/*` &
> `/ws`; Vite mem-proxy-nya ke Node server yang memegang key. Key tidak pernah
> ikut ter-bundle ke browser.

## Menaruh Model

Taruh file VRM kamu di:

```
public/models/avatar.vrm
```

Nama harus persis `avatar.vrm`, atau ubah path di `src/main.js` (cari `'/models/avatar.vrm'`).

## Struktur

```
.
├── index.html               # Entry + panel debug + panel companion + styling
├── vite.config.js           # Proxy /api -> server Node (:8787)
├── src/
│   ├── main.js              # Three.js & VRM (render, expression, idle, lengan, lip-sync "aa")
│   ├── idlePose.js          # Pose lengan awal (sekali saat load)
│   ├── idleAnimation.js     # Idle self-driven (napas, sway, kepala, blink)
│   ├── armGesture.js        # Lengan: idle sway + gestur bicara (ikut amplitudo audio TTS)
│   └── companion.js         # Browser: webcam + mic hands-free/VAD (WS), log chat, TTS playback (Web Audio) + lip-sync
├── server/                  # Node proxy — pegang semua API key
│   ├── index.js             # Express: /api/vision, /api/chat (SSE) + WS /ws (STT->LLM->TTS) + log [timing]
│   ├── nineInferenceClient.js  # 1 OpenAI client (baseURL 9inference), dishare
│   ├── visionCapture.js     # kimi-k3: describeFrame(dataUrl)
│   ├── llmChat.js           # deepseek-v4-flash: generateReply()/generateReplyStream() (per-kalimat utk TTS)
│   ├── personality.js       # System prompt waifu
│   ├── groqClient.js        # Client Groq (STT)
│   ├── sttTranscribe.js     # whisper-large-v3-turbo: transcribe(audio)
│   ├── voiceConfig.js       # WAIFU_VOICE_REFERENCE_ID (isi id voice Fish Audio)
│   ├── ttsGenerate.js       # Fish Audio s2.1-pro-free: generateSpeech(text) streaming mp3
│   └── _timingProbe.js      # Diagnostik: ukur latensi LLM+TTS (node server/_timingProbe.js)
├── public/
│   └── models/
│       └── avatar.vrm       # ← taruh model kamu di sini
├── .env.example             # Contoh env (salin jadi .env)
├── package.json
└── README.md
```

## Diagnosa Latensi

Server mencetak breakdown latensi tiap turn (relatif ke saat audio diterima):

```
[timing] STT selesai: 900ms | LLM first token: 3200ms | LLM first sentence: 3200ms | TTS req->first chunk: 700ms | total to first audio: 4100ms
```

Cek cepat LLM + TTS tanpa mic:

```bash
node server/_timingProbe.js 3
```

Biang delay biasanya **time-to-first-token LLM 9inference** (bisa 3–25 detik, tak stabil) — bukan STT/TTS (TTS first chunk ~0.5–0.8s). Kalau perlu ngebut, pindah model chat ke provider TTFT rendah (mis. Groq, key-nya sudah ada di `.env`).

## Catatan Ekspresi

Tombol debug memanggil `vrm.expressionManager.setValue(name, 1.0)` dengan preset name
standar VRM (`happy`, `sad`, `surprised`, `blink`). Kalau model kamu pakai nama
blendshape custom, cek **console log** — di sana ada daftar expression yang benar-benar
terdeteksi dari file VRM kamu, lalu sesuaikan `data-expression` di `index.html`.
