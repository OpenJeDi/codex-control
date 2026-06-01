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
      const media = context.mediaFromLocalFilePath?.(part?.path ?? part?.filePath ?? part?.file_path, context.mediaPolicy);
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

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function createTranscriptNormalizer(context = {}) {
  const normalizerContext = { ...context, truncate };

  function normalizeTranscriptItem(rawItem, cwd = '', mediaPolicy = {}, itemOptions = {}) {
    const item = unwrapTranscriptItem(rawItem);
    const rawType = item.type ?? 'unknown';
    const role = String(item.role ?? '').toLowerCase();
    const type = rawType === 'message' && role === 'user'
      ? 'userMessage'
      : rawType === 'message' && role === 'assistant' ? 'agentMessage' : rawType;
    const base = { id: item.id ?? item.call_id ?? item.callId, type };
    const resolveRoots = uniqueValues([
      cwd,
      mediaPolicy.cwd,
      ...(Array.isArray(mediaPolicy.resolveRoots) ? mediaPolicy.resolveRoots : []),
      ...(Array.isArray(mediaPolicy.resolveCwds) ? mediaPolicy.resolveCwds : []),
      ...(Array.isArray(itemOptions.resolveRoots) ? itemOptions.resolveRoots : []),
      ...(Array.isArray(itemOptions.resolveCwds) ? itemOptions.resolveCwds : []),
      item.cwd,
      item.workdir,
      item.workDir,
    ]);
    const itemMediaPolicy = {
      ...mediaPolicy,
      cwd: mediaPolicy.cwd || cwd,
      resolveRoots,
      resolveCwds: resolveRoots,
      allowedRoots: uniqueValues([
        ...(Array.isArray(mediaPolicy.allowedRoots) ? mediaPolicy.allowedRoots : []),
        ...resolveRoots,
      ]),
    };
    const itemContext = { ...normalizerContext, cwd, mediaPolicy: itemMediaPolicy };

    if (type === 'userMessage') {
      return {
        ...base,
        text: truncate(textFromContent(item.content) || item.text || ''),
        parts: normalizeItemContentParts(item.content, itemContext),
      };
    }
    if (type === 'agentMessage') {
      const text = item.text ?? textFromContent(item.content);
      return {
        ...base,
        phase: item.phase,
        text: truncate(context.rewriteLocalFileReferences?.(text, cwd, itemContext.mediaPolicy) ?? text),
      };
    }
    if (type === 'commandExecution') {
      return {
        ...base,
        command: item.command ?? item.cmd ?? item.argv?.join(' '),
        cwd: item.cwd ?? item.workdir ?? item.workDir ?? '',
        status: item.status,
        exitCode: item.exitCode,
        output: truncate(context.rewriteLocalFileReferences?.(item.output ?? item.stdout ?? item.stderr ?? '', cwd, itemMediaPolicy) ?? (item.output ?? item.stdout ?? item.stderr ?? ''), 8000),
      };
    }
    if (type === 'reasoning') {
      return {
        ...base,
        text: truncate(context.rewriteLocalFileReferences?.(item.text ?? item.summary ?? '', cwd, itemContext.mediaPolicy) ?? (item.text ?? item.summary ?? '')),
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

  function normalizeTranscriptTurn(turn, steeredMessages = [], attachments = [], cwd = '', mediaPolicy = {}) {
    const rawItems = turn.items ?? [];
    const commandCalls = new Map();
    const commandCwds = [];
    const normalizedItems = [];

    for (const rawItem of rawItems) {
      const item = unwrapTranscriptItem(rawItem);
      const call = commandCallFromItem(item);
      if (call) {
        if (call.id) commandCalls.set(call.id, call);
        if (call.cwd) commandCwds.push(call.cwd);
        continue;
      }
      const output = commandOutputFromItem(item, commandCalls);
      if (output) {
        if (output.cwd) commandCwds.push(output.cwd);
        normalizedItems.push(normalizeTranscriptItem(output, cwd, mediaPolicy, { resolveRoots: commandCwds }));
        continue;
      }
      normalizedItems.push(normalizeTranscriptItem(item, cwd, mediaPolicy, { resolveRoots: commandCwds }));
    }

    for (const call of commandCalls.values()) {
      if (call.seenOutput) continue;
      normalizedItems.push(normalizeTranscriptItem({
        type: 'commandExecution',
        id: call.id,
        command: call.command,
        cwd: call.cwd,
        status: call.status,
        output: '',
      }, cwd, mediaPolicy, { resolveRoots: commandCwds }));
    }

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
      items: mergeTurnAttachments(normalizedItems, attachments),
    };
  }

  return {
    normalizeTranscriptItem,
    normalizeTranscriptTurn,
  };
}

function unwrapTranscriptItem(item) {
  return item?.payload && typeof item.payload === 'object' ? item.payload : item;
}

function commandCallFromItem(item = {}) {
  const type = String(item.type ?? '').toLowerCase();
  if (type !== 'function_call' && type !== 'custom_tool_call') return null;
  const name = String(item.name ?? item.toolName ?? item.tool_name ?? '').trim();
  const parsed = parseToolArguments(item.arguments ?? item.input);
  const command = commandTextForToolCall(name, parsed, item);
  if (!command && !name) return null;
  return {
    id: item.call_id ?? item.callId ?? item.id ?? '',
    name,
    command,
    cwd: String(parsed.workdir ?? parsed.cwd ?? item.cwd ?? item.workdir ?? '').trim(),
    status: item.status,
    seenOutput: false,
  };
}

function commandOutputFromItem(item = {}, calls = new Map()) {
  const type = String(item.type ?? '').toLowerCase();
  if (type !== 'function_call_output' && type !== 'custom_tool_call_output') return null;
  const callId = item.call_id ?? item.callId ?? item.id ?? '';
  const call = calls.get(callId) ?? {};
  if (callId && calls.has(callId)) call.seenOutput = true;
  return {
    type: 'commandExecution',
    id: callId,
    command: call.command || call.name || '',
    cwd: call.cwd || '',
    status: item.status ?? call.status,
    output: outputTextFromToolItem(item),
  };
}

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function commandTextForToolCall(name, parsed = {}, item = {}) {
  if (parsed.command) return String(parsed.command);
  if (parsed.input && typeof parsed.input === 'string') return parsed.input;
  if (name) return `${name}${item.arguments ? ` ${String(item.arguments)}` : ''}`.trim();
  return '';
}

function outputTextFromToolItem(item = {}) {
  const output = item.output ?? item.result ?? item.content ?? '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return textFromContent(output) || JSON.stringify(output, null, 2);
  if (output && typeof output === 'object') return JSON.stringify(output, null, 2);
  return String(output ?? '');
}
