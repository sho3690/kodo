// Reads a ZIP's table of contents and opens one entry as a stream, without loading the file into memory.
// A Health export can be several GB, so everything works on Blob slices. Handles ZIP64.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => Number(v.getBigUint64(o, true));
const view = async (blob, start, len) => new DataView(await blob.slice(start, start + len).arrayBuffer());

export async function listZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = await view(blob, blob.size - tailLen, tailLen);
  let e = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not-zip');
  let cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  if (u16(tail, e + 10) === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    const l = e - 20;
    if (l >= 0 && u32(tail, l) === 0x07064b50) {
      const z = await view(blob, u64(tail, l + 8), 56);
      if (u32(z, 0) === 0x06064b50) { cdSize = u64(z, 40); cdOff = u64(z, 48); }
    }
  }
  const cd = await view(blob, cdOff, cdSize);
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  while (p + 46 <= cd.byteLength && u32(cd, p) === 0x02014b50) {
    const method = u16(cd, p + 10);
    let csize = u32(cd, p + 20), size = u32(cd, p + 24), off = u32(cd, p + 42);
    const n = u16(cd, p + 28), x = u16(cd, p + 30), c = u16(cd, p + 32);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, n));
    let q = p + 46 + n;
    const end = q + x;
    while (q + 4 <= end) {
      const id = u16(cd, q), sz = u16(cd, q + 2);
      if (id === 1) {
        let r = q + 4;
        if (size === 0xffffffff) { size = u64(cd, r); r += 8; }
        if (csize === 0xffffffff) { csize = u64(cd, r); r += 8; }
        if (off === 0xffffffff) off = u64(cd, r);
      }
      q += 4 + sz;
    }
    out.push({ name, method, csize, size, off });
    p += 46 + n + x + c;
  }
  return out;
}

// The main file is export.xml, but its name is localized (e.g. 書き出したデータ.xml), so don't rely on the name:
// take the largest .xml that isn't the clinical (CDA) copy.
export function pickExport(entries) {
  const xml = entries.filter(e => /\.xml$/i.test(e.name) && !/cda\.xml$/i.test(e.name) && !/workout-routes|electrocardiograms/i.test(e.name));
  xml.sort((a, b) => b.size - a.size);
  return xml[0] || null;
}

// Returns a stream of the entry's uncompressed bytes. onBytes gets the count of compressed bytes read so far.
export async function openEntry(blob, entry, onBytes) {
  const h = await view(blob, entry.off, 30);
  if (u32(h, 0) !== 0x04034b50) throw new Error('not-zip');
  const start = entry.off + 30 + u16(h, 26) + u16(h, 28);
  let read = 0;
  const counted = blob.slice(start, start + entry.csize).stream().pipeThrough(new TransformStream({
    transform(chunk, ctl) { read += chunk.byteLength; onBytes?.(read); ctl.enqueue(chunk); },
  }));
  if (entry.method === 0) return counted;
  if (entry.method !== 8) throw new Error('zip-method');
  return counted.pipeThrough(new DecompressionStream('deflate-raw'));
}
