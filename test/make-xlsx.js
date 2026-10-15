// Test helper: writes an .xlsx shaped like Google Sheets' export
// (shared strings, a date-formatted style, explicit cell refs, deflated zip entries).
import { deflateRawSync, crc32 } from 'node:zlib';

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/**
 * sheets: [{ name, hidden?, rows: (string | number | boolean | { date: number } | null)[][] }]
 * { date: n } writes serial n with a date number format, like a typed-in date in Google Sheets.
 */
export function makeXlsx(sheets) {
  const shared = [];
  const sharedIdx = new Map();
  const si = (s) => {
    if (!sharedIdx.has(s)) { sharedIdx.set(s, shared.length); shared.push(s); }
    return sharedIdx.get(s);
  };

  const sheetXml = sheets.map(({ rows }) => {
    const rowXml = rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${colName(c)}${r + 1}`;
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number') return `<c r="${ref}" s="0"><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" s="0" t="b"><v>${v ? 1 : 0}</v></c>`;
        if (typeof v === 'object') return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
        return `<c r="${ref}" s="0" t="s"><v>${si(v)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
  });

  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const entries = [
    ['xl/workbook.xml', `<?xml version="1.0"?>\r<workbook ${ns}><sheets>${sheets.map((s, i) =>
      `<sheet state="${s.hidden ? 'hidden' : 'visible'}" name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 10}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?>\r<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) =>
      `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0"?>\r<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ...sheetXml.map((xml, i) => [`xl/worksheets/sheet${i + 1}.xml`, xml]),
  ];
  // Shared strings are built while generating sheets, so add them last.
  entries.push(['xl/sharedStrings.xml', `<?xml version="1.0"?>\r<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`]);
  return zip(entries);
}
