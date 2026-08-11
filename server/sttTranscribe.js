// ---------------------------------------------------------------------------
// sttTranscribe.js  (server-side)
// Speech-to-Text via Groq Whisper. transcribeAudio() menerima Buffer rekaman
// (webm/wav/m4a dari MediaRecorder browser) dan mengembalikan teks transkripsi.
// Model whisper-large-v3-turbo dipilih untuk kecepatan (percakapan real-time).
// ---------------------------------------------------------------------------
import { toFile } from 'groq-sdk';
import { groq } from './groqClient.js';

const STT_MODEL = 'whisper-large-v3-turbo';

// audioBuffer: Buffer audio mentah. `filename` dipakai Groq untuk menebak
// container — samakan ekstensinya dengan mime rekaman (default webm).
export async function transcribeAudio(audioBuffer, filename = 'audio.webm') {
  const file = await toFile(audioBuffer, filename);
  const res = await groq.audio.transcriptions.create({
    file,
    model: STT_MODEL,
    language: 'id', // Bahasa Indonesia — akurasi lebih baik
    response_format: 'json',
  });
  return (res.text ?? '').trim();
}
