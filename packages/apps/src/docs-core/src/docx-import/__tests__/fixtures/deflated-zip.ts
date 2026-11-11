import { crc32, deflateRawSync } from "node:zlib";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DEFLATE = 8;
const VERSION = 20;

/**
 * Zip `entries` with Node's native deflate, in the layout fflate's `zipSync`
 * writes: each local header and its data, the central directory, then the end
 * record. No extra fields, comments, or timestamps.
 *
 * For zip bombs: fflate's JavaScript deflate takes seconds per 256 MiB, and
 * more than 30 under v8 coverage on CI. Native deflate takes a fraction of a second.
 */
export function deflatedZip(entries: Record<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of Object.entries(entries)) {
    const nameBytes = new TextEncoder().encode(name);
    const deflated = deflateRawSync(data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_SIGNATURE, true);
    localView.setUint16(4, VERSION, true);
    localView.setUint16(8, DEFLATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, deflated.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const record = new Uint8Array(46 + nameBytes.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, CENTRAL_SIGNATURE, true);
    recordView.setUint16(4, VERSION, true);
    recordView.setUint16(6, VERSION, true);
    recordView.setUint16(10, DEFLATE, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, deflated.length, true);
    recordView.setUint32(24, data.length, true);
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint32(42, offset, true);
    record.set(nameBytes, 46);

    parts.push(local, deflated);
    central.push(record);
    offset += local.length + deflated.length;
  }

  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, EOCD_SIGNATURE, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const zip = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    zip.set(part, at);
    at += part.length;
  }
  return zip;
}
