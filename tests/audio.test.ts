import { describe, expect, it } from 'vitest';
import { StreamingLinearResampler } from '../src/renderer/audio';

function concat(chunks: Float32Array[]): Float32Array {
  const output = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

describe('StreamingLinearResampler', () => {
  it('preserves phase across microphone callbacks', () => {
    const input = Float32Array.from({ length: 44_100 }, (_, index) => Math.sin(index / 37));
    const singlePass = new StreamingLinearResampler(44_100, 16_000).process(input);
    const streaming = new StreamingLinearResampler(44_100, 16_000);
    const chunks: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 4096) {
      chunks.push(streaming.process(input.slice(offset, offset + 4096)));
    }
    const chunked = concat(chunks);
    expect(chunked.length).toBe(singlePass.length);
    const maxDifference = chunked.reduce(
      (difference, sample, index) => Math.max(difference, Math.abs(sample - singlePass[index]!)),
      0,
    );
    expect(maxDifference).toBeLessThan(1e-6);
    expect(singlePass.length).toBe(16_000);
  });
});
