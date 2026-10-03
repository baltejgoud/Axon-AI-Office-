import type { ProviderConfig } from '../shared/types';
import { DEFAULT_VOICE, type SpeechModel, type VoiceSettings } from '../shared/speech';
import { endpoint, providerError, unreachable } from './providers';

/** The largest recording sent: Groq's free tier takes uploads up to 25 MB. */
export const AUDIO_MAX_BYTES = 24 * 1024 * 1024;
/** How long a transcription may take before voice typing gives up on it. */
export const SPEECH_TIMEOUT_MS = 120_000;

/** Audio the transcription services accept, by MIME type, with the file extension they read it by. */
const FORMATS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac'
};

/** A recording's base MIME type (codecs left off) and its extension; null for audio no service reads. */
export function audioFormat(mime: string): { type: string; extension: string } | null {
  const type = mime.split(';')[0].trim().toLowerCase();
  return FORMATS[type] ? { type, extension: FORMATS[type] } : null;
}

export interface TranscribeRequest {
  audio: Uint8Array;
  mime: string;
  model: SpeechModel;
  /** ISO-639-1, or '' for the service to detect. */
  language: string;
  /** Names and terms the speech is likely to contain, and the text it follows. */
  prompt: string;
  signal?: AbortSignal;
}

/**
 * A recording as text, from an OpenAI-style /audio/transcriptions endpoint (Groq, OpenAI). Sent at
 * temperature 0 with the language and the hint; Whisper models answer in segments so stretches of
 * silence it would otherwise fill with invented words can be dropped.
 */
export async function transcribe(provider: ProviderConfig, key: string | null, request: TranscribeRequest): Promise<string> {
  const format = audioFormat(request.mime);
  if (!format) throw new Error('Voice typing recorded audio in a format the transcription service can’t read.');
  const url = `${endpoint(provider).href.replace(/\/$/, '')}/audio/transcriptions`;
  const form = new FormData();
  form.append('file', new Blob([request.audio.slice()], { type: format.type }), `speech.${format.extension}`);
  form.append('model', request.model.id);
  form.append('temperature', '0');
  form.append('response_format', request.model.segments ? 'verbose_json' : 'json');
  if (request.language) form.append('language', request.language);
  if (request.prompt) form.append('prompt', request.prompt);
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: form, signal: request.signal, redirect: 'error' });
  } catch (error) {
    if (request.signal?.aborted) throw new Error('Transcribing took too long. Try again, or record a shorter message.');
    if (error instanceof TypeError) throw unreachable(url);
    throw error;
  }
  if (!response.ok) throw await providerError(response, key);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('The transcription service answered, but not with a transcript.');
  }
  return spokenText(body);
}

interface Segment {
  text?: unknown;
  no_speech_prob?: unknown;
  avg_logprob?: unknown;
}

/** Whisper's own test for a stretch with nobody speaking in it: probably silence, and not decoded with confidence. */
function silent(segment: Segment): boolean {
  const noSpeech = typeof segment.no_speech_prob === 'number' ? segment.no_speech_prob : 0;
  const logprob = typeof segment.avg_logprob === 'number' ? segment.avg_logprob : 0;
  return noSpeech > 0.6 && logprob < -1;
}

/** Over silence Whisper sometimes reads the hint back; that is never what you said. */
const echoesHint = (text: string) => /^\s*glossary:/i.test(text);

/** The words in a transcription answer, without the stretches Whisper itself judged to be silence. */
export function spokenText(body: unknown): string {
  const { text, segments } = (body ?? {}) as { text?: unknown; segments?: unknown };
  if (Array.isArray(segments) && segments.length) {
    return (segments as Segment[])
      .filter((s) => typeof s.text === 'string' && !silent(s) && !echoesHint(s.text))
      .map((s) => s.text as string)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (typeof text !== 'string') throw new Error('The transcription service answered, but not with a transcript.');
  return echoesHint(text) ? '' : text.replace(/\s+/g, ' ').trim();
}

/** Settings → Voice as saved: a choice that makes no sense is refused. */
export function cleanVoice(value: unknown): VoiceSettings {
  if (value === undefined || value === null) return { ...DEFAULT_VOICE };
  const v = value as Partial<VoiceSettings>;
  const providerId = v.providerId ?? null;
  const model = v.model ?? '';
  const language = v.language ?? DEFAULT_VOICE.language;
  if (
    typeof value !== 'object' ||
    (providerId !== null && (typeof providerId !== 'string' || providerId.length > 100)) ||
    typeof model !== 'string' ||
    model.length > 100 ||
    typeof language !== 'string' ||
    !/^([a-z]{2,3})?$/.test(language)
  )
    throw new Error('Invalid voice settings.');
  return { providerId, model, language };
}
