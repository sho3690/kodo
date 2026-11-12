// Background worker: keeps the screen responsive while a large export is read.
import { runImport } from './importer.js';

self.onmessage = async e => {
  try {
    const data = await runImport(e.data.file, p => self.postMessage({ type: 'progress', ...p }));
    self.postMessage({ type: 'done', data });
  } catch (err) {
    self.postMessage({ type: 'error', code: String(err?.message || 'unknown') });
  }
};
