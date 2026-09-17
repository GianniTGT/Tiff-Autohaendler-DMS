/**
 * Phase 3 (ANFORDERUNGEN.md §9): echter Objektspeicher für archivierte PDFs,
 * nicht mehr nur ihr Hash.
 *
 * **Warum das eine echte Korrektur ist, nicht nur eine Ergänzung:** Phase 2s
 * Belegarchiv (archive.js) verglich beim erneuten Abruf einen frisch
 * gerenderten Hash mit dem gespeicherten — das funktioniert nur, solange
 * sich der PDF-Rendering-Code nie ändert. Ein künftiger Tippfehler-Fix im
 * Layout hätte bei JEDER historischen Rechnung `ArchiveIntegrityError`
 * ausgelöst, obwohl inhaltlich nichts falsch war. Die eigentliche Korrektur
 * ist deshalb im Ablauf (archive.js, routes/invoices.js): einmal
 * archiviert, kommt das PDF beim nächsten Abruf aus dem Speicher, nicht aus
 * einer erneuten Erzeugung. `pdf_storage_key` ist, WO es liegt.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumn('documents', {
    pdf_storage_key: { type: 'text' },
  })
}

export async function down(pgm) {
  pgm.dropColumn('documents', 'pdf_storage_key')
}
