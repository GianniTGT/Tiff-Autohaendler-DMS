#!/usr/bin/env node
/**
 * Platzhalter-Logo für den Demo-Betrieb — ein PNG ohne Abhängigkeiten: Schriftzug aus einer kleinen
 * 5×7-Pixelschrift (nur Grossbuchstaben, Ziffern, Leerzeichen, Punkt, Bindestrich), Tiff-Grün auf Weiss
 * mit goldener Linie. Gut genug, damit die Seitenleiste und der Briefkopf der PDFs ein Logo zeigen;
 * ein echter Betrieb lädt sein eigenes unter Einstellungen hoch.
 *
 * Als Modul: `demoLogoPng('GARAGE AAREFELD')` → Buffer.
 * Als Skript: `node --env-file=../../../.env scripts/demo-logo.mjs --slug=demo [--text="GARAGE AAREFELD"]`
 * setzt das Logo an einem bestehenden Betrieb.
 */
import zlib from 'node:zlib'

// 5 Spalten × 7 Zeilen, als 7 Strings pro Zeichen; '#' ist ein gesetzter Pixel.
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  Ä: ['#...#', '.###.', '#...#', '#####', '#...#', '#...#', '#...#'],
  Ö: ['#...#', '.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  Ü: ['#...#', '.....', '#...#', '#...#', '#...#', '#...#', '.###.'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '####.', '#...#', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(typeAndData) >>> 0)
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(width, height, px) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * @param {string} text  eine oder zwei Zeilen (Trennung mit '\n'), nur Zeichen aus FONT
 * @returns {Buffer} PNG
 */
export function demoLogoPng(text) {
  const lines = String(text).toUpperCase().split('\n').slice(0, 2)
  const scale = 6 // Pixelgrösse eines Schrift-Pixels
  const letterW = 6 * scale // 5 Pixel + 1 Abstand
  const lineH = 7 * scale
  const pad = 24
  const barH = 8
  const widest = Math.max(...lines.map((l) => l.length))
  const width = pad * 2 + widest * letterW
  const height = pad * 2 + lines.length * lineH + (lines.length - 1) * scale * 2 + barH + scale * 2
  const px = Buffer.alloc(width * height * 3, 255) // Weiss
  const green = [15, 74, 44]
  const gold = [201, 160, 83]
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 3
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
  }
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c)
  }
  lines.forEach((line, li) => {
    const y0 = pad + li * (lineH + scale * 2)
    const x0 = pad + Math.round(((widest - line.length) * letterW) / 2) // zentriert
    for (const [ci, ch] of [...line].entries()) {
      const glyph = FONT[ch] ?? FONT[' ']
      glyph.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) {
          if (row[rx] === '#') rect(x0 + ci * letterW + rx * scale, y0 + ry * scale, x0 + ci * letterW + (rx + 1) * scale, y0 + (ry + 1) * scale, green)
        }
      })
    }
  })
  rect(pad, height - pad - barH, width - pad, height - pad, gold)
  return encodePng(width, height, px)
}

// ---- als Skript: Logo an einem bestehenden Betrieb setzen
const isMain = process.argv[1] && /demo-logo\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))
if (isMain) {
  const arg = (name, fallback) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`))
    return found ? found.slice(name.length + 3) : fallback
  }
  const slug = arg('slug')
  if (!slug) {
    console.error('Braucht --slug=<Betrieb>. Optional --text="ZEILE 1\\nZEILE 2".')
    process.exit(1)
  }
  const pg = (await import('pg')).default
  const { setLogo } = await import('../src/services/tenant-logo.js')
  const { closePool } = await import('@tiff/core-db')
  const pool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  try {
    const row = (await pool.query('SELECT id, name FROM tenants WHERE slug = $1', [slug])).rows[0]
    if (!row) throw new Error(`Kein Betrieb mit Slug '${slug}'.`)
    const text = arg('text', row.name)
    await setLogo(row.id, demoLogoPng(text))
    console.log(`Logo gesetzt für '${row.name}' (${slug}): «${text.replace('\n', ' / ')}»`)
  } finally {
    await pool.end()
    await closePool()
  }
}
