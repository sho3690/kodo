// Reads a Health export (export.zip, or the export.xml inside it) and returns the per-day numbers.
// Runs entirely on this device. Used from the background worker, and directly as a fallback.
import { listZip, pickExport, openEntry } from './zip.js';
import { createAggregator } from './parse.js';

export async function runImport(file, onProgress) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  let stream, total, read = 0;
  if (isZip) {
    const entry = pickExport(await listZip(file));
    if (!entry) throw new Error('no-export');
    total = entry.csize;
    stream = await openEntry(file, entry, n => { read = n; });
  } else {
    total = file.size;
    stream = file.stream().pipeThrough(new TransformStream({ transform(c, ctl) { read += c.byteLength; ctl.enqueue(c); } }));
  }
  const agg = createAggregator();
  const dec = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    agg.feed(dec.decode(value, { stream: true }));
    const now = Date.now();
    if (now - last > 200) { last = now; onProgress?.({ ratio: total ? Math.min(1, read / total) : 0, records: agg.records }); }
  }
  agg.feed(dec.decode());
  const data = agg.finish();
  if (!data.meta.from) throw new Error('empty');
  onProgress?.({ ratio: 1, records: agg.records });
  return data;
}
