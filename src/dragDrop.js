export function dataTransferHasFiles(dataTransfer) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes('Files');
}

function collectDroppedPaths(dataTransfer) {
  const paths = [];
  const seen = new Set();

  const addPath = (file) => {
    if (!file) return;
    let filePath = file.path || '';
    try {
      filePath ||= window.electronAPI?.getPathForFile?.(file) || '';
    } catch {
      filePath = '';
    }
    if (!filePath || seen.has(filePath)) return;
    seen.add(filePath);
    paths.push(filePath);
  };

  for (const item of Array.from(dataTransfer?.items || [])) {
    if (item.kind !== 'file') continue;
    addPath(item.getAsFile?.());
  }

  for (const file of Array.from(dataTransfer?.files || [])) {
    addPath(file);
  }

  return paths;
}

export async function getDroppedDirectoryPaths(dataTransfer) {
  const paths = collectDroppedPaths(dataTransfer);
  if (paths.length === 0) return [];

  if (window.electronAPI?.getPathInfo) {
    const infos = await window.electronAPI.getPathInfo(paths);
    return infos
      .filter(info => info?.isDirectory && info.path)
      .map(info => info.path);
  }

  const entries = Array.from(dataTransfer?.items || [])
    .map(item => item.webkitGetAsEntry?.())
    .filter(entry => entry?.isDirectory);

  if (entries.length === 0) return [];
  return paths.slice(0, entries.length);
}
