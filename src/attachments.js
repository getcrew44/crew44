import { getDroppedFileEntries } from './dragDrop.js';
import { generateImageThumbnail } from './thumbnail.js';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

export function attachmentsSupported() {
  return Boolean(window.electronAPI?.openFileDialog && window.electronAPI?.getPathInfo);
}

export function extensionForName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const index = base.lastIndexOf('.');
  if (index <= 0 || index === base.length - 1) return '';
  return base.slice(index + 1).toLowerCase();
}

export function attachmentKindForName(name) {
  return IMAGE_EXTS.has(extensionForName(name)) ? 'image' : 'file';
}

export function dedupeAttachments(existing, incoming) {
  const seen = new Set();
  const out = [];
  for (const attachment of [...(existing || []), ...(incoming || [])]) {
    if (!attachment?.path || seen.has(attachment.path)) continue;
    seen.add(attachment.path);
    out.push(attachment);
  }
  return out;
}

export async function pickAttachments() {
  if (!attachmentsSupported()) return [];
  const result = await window.electronAPI.openFileDialog();
  if (result?.canceled || !result.filePaths?.length) return [];
  return buildAttachmentsFromPaths(result.filePaths);
}

export async function droppedAttachments(dataTransfer) {
  if (!attachmentsSupported()) return [];
  const entries = getDroppedFileEntries(dataTransfer);
  if (entries.length === 0) return [];
  const paths = entries.map(entry => entry.path);
  const infos = await window.electronAPI.getPathInfo(paths);
  const fileByPath = new Map(entries.map(entry => [entry.path, entry.file]));
  return buildAttachmentsFromInfos(infos, fileByPath);
}

async function buildAttachmentsFromPaths(paths) {
  const infos = await window.electronAPI.getPathInfo(paths);
  return buildAttachmentsFromInfos(infos, new Map());
}

async function buildAttachmentsFromInfos(infos, fileByPath) {
  const attachments = [];
  for (const info of infos || []) {
    if (!info?.path) continue;
    const displayName = info.name || info.path.split(/[\\/]/).pop() || info.path;
    const kind = info.isDirectory ? 'folder' : attachmentKindForName(displayName);
    const attachment = {
      display_name: displayName,
      path: info.path,
      kind,
    };
    if (kind === 'image') {
      await attachThumbnail(attachment, fileByPath.get(info.path));
    }
    attachments.push(attachment);
  }
  return attachments;
}

async function attachThumbnail(attachment, file) {
  try {
    let input = file ? { file } : null;
    if (!input && window.electronAPI?.readFileDataURL) {
      const dataUrl = await window.electronAPI.readFileDataURL(attachment.path);
      if (dataUrl) input = { dataUrl };
    }
    if (!input) throw new Error('image data unavailable');
    attachment.thumbnail_jpeg_base64 = await generateImageThumbnail(input);
  } catch {
    attachment.thumbnail_failed = true;
  }
}
