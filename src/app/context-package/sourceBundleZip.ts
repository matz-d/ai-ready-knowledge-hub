export type SourceBundleZipFile = {
  fileName: string;
  content: string;
  contentType?: string;
  role?: string;
  originalFileName?: string;
};

export type SourceBundleZipInput = {
  files: SourceBundleZipFile[];
};

const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffff;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

const encoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function uint32(value: number): number {
  if (value > ZIP_MAX_UINT32) {
    throw new Error('source bundle zip is too large');
  }
  return value >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, uint32(value), true);
}

function makeHeader(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function concatenateBytes(parts: Uint8Array[]): ArrayBuffer {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer as ArrayBuffer;
}

function slugForPurpose(purpose: string): string {
  const slug = purpose.slice(0, 30).replace(/[^\w\u3040-\u9fff]/g, '_');
  return slug || 'context-package';
}

export function sourceBundleZipFileName(purpose: string): string {
  return `context-package_sources_${slugForPurpose(purpose)}.zip`;
}

export function createSourceBundleZipBlob(sourceBundle: SourceBundleZipInput): Blob {
  if (sourceBundle.files.length > ZIP_MAX_UINT16) {
    throw new Error('source bundle has too many files');
  }

  const timestamp = dosDateTime(new Date());
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of sourceBundle.files) {
    const fileNameBytes = encoder.encode(file.fileName);
    const contentBytes = encoder.encode(file.content);
    if (fileNameBytes.length > ZIP_MAX_UINT16) {
      throw new Error(`source bundle file name is too long: ${file.fileName}`);
    }

    const checksum = crc32(contentBytes);
    const localHeader = makeHeader(30);
    writeUint32(localHeader.view, 0, 0x04034b50);
    writeUint16(localHeader.view, 4, VERSION_NEEDED);
    writeUint16(localHeader.view, 6, UTF8_FLAG);
    writeUint16(localHeader.view, 8, STORE_METHOD);
    writeUint16(localHeader.view, 10, timestamp.time);
    writeUint16(localHeader.view, 12, timestamp.date);
    writeUint32(localHeader.view, 14, checksum);
    writeUint32(localHeader.view, 18, contentBytes.length);
    writeUint32(localHeader.view, 22, contentBytes.length);
    writeUint16(localHeader.view, 26, fileNameBytes.length);
    writeUint16(localHeader.view, 28, 0);

    localParts.push(localHeader.bytes, fileNameBytes, contentBytes);

    const centralHeader = makeHeader(46);
    writeUint32(centralHeader.view, 0, 0x02014b50);
    writeUint16(centralHeader.view, 4, VERSION_MADE_BY);
    writeUint16(centralHeader.view, 6, VERSION_NEEDED);
    writeUint16(centralHeader.view, 8, UTF8_FLAG);
    writeUint16(centralHeader.view, 10, STORE_METHOD);
    writeUint16(centralHeader.view, 12, timestamp.time);
    writeUint16(centralHeader.view, 14, timestamp.date);
    writeUint32(centralHeader.view, 16, checksum);
    writeUint32(centralHeader.view, 20, contentBytes.length);
    writeUint32(centralHeader.view, 24, contentBytes.length);
    writeUint16(centralHeader.view, 28, fileNameBytes.length);
    writeUint16(centralHeader.view, 30, 0);
    writeUint16(centralHeader.view, 32, 0);
    writeUint16(centralHeader.view, 34, 0);
    writeUint16(centralHeader.view, 36, 0);
    writeUint32(centralHeader.view, 38, 0);
    writeUint32(centralHeader.view, 42, offset);

    centralParts.push(centralHeader.bytes, fileNameBytes);
    offset += localHeader.bytes.length + fileNameBytes.length + contentBytes.length;
    uint32(offset);
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce(
    (sum, part) => sum + part.length,
    0,
  );
  uint32(centralDirectoryOffset + centralDirectorySize);

  const endOfCentralDirectory = makeHeader(22);
  writeUint32(endOfCentralDirectory.view, 0, 0x06054b50);
  writeUint16(endOfCentralDirectory.view, 4, 0);
  writeUint16(endOfCentralDirectory.view, 6, 0);
  writeUint16(endOfCentralDirectory.view, 8, sourceBundle.files.length);
  writeUint16(endOfCentralDirectory.view, 10, sourceBundle.files.length);
  writeUint32(endOfCentralDirectory.view, 12, centralDirectorySize);
  writeUint32(endOfCentralDirectory.view, 16, centralDirectoryOffset);
  writeUint16(endOfCentralDirectory.view, 20, 0);

  const zipBytes = concatenateBytes([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory.bytes,
  ]);

  return new Blob([zipBytes], {
    type: 'application/zip',
  });
}

export function downloadSourceBundleZip(
  sourceBundle: SourceBundleZipInput,
  purpose: string,
) {
  const blob = createSourceBundleZipBlob(sourceBundle);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sourceBundleZipFileName(purpose);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
