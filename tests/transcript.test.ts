import { describe, expect, it } from 'vitest';
import { polishTranscript } from '../src/main/transcript';
import { selectDetectedLanguage } from '../src/main/models';

describe('polishTranscript', () => {
  it('removes safe fillers and immediate repetitions', () => {
    expect(polishTranscript('Um send the the report, uh tomorrow.', {
      removeFillers: true,
      smartCommands: false,
    })).toBe('send the report, tomorrow.');
  });

  it('turns spoken formatting commands into written structure', () => {
    expect(polishTranscript('First item comma done new paragraph second item question mark', {
      removeFillers: false,
      smartCommands: true,
    })).toBe('First item, done\n\nsecond item?');
  });

  it('leaves multilingual text intact', () => {
    expect(polishTranscript('नमस्ते दुनिया — مرحبا بالعالم', {
      removeFillers: true,
      smartCommands: true,
    })).toBe('नमस्ते दुनिया — مرحبا بالعالم');
  });
});

describe('selectDetectedLanguage', () => {
  it('selects the highest-scoring Whisper language token', () => {
    const logits = new Float32Array(12).fill(-10);
    logits[8] = 1.2;
    logits[9] = 4.8;
    expect(selectDetectedLanguage(logits, 6, { '<|en|>': 2, '<|hi|>': 3 })).toBe('hi');
  });
});
