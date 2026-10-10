import type { WhisperModelManager } from './whisper-model';

export interface SegmenterOptions {
  sampleRate: number;
  silenceThreshold: number;
  silenceMs: number;
  maxSegmentMs: number;
  minSegmentMs?: number;
  preRollMs?: number;
  flushOnSilence?: boolean;
  onSegment: (samples: Float32Array) => void;
}

export class SpeechSegmenter {
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private silentSamples = 0;
  private hasSpeech = false;
  private active = false;

  constructor(private readonly options: SegmenterOptions) {}

  start(): void {
    this.reset();
    this.active = true;
  }

  push(samples: Float32Array, level: number): void {
    if (!this.active || samples.length === 0) return;
    this.chunks.push(samples);
    this.totalSamples += samples.length;
    if (level >= this.options.silenceThreshold) {
      this.hasSpeech = true;
      this.silentSamples = 0;
    } else {
      this.silentSamples += samples.length;
      if (!this.hasSpeech) {
        const preRollSamples = Math.round(this.options.sampleRate * ((this.options.preRollMs ?? 250) / 1000));
        this.retainTrailingSamples(preRollSamples);
      }
    }

    const minSamples = Math.round(this.options.sampleRate * ((this.options.minSegmentMs ?? 650) / 1000));
    const silenceSamples = Math.round(this.options.sampleRate * (this.options.silenceMs / 1000));
    const maxSamples = Math.round(this.options.sampleRate * (this.options.maxSegmentMs / 1000));
    const hitPause = (this.options.flushOnSilence ?? true)
      && this.hasSpeech
      && this.totalSamples >= minSamples
      && this.silentSamples >= silenceSamples;
    const hitMax = this.totalSamples >= maxSamples;
    if (hitPause || hitMax) this.flush();
  }

  finish(): void {
    if (!this.active) return;
    this.flush();
    this.active = false;
  }

  private flush(): void {
    if (this.totalSamples === 0) return;
    if (this.hasSpeech) {
      const output = new Float32Array(this.totalSamples);
      let offset = 0;
      for (const chunk of this.chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      this.options.onSegment(output);
    }
    this.chunks = [];
    this.totalSamples = 0;
    this.silentSamples = 0;
    this.hasSpeech = false;
  }

  private retainTrailingSamples(maxSamples: number): void {
    if (this.totalSamples <= maxSamples) return;
    let samplesToDrop = this.totalSamples - maxSamples;
    while (samplesToDrop > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]!;
      if (first.length <= samplesToDrop) {
        this.chunks.shift();
        this.totalSamples -= first.length;
        samplesToDrop -= first.length;
      } else {
        this.chunks[0] = first.slice(samplesToDrop);
        this.totalSamples -= samplesToDrop;
        samplesToDrop = 0;
      }
    }
    this.silentSamples = this.totalSamples;
  }

  private reset(): void {
    this.chunks = [];
    this.totalSamples = 0;
    this.silentSamples = 0;
    this.hasSpeech = false;
    this.active = false;
  }
}

export interface WhisperAsrOptions {
  silenceThreshold: number;
  silenceMs: number;
  maxSegmentMs: number;
  flushOnSilence?: boolean;
  onTranscript: (text: string, language: string) => void | Promise<void>;
  onError: (message: string) => void;
}

export class WhisperAsr {
  readonly sampleRate = 16_000;
  private decodeChain: Promise<void> = Promise.resolve();
  private readonly segmenter: SpeechSegmenter;
  private sessionLanguage?: string;

  constructor(
    private readonly model: WhisperModelManager,
    private readonly options: WhisperAsrOptions,
  ) {
    this.segmenter = new SpeechSegmenter({
      sampleRate: this.sampleRate,
      silenceThreshold: options.silenceThreshold,
      silenceMs: options.silenceMs,
      maxSegmentMs: options.maxSegmentMs,
      minSegmentMs: 1_000,
      preRollMs: 250,
      flushOnSilence: options.flushOnSilence ?? false,
      onSegment: (samples) => this.enqueueDecode(samples),
    });
  }

  prepare(): Promise<void> {
    return this.model.prepare(false);
  }

  startSession(): void {
    this.sessionLanguage = undefined;
    this.segmenter.start();
  }

  push(samples: Float32Array, level: number): void {
    this.segmenter.push(samples, level);
  }

  async finishSession(): Promise<void> {
    this.segmenter.finish();
    await this.decodeChain;
  }

  async drain(): Promise<void> {
    await this.decodeChain;
  }

  private enqueueDecode(samples: Float32Array): void {
    this.decodeChain = this.decodeChain
      .then(async () => {
        const result = await this.model.transcribe(samples, this.sessionLanguage);
        this.sessionLanguage = result.language;
        const text = normalizeTranscript(result.text);
        if (text) await this.options.onTranscript(text, result.language);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.options.onError(message);
      });
  }
}

export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
