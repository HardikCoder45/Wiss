export interface TranscriptPolishOptions {
  removeFillers: boolean;
  smartCommands: boolean;
}

const FILLERS = /(?:^|\s)(?:um+|uh+|erm+|hmm+)(?=\s|[,.!?]|$)/giu;
const IMMEDIATE_REPETITION = /\b([\p{L}\p{N}'’-]+)(?:\s+\1\b)+/giu;

export function polishTranscript(text: string, options: TranscriptPolishOptions): string {
  let output = text.replace(/\s+/g, ' ').trim();
  if (!output) return '';

  if (options.removeFillers) {
    output = output.replace(FILLERS, ' ').replace(IMMEDIATE_REPETITION, '$1');
  }

  if (options.smartCommands) {
    output = output
      .replace(/\bnew paragraph\b[,.]?/giu, '\n\n')
      .replace(/\bnew line\b[,.]?/giu, '\n')
      .replace(/\bquestion mark\b/giu, '?')
      .replace(/\bexclamation (?:mark|point)\b/giu, '!')
      .replace(/\b(?:full stop|period)\b/giu, '.')
      .replace(/\bcomma\b/giu, ',')
      .replace(/\bcolon\b/giu, ':')
      .replace(/\bsemicolon\b/giu, ';');
  }

  return output
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[\p{L}\p{N}])/gu, '$1 ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
