import path from 'node:path';

function imageGenerationContentTypeFromSource(source) {
  const clean = String(source ?? '').split('?')[0].toLowerCase();
  const ext = path.extname(clean).replace('.', '');
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  }[ext] || null;
}

function mediaFromImageGenerationSource(candidate, context = {}) {
  const candidateText = String(candidate ?? '').trim();
  if (!candidateText) return null;

  if (candidateText.startsWith('data:')) {
    return context.mediaFromDataUrl?.(candidateText);
  }

  const localMedia = context.mediaFromLocalFilePath?.(candidateText);
  if (localMedia) return localMedia;

  const resolved = context.resolveMentionedFilePath?.(candidateText, context.cwd);
  const resolvedMedia = resolved ? context.mediaFromLocalFilePath?.(resolved) : null;
  if (resolvedMedia) return resolvedMedia;

  if (/^(?:https?:\/\/|\/api\/media\/|\/api\/media\/[a-f0-9]+$|\/)/i.test(candidateText)) {
    return {
      type: 'image',
      src: candidateText,
      contentType: imageGenerationContentTypeFromSource(candidateText) || 'image/png',
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
  const type = String(item.type ?? '').trim().toLowerCase();
  const kind = String(item.kind ?? '').trim().toLowerCase();
  const tool = String(item.tool ?? item.name ?? item.toolName ?? '').trim().toLowerCase();
  return [type, kind, tool].includes('imagegeneration')
    || ['image_generation', 'imagegenerate', 'imagetool'].includes(tool)
    || type.startsWith('imagegeneration');
}

export const imageGenerationNormalizer = {
  canNormalize(item) {
    return isImageGenerationItem(item);
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
      item.input?.prompt,
      item.parameters?.prompt,
      item.task?.prompt,
    ].filter(Boolean).map((value) => String(value).trim()).join(' | ');

    return [{
      kind: 'imageGeneration',
      prompt,
      raw,
      images,
    }];
  },
};
