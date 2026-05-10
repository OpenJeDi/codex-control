import { imageGenerationParser } from './parsers/imageGeneration.js';

const parsers = [];

function addParser(parser) {
  if (!parser || typeof parser.canRender !== 'function' || typeof parser.render !== 'function') return;
  parsers.push(parser);
}

export function registerTranscriptBlockParser(parser) {
  if (!parser) return;
  addParser(parser);
}

export function clearTranscriptBlockParsers() {
  parsers.length = 0;
}

export function listTranscriptBlockParsers() {
  return parsers.slice();
}

addParser(imageGenerationParser);

export function createTranscriptBlockRenderer(context = {}) {
  return (blocks = []) => {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    const rendered = blocks.map((block) => {
      const parser = parsers.find((entry) => entry.canRender(block));
      if (!parser) return '';
      return parser.render(block, context);
    });
    return rendered.filter(Boolean).join('\n');
  };
}
