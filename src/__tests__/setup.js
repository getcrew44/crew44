import '@testing-library/jest-dom';

if (typeof window !== 'undefined' && typeof window.localStorage?.clear !== 'function') {
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    },
  });
}
