// Minimal, dependency-free reader for the .xlsx files Google Sheets exports.
// Only reads what the site needs: tab names/visibility and cell values as strings.
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function unzip(buf) {
  let eocd = -1;
  // EOCD is 22 bytes plus an optional comment of up to 64KB.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`Corrupt zip entry: ${name}`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
  }
  return files;
}

export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

// Concatenates every <t> run, ignoring phonetic (<rPh>) hints.
function textOf(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decodeXml(m[1] ?? '');
  return out;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code) {
  const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(stripped);
}

function readDateStyles(xml) {
  if (!xml) return [];
  const custom = new Map();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    custom.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  return [...cellXfs.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => {
    const id = Number(attrs(m[1]).numFmtId ?? 0);
    return BUILTIN_DATE_FMTS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
  });
}

// Excel serial date (1900 system) -> "YYYY-MM-DD" or "YYYY-MM-DD HH:MM".
export function serialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const iso = new Date(ms).toISOString();
  const hasTime = Math.abs(serial % 1) > 1e-9;
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function readSheetRows(xml, shared, dateStyles) {
  const rows = [];
  let rowIdx = -1;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]);
    rowIdx = ra.r ? Number(ra.r) - 1 : rowIdx + 1;
    const row = [];
    let col = -1;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]);
      col = a.r ? colIndex(a.r) : col + 1;
      const inner = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      switch (a.t) {
        case 's': value = shared[Number(v)] ?? ''; break;
        case 'inlineStr': value = textOf(inner); break;
        case 'b': value = v === '1' ? 'TRUE' : 'FALSE'; break;
        case 'str': case 'e': value = v === undefined ? '' : decodeXml(v); break;
        default:
          if (v !== undefined) {
            const num = Number(v);
            value = dateStyles[Number(a.s ?? 0)] && Number.isFinite(num) ? serialToDate(num) : String(num);
          }
      }
      row[col] = value;
    }
    rows[rowIdx] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

// "../drawings/drawing3.xml" relative to "xl/worksheets/sheet3.xml" -> "xl/drawings/drawing3.xml"
function resolvePart(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function readRels(files, part) {
  const relsPath = part.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = new Map();
  for (const m of (files.get(relsPath)?.toString('utf8') ?? '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.TargetMode !== 'External') rels.set(a.Id, resolvePart(part, a.Target));
  }
  return rels;
}

const IMAGE_TYPES = [
  [(b) => b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG', 'png', 'image/png'],
  [(b) => b[0] === 0xff && b[1] === 0xd8, 'jpg', 'image/jpeg'],
  [(b) => b.toString('latin1', 0, 3) === 'GIF', 'gif', 'image/gif'],
  [(b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP', 'webp', 'image/webp'],
];

// Pixel size from the file header (PNG, JPEG, GIF, WebP); null if unknown.
export function imageSize(b) {
  try {
    if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (b.toString('latin1', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
    if (b.toString('latin1', 8, 12) === 'WEBP') {
      const kind = b.toString('latin1', 12, 16);
      if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
      if (kind === 'VP8L') { const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; }
      return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    }
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch { /* truncated header */ }
  return null;
}

/**
 * Pictures placed on a sheet ("Insert image over/in cell" in Google Sheets export as drawing anchors):
 * [{ row, col, data, ext, type, size }] with 0-based row/col of the anchor's top-left cell.
 */
function readSheetImages(files, sheetPart) {
  const images = [];
  for (const drawingPart of readRels(files, sheetPart).values()) {
    if (!/\/drawings\/[^/]+\.xml$/.test(drawingPart)) continue;
    const xml = files.get(drawingPart)?.toString('utf8') ?? '';
    const media = readRels(files, drawingPart);
    for (const m of xml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:\1>/g)) {
      const from = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(m[2]);
      const embed = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(m[2]);
      const data = embed && files.get(media.get(embed[1]));
      const kind = data && IMAGE_TYPES.find(([test]) => test(data));
      if (!from || !kind) continue;
      images.push({ row: Number(from[2]), col: Number(from[1]), data, ext: kind[1], type: kind[2], size: imageSize(data) });
    }
  }
  return images;
}

/** Parses an .xlsx buffer into [{ name, hidden, rows: string[][], images }] in tab order. */
export function readWorkbook(buf) {
  const files = unzip(buf);
  const read = (path) => files.get(path)?.toString('utf8');

  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('Not an xlsx workbook (missing xl/workbook.xml)');

  const rels = new Map();
  for (const m of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    rels.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }

  const sst = read('xl/sharedStrings.xml') ?? '';
  const shared = [...sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ''));
  const dateStyles = readDateStyles(read('xl/styles.xml'));

  return [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => {
    const a = attrs(m[1]);
    const part = rels.get(a['r:id']);
    const xml = read(part) ?? '';
    return {
      name: a.name,
      hidden: a.state === 'hidden' || a.state === 'veryHidden',
      rows: readSheetRows(xml, shared, dateStyles),
      images: part ? readSheetImages(files, part) : [],
    };
  });
}
