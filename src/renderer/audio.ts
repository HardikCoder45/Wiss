export class StreamingLinearResampler {
  private previousSample: number | undefined;
  private sourcePosition = 0;
  private readonly ratio: number;

  constructor(inputRate: number, outputRate: number) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('Audio sample rates must be positive');
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array();
    const buffer = new Float32Array(input.length + (this.previousSample === undefined ? 0 : 1));
    let offset = 0;
    if (this.previousSample !== undefined) {
      buffer[0] = this.previousSample;
      offset = 1;
    }
    buffer.set(input, offset);

    const outputLength = Math.max(0, Math.ceil((buffer.length - 1 - this.sourcePosition) / this.ratio));
    const output = new Float32Array(outputLength);
    let written = 0;
    while (this.sourcePosition + 1 < buffer.length) {
      const left = Math.floor(this.sourcePosition);
      const fraction = this.sourcePosition - left;
      output[written++] = buffer[left]! * (1 - fraction) + buffer[left + 1]! * fraction;
      this.sourcePosition += this.ratio;
    }

    this.sourcePosition -= buffer.length - 1;
    this.previousSample = buffer[buffer.length - 1];
    return written === output.length ? output : output.slice(0, written);
  }
}
