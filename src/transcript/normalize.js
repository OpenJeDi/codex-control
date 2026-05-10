import { imageGenerationNormalizer } from './parsers/imageGeneration.js';
import { textFromContent, truncate } from './utils/text.js';

export { textFromContent, truncate } from './utils/text.js';

const blockNormalizers = [
  imageGenerationNormalizer,
];

function normalizeItemContentParts(content, context = {}) {
  if (!Array.isArray(content)) return [];
  return content.map((part) => {
    const type = String(part?.type ?? '').toLowerCase();
    if (type === 'text' || type === 'input_text' || part?.text || part?.value) {
      const text = part?.text ?? part?.value ?? '';
      return text ? { type: 'text', text: truncate(text) } : null;
    }
    if (type === 'image' || type === 'input_image') {
      const media = context.mediaFromDataUrl?.(part?.url ?? part?.image_url);
      return media ? { ...media, detail: part?.detail } : { type: 'unsupportedImage' };
    }
    if (type === 'localimage' || type === 'local_image') {
      const media = context.mediaFromLocalFilePath?.(part?.path ?? part?.filePath ?? part?.file_path);
      return media ? { type: 'image', ...media, detail: part?.detail, filename: media.filename } : { type: 'unsupportedImage' };
    }
    return null;
  }).filter(Boolean);
}

function mergeTurnAttachments(items, attachments = []) {
  if (!attachments.length) return items;
  const userIndex = items.findIndex((item) => item.type === 'userMessage');
  if (userIndex === -1) return items;
  const next = [...items];
  const userItem = next[userIndex];
  const existingParts = Array.isArray(userItem.parts) ? userItem.parts : [];
  const existingSrcs = new Set(existingParts.map((part) => part.src).filter(Boolean));
  const attachmentParts = attachments.filter((attachment) => !existingSrcs.has(attachment.src));
  next[userIndex] = { ...userItem, parts: [...existingParts, ...attachmentParts] };
  return next;
}

export function createTranscriptNormalizer(context = {}) {
  const normalizerContext = { ...context, truncate };

  function normalizeTranscriptItem(item, cwd = '') {
    const type = item.type ?? 'unknown';
    const base = { id: item.id ?? item.call_id ?? item.callId, type };
    const itemContext = { ...normalizerContext, cwd };

    if (type === 'userMessage') {
      return {
        ...base,
        text: truncate(textFromContent(item.content)),
        parts: normalizeItemContentParts(item.content, itemContext),
      };
    }
    if (type === 'agentMessage') {
      return {
        ...base,
        phase: item.phase,
        text: truncate(context.rewriteLocalFileReferences?.(item.text, cwd) ?? item.text),
      };
    }
    if (type === 'commandExecution') {
      return {
        ...base,
        command: item.command ?? item.cmd ?? item.argv?.join(' '),
        status: item.status,
        exitCode: item.exitCode,
        output: truncate(item.output ?? item.stdout ?? item.stderr ?? '', 8000),
      };
    }
    if (type === 'reasoning') {
      return {
        ...base,
        text: truncate(context.rewriteLocalFileReferences?.(item.text ?? item.summary ?? '', cwd) ?? (item.text ?? item.summary ?? '')),
      };
    }

    for (const normalizer of blockNormalizers) {
      if (!normalizer.canNormalize(item, itemContext)) continue;
      const renderBlocks = normalizer.normalize(item, itemContext);
      if (!renderBlocks) continue;
      return {
        ...base,
        text: truncate(JSON.stringify(item, null, 2), 6000),
        renderBlocks,
      };
    }

    const json = JSON.stringify(item, null, 2);
    return { ...base, text: truncate(json, 6000) };
  }

  function normalizeTranscriptTurn(turn, steeredMessages = [], attachments = [], cwd = '') {
    return {
      id: turn.id,
      status: turn.status,
      error: turn.error,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs: turn.durationMs,
      model: context.extractModelFromPayload?.(turn) ?? '',
      effort: context.extractEffortFromPayload?.(turn) ?? '',
      steeredMessages: steeredMessages.filter((message) => message.turnId === turn.id),
      items: mergeTurnAttachments((turn.items ?? []).map((item) => normalizeTranscriptItem(item, cwd)), attachments),
    };
  }

  return {
    normalizeTranscriptItem,
    normalizeTranscriptTurn,
  };
}
