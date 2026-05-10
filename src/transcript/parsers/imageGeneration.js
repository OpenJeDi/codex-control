import { imageContentTypeFromBase64, imageContentTypeFromSource } from '../utils/contentTypes.js';

function mediaFromImageGenerationSource(candidate, context = {}) {
  const candidateText = String(candidate ?? '').trim();
  if (!candidateText) return null;

  if (candidateText.startsWith('data:')) {
    return context.mediaFromDataUrl?.(candidateText);
  }

  const base64Media = context.mediaFromBase64Data?.(candidateText);
  if (base64Media) return base64Media;

  const localMedia = context.mediaFromLocalFilePath?.(candidateText);
  if (localMedia) return localMedia;

  const resolved = context.resolveMentionedFilePath?.(candidateText, context.cwd);
  const resolvedMedia = resolved ? context.mediaFromLocalFilePath?.(resolved) : null;
  if (resolvedMedia) return resolvedMedia;

  if (/^(?:https?:\/\/|\/api\/media\/|\/api\/media\/[a-f0-9]+$|\/)/i.test(candidateText)) {
    return {
      type: 'image',
      src: candidateText,
      contentType: imageContentTypeFromSource(candidateText) || 'image/png',
    };
  }

  return null;
}

function mediaFromImageGenerationCandidate(candidate, context = {}) {
  if (!candidate) return null;

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const media = mediaFromImageGenerationCandidate(item, context);
      if (media) return media;
    }
    return null;
  }

  if (typeof candidate === 'string') {
    return mediaFromImageGenerationSource(candidate, context);
  }

  if (typeof candidate !== 'object') {
    return null;
  }

  const candidates = [
    candidate.url,
    candidate.imageUrl,
    candidate.image_url,
    candidate.src,
    candidate.path,
    candidate.filePath,
    candidate.file_path,
    candidate.media,
    candidate.result,
    candidate.output,
    candidate.data,
    candidate.b64_json,
    candidate.b64Json,
    candidate.base64,
    candidate.base64Data,
    candidate.base64_data,
    candidate.imageData,
    candidate.image_data,
    candidate.uri,
  ];

  for (const next of candidates) {
    const media = mediaFromImageGenerationCandidate(next, context);
    if (media) return media;
  }

  return null;
}

function collectImageGenerationCandidates(item) {
  if (!item || typeof item !== 'object') return [];

  const keys = [
    'images',
    'image',
    'imageUrl',
    'image_url',
    'output',
    'outputs',
    'result',
    'results',
    'paths',
    'path',
    'files',
    'file',
    'filePath',
    'file_path',
    'src',
    'uri',
    'url',
    'b64_json',
    'b64Json',
    'base64',
    'base64Data',
    'base64_data',
    'imageData',
    'image_data',
    'prompt',
  ];

  const nestedKeys = ['args', 'input', 'payload', 'params', 'parameters'];
  const collected = [];

  for (const key of keys) {
    const value = item[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' || typeof entry === 'object') {
          collected.push(entry);
        }
      }
      continue;
    }
    if (typeof value === 'string' || typeof value === 'object') {
      collected.push(value);
    }
  }

  for (const key of nestedKeys) {
    const value = item[key];
    if (!value || typeof value !== 'object') continue;
    for (const nestedKey of keys) {
      const nestedValue = value[nestedKey];
      if (!nestedValue) continue;
      if (Array.isArray(nestedValue)) {
        for (const entry of nestedValue) {
          if (typeof entry === 'string' || typeof entry === 'object') {
            collected.push(entry);
          }
        }
        continue;
      }
      if (typeof nestedValue === 'string' || typeof nestedValue === 'object') {
        collected.push(nestedValue);
      }
    }
  }

  return collected;
}

function isImageGenerationItem(item) {
  if (!item || typeof item !== 'object') return false;
  const signals = [
    item.type,
    item.kind,
    item.tool,
    item.name,
    item.toolName,
  ].map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean);
  return signals.some((signal) => {
    const compactSignal = signal.replace(/[^a-z0-9]/g, '');
    return compactSignal === 'imagegeneration'
      || compactSignal.startsWith('imagegeneration')
      || ['imagegenerate', 'imagetool'].includes(compactSignal);
  });
}

function hasImageOutput(value) {
  if (!value) return false;
  if (typeof value === 'string') {
    const text = value.trim();
    return text.startsWith('data:image/') || (text.length >= 64 && Boolean(imageContentTypeFromBase64(text)));
  }
  if (Array.isArray(value)) return value.some(hasImageOutput);
  if (typeof value !== 'object') return false;
  const type = String(value.type ?? '').toLowerCase();
  if ((type === 'image' || type === 'input_image') && (value.image_url || value.url || value.src || value.data)) return true;
  return [
    value.image,
    value.images,
    value.imageUrl,
    value.image_url,
    value.output,
    value.outputs,
    value.result,
    value.results,
    value.data,
    value.b64_json,
    value.base64,
    value.imageData,
    value.image_data,
  ].some(hasImageOutput);
}

export const imageGenerationNormalizer = {
  canNormalize(item) {
    return isImageGenerationItem(item) || (item?.type === 'function_call_output' && hasImageOutput(item.output));
  },
  normalize(item, context = {}) {
    const truncate = context.truncate || ((value) => String(value ?? ''));
    const raw = truncate(JSON.stringify(item, null, 2), 6000);
    const candidates = collectImageGenerationCandidates(item);
    const seen = new Set();
    const images = [];

    for (const candidate of candidates) {
      const media = mediaFromImageGenerationCandidate(candidate, context);
      if (!media || !media.src) continue;
      const key = `${media.src}|${media.contentType || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      images.push({
        src: media.src,
        contentType: media.contentType || 'image/png',
        filename: media.filename || '',
        alt: media.filename || '',
      });
    }

    if (!images.length && !raw && !String(item.prompt || '').trim()) return null;

    const prompt = [
      item.prompt,
      item.revisedPrompt,
      item.revised_prompt,
      item.input?.prompt,
      item.input?.revisedPrompt,
      item.input?.revised_prompt,
      item.parameters?.prompt,
      item.parameters?.revisedPrompt,
      item.parameters?.revised_prompt,
      item.task?.prompt,
      item.task?.revisedPrompt,
      item.task?.revised_prompt,
    ].filter(Boolean).map((value) => String(value).trim()).join(' | ');

    return [{
      kind: 'imageGeneration',
      prompt,
      raw,
      images,
    }];
  },
};
