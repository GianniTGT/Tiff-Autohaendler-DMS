/**
 * Minimaler ZIP-Schreiber (nur "stored", ohne Kompression): PDFs sind bereits
 * komprimiert, und so braucht der Archiv-Export keine zusätzliche
 * Abhängigkeit. Entspricht dem ZIP-Format ohne ZIP64 — gedacht für das
 * Belegarchiv eines Kleinbetriebs, nicht für Datenmengen über 4 GB.
 */
import { crc32 } from 'node:zlib'

const u16 = (n) => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}

/** MS-DOS-Datum/-Zeit, wie das ZIP-Format sie verlangt. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

/**
 * @param {{name: string, data: Buffer}[]} files  Namen mit '/' als Trenner; UTF-8
 * @returns {Buffer}
 */
export function createZip(files, now = new Date()) {
  const { time, day } = dosDateTime(now)
  const parts = []
  const central = []
  let offset = 0

  for (const file of files) {
    if (file.data.length > 0xfffffffe) throw new Error(`Datei ${file.name} ist für ZIP ohne ZIP64 zu gross.`)
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const flags = 0x0800 // Dateinamen sind UTF-8
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(0), u16(time), u16(day),
      u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name,
    ])
    parts.push(local, file.data)
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(time), u16(day),
        u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name,
      ]),
    )
    offset += local.length + file.data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBuffer.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...parts, centralBuffer, end])
}
