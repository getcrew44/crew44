self.onmessage = async (event) => {
  const { id, file, dataUrl } = event.data || {};
  try {
    let source = file;
    if (!source && dataUrl) {
      const response = await fetch(dataUrl);
      source = await response.blob();
    }
    if (!source) throw new Error('missing image source');

    const bitmap = await createImageBitmap(source);
    const size = 128;
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const x = Math.round((size - width) / 2);
    const y = Math.round((size - height) / 2);

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F8F3E8';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, x, y, width, height);
    bitmap.close?.();

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    self.postMessage({ id, ok: true, base64: btoa(binary) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || 'thumbnail failed' });
  }
};
