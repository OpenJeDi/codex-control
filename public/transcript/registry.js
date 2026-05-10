import { imageGenerationParser } from './parsers/imageGeneration.js';
import { commandExecutionParser } from './parsers/commandExecution.js';

const blockParsers = [];
const itemParsers = [];

function addParser(registry, parser) {
  if (!parser || typeof parser.canRender !== 'function' || typeof parser.render !== 'function') return;
  registry.push(parser);
}

export function registerTranscriptBlockParser(parser) {
  addParser(blockParsers, parser);
}

export function registerTranscriptItemParser(parser) {
  addParser(itemParsers, parser);
}

export function clearTranscriptBlockParsers() {
  blockParsers.length = 0;
}

export function clearTranscriptItemParsers() {
  itemParsers.length = 0;
}

export function listTranscriptBlockParsers() {
  return blockParsers.slice();
}

export function listTranscriptItemParsers() {
  return itemParsers.slice();
}

addParser(blockParsers, imageGenerationParser);
addParser(itemParsers, commandExecutionParser);

function createRenderer(registry, context = {}, fallback = () => '') {
  return (entries = []) => {
    if (!Array.isArray(entries) || !entries.length) return '';
    const rendered = entries.map((entry) => {
      const parser = registry.find((candidate) => candidate.canRender(entry));
      if (!parser) return '';
      return parser.render(entry, context, entry);
    });
    return rendered.filter(Boolean).join('\n');
  };
}

export function createTranscriptBlockRenderer(context = {}) {
  return createRenderer(blockParsers, context);
}

export function createTranscriptItemRenderer(context = {}) {
  return createRenderer(itemParsers, context);
}
