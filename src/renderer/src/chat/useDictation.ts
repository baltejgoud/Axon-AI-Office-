import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../accounts';

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';

/** A recording this long stops and is transcribed by itself. */
export const MAX_RECORDING_MS = 2 * 60_000;
/** Loudness (RMS) speech reaches; a recording that never does was silence or a muted microphone. */
const HEARD_RMS = 0.006;
/** Opus in WebM: what Chromium records natively, and what Groq and OpenAI read. */
const MIME = 'audio/webm;codecs=opus';
/** Bits per second: well past what speech needs, so nothing is lost before transcription. */
const BITRATE = 24_000;

/** One recording: the microphone, the recorder, and the loudness meter. */
interface Recording {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  audio: AudioContext;
  frame: number;
  timer: number;
  /** Loudest moment so far. */
  peak: number;
  /** The meter ran; if it never did, its silence says nothing about the microphone. */
  metered: boolean;
  /** Escape or unmount: whatever was recorded or is being transcribed is dropped. */
  dropped: boolean;
}

interface DictationOptions {
  /** Names and terms the speech is likely to contain, read when the recording stops. */
  prompt: () => string;
  /** The words, ready to go in the box. */
  onText: (text: string) => void;
  onError: (message: string) => void;
}

/** Why the microphone would not start, in words that say what to do. */
function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  const mac = /Mac/.test(navigator.platform);
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return mac
      ? 'Axon isn’t allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone.'
      : 'Axon isn’t allowed to use the microphone. In Windows Settings → Privacy & security → Microphone, turn on “Let desktop apps access your microphone”.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone found. Plug one in, or pick one in your sound settings.';
  if (name === 'NotReadableError') return 'The microphone is busy in another app, or could not start.';
  return `Could not start the microphone. ${errorText(error)}`;
}

/**
 * Voice typing: records from the microphone until stopped, then sends the whole recording to be
 * transcribed (more accurate than words appearing as you speak). The meter element gets the live
 * loudness as `--mic-level` (0 to 1) without re-rendering the composer.
 */
export function useDictation(options: DictationOptions) {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [canRetry, setCanRetry] = useState(false);
  const failure = useRef<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const meter = useRef<HTMLElement | null>(null);
  const current = useRef<Recording | null>(null);
  /** Counts starts and cancels, so a microphone that opens after you cancelled (or started again) is closed. */
  const attempt = useRef(0);
  const latest = useRef(options);
  latest.current = options;
  const phaseRef = useRef<DictationPhase>('idle');
  const go = (next: DictationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  /** Lets go of the microphone (its in-use light goes off) and stops the meter. */
  const release = (rec: Recording) => {
    cancelAnimationFrame(rec.frame);
    clearInterval(rec.timer);
    rec.stream.getTracks().forEach((track) => track.stop());
    void rec.audio.close().catch(() => undefined);
    meter.current?.style.setProperty('--mic-level', '0');
  };

  const transcribe = async (rec: Recording, type: string) => {
    const blob = new Blob(rec.chunks, { type });
    const started = performance.now();
    if (rec.metered && rec.peak < HEARD_RMS) {
      if (current.current === rec) current.current = null;
      go('idle');
      latest.current.onError('I didn’t hear anything. Check that your microphone is on and not muted.');
      return;
    }
    try {
      const bytes = await blob.arrayBuffer();
      const encoded = performance.now();
      const text = await window.axon.speechTranscribe(bytes, blob.type, latest.current.prompt());
      if (rec.dropped) return;
      if (text) {
        latest.current.onText(text);
        console.debug('[voice latency]', {
          encodingMs: encoded - started,
          providerMs: performance.now() - encoded,
          bytes: bytes.byteLength
        });
      } else latest.current.onError('No words came through. Try again, a little closer to the microphone.');
    } catch (error) {
      if (!rec.dropped) {
        failure.current = rec;
        setCanRetry(true);
        latest.current.onError(errorText(error));
      }
    } finally {
      if (current.current === rec) {
        current.current = null;
        go('idle');
      }
    }
  };

  /** Stops recording and transcribes what was said. */
  const finish = useCallback(() => {
    const rec = current.current;
    if (!rec || phaseRef.current !== 'recording') return;
    go('transcribing');
    rec.recorder.onstop = () => void transcribe(rec, rec.recorder.mimeType || MIME);
    rec.recorder.stop();
    release(rec);
  }, []);

  /** Drops the recording, or the transcription on its way, and puts nothing in the box. */
  const cancel = useCallback(() => {
    failure.current = null;
    setCanRetry(false);
    const rec = current.current;
    current.current = null;
    attempt.current++;
    if (rec) {
      rec.dropped = true;
      rec.recorder.onstop = null;
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
      release(rec);
    }
    go('idle');
  }, []);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    failure.current = null;
    setCanRetry(false);
    const captureStarted = performance.now();
    go('starting');
    const mine = ++attempt.current;
    // Made during the click or key press, so the meter is allowed to run.
    const audio = new AudioContext();
    void audio.resume().catch(() => undefined);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      void audio.close().catch(() => undefined);
      if (attempt.current !== mine) return;
      go('idle');
      latest.current.onError(microphoneProblem(error));
      return;
    }
    if (attempt.current !== mine) {
      stream.getTracks().forEach((track) => track.stop());
      void audio.close().catch(() => undefined);
      return;
    }
    console.debug('[voice latency]', { captureInitializationMs: performance.now() - captureStarted });
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : {}),
        audioBitsPerSecond: BITRATE
      });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      void audio.close();
      go('idle');
      latest.current.onError(microphoneProblem(error));
      return;
    }
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const began = performance.now();
    const rec: Recording = {
      stream,
      recorder,
      chunks: [],
      audio,
      frame: 0,
      timer: 0,
      peak: 0,
      metered: false,
      dropped: false
    };
    recorder.onerror = () => {
      rec.dropped = true;
      release(rec);
      current.current = null;
      go('idle');
      latest.current.onError('Microphone recording failed. Try recording again.');
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) rec.chunks.push(event.data);
    };
    const listen = () => {
      if (audio.state === 'running') rec.metered = true;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const rms = Math.sqrt(sum / samples.length);
      rec.peak = Math.max(rec.peak, rms);
      meter.current?.style.setProperty('--mic-level', Math.min(1, rms * 9).toFixed(3));
      rec.frame = requestAnimationFrame(listen);
    };
    rec.timer = window.setInterval(() => {
      const ms = performance.now() - began;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) finish();
    }, 250);
    current.current = rec;
    recorder.start(100);
    listen();
    setElapsed(0);
    go('recording');
  }, [finish]);

  /** One key or click: start when idle, finish while recording. */
  const toggle = useCallback(() => {
    if (phaseRef.current === 'idle') void start();
    else if (phaseRef.current === 'recording') finish();
  }, [start, finish]);

  // Leaving the chat lets go of the microphone and forgets the recording.
  useEffect(() => cancel, [cancel]);

  const retry = useCallback(() => {
    const rec = failure.current;
    if (!rec || phaseRef.current !== 'idle') return;
    failure.current = null;
    setCanRetry(false);
    current.current = rec;
    go('transcribing');
    void transcribe(rec, rec.recorder.mimeType || MIME);
  }, []);
  return { phase, elapsed, meter, start, finish, cancel, toggle, canRetry, retry };
}

/** "0:07", "1:23". */
export const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
