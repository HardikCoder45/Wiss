import { describe, expect, it, vi } from 'vitest';
import { normalizeTranscript, SpeechSegmenter } from '../src/main/asr';
import { DEFAULT_SETTINGS } from '../src/shared';

const chunk = (samples: number, value = 0.1) => new Float32Array(samples).fill(value);

describe('SpeechSegmenter', () => {
  it('emits a speech segment after a pause', () => {
    const onSegment = vi.fn();
    const segmenter = new SpeechSegmenter({
      sampleRate: 1000,
      silenceThreshold: 0.02,
      silenceMs: 200,
      maxSegmentMs: 5000,
      minSegmentMs: 200,
      onSegment,
    });
    segmenter.start();
    segmenter.push(chunk(300), 0.1);
    segmenter.push(chunk(200, 0), 0);
    expect(onSegment).toHaveBeenCalledOnce();
    expect(onSegment.mock.calls[0]?.[0]).toHaveLength(500);
  });

  it('flushes long speech at the max segment duration', () => {
    const onSegment = vi.fn();
    const segmenter = new SpeechSegmenter({
      sampleRate: 1000,
      silenceThreshold: 0.02,
      silenceMs: 500,
      maxSegmentMs: 1000,
      onSegment,
    });
    segmenter.start();
    segmenter.push(chunk(600), 0.1);
    segmenter.push(chunk(400), 0.1);
    expect(onSegment).toHaveBeenCalledOnce();
    expect(onSegment.mock.calls[0]?.[0]).toHaveLength(1000);
  });

  it('does not emit pure silence', () => {
    const onSegment = vi.fn();
    const segmenter = new SpeechSegmenter({
      sampleRate: 1000,
      silenceThreshold: 0.02,
      silenceMs: 200,
      maxSegmentMs: 500,
      onSegment,
    });
    segmenter.start();
    segmenter.push(chunk(500, 0), 0);
    segmenter.finish();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('keeps only a short pre-roll instead of feeding long leading silence to the model', () => {
    const onSegment = vi.fn();
    const segmenter = new SpeechSegmenter({
      sampleRate: 1000,
      silenceThreshold: 0.02,
      silenceMs: 200,
      maxSegmentMs: 5000,
      minSegmentMs: 200,
      preRollMs: 100,
      onSegment,
    });
    segmenter.start();
    segmenter.push(chunk(800, 0), 0);
    segmenter.push(chunk(300), 0.1);
    segmenter.push(chunk(200, 0), 0);
    expect(onSegment).toHaveBeenCalledOnce();
    expect(onSegment.mock.calls[0]?.[0]).toHaveLength(600);
  });
});

describe('normalizeTranscript', () => {
  it('collapses model whitespace without changing language text', () => {
    expect(normalizeTranscript('  hello   दुनिया\n  world  ')).toBe('hello दुनिया world');
  });
});

describe('multilingual recognition defaults', () => {
  it('keeps enough uninterrupted audio for automatic language recognition', () => {
    expect(DEFAULT_SETTINGS.segmentMaxMs).toBeGreaterThanOrEqual(10_000);
    expect(DEFAULT_SETTINGS.silenceMs).toBeGreaterThanOrEqual(800);
  });

  it('keeps installed builds available as a background service', () => {
    expect(DEFAULT_SETTINGS.launchAtLogin).toBe(true);
  });
});
