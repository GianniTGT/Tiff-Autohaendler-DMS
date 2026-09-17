import { createTranslator } from '@tiff/core-ui'
import de from './de.json'

/**
 * Nur Deutsch — kein Umschalter. Siehe ANFORDERUNGEN.md §1 und
 * packages/core-ui/src/i18n.js für die Begründung gegenüber dem
 * US-Repo-Muster mit Region-Umschalter.
 */
export const t = createTranslator(de)
