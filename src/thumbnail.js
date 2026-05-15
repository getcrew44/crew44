let requestSeq = 0;

export function generateImageThumbnail(input) {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('worker unavailable'));
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./thumbnail.worker.js', import.meta.url), { type: 'module' });
    const id = ++requestSeq;
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('thumbnail timed out'));
    }, 8000);

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.id !== id) return;
      clearTimeout(timeout);
      worker.terminate();
      if (message.ok && message.base64) {
        resolve(message.base64);
      } else {
        reject(new Error(message.error || 'thumbnail failed'));
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event?.message || 'thumbnail worker failed'));
    };

    worker.postMessage({ id, ...input });
  });
}
