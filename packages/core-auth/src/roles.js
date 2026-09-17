/**
 * Rollen — angepasst, nicht aus Tiff-Cardealer-Manager (US) übernommen.
 *
 * Das US-Repo kennt nur zwei Rollen (`manager`/`sales`), zugeschnitten auf
 * einen einzelnen US-Autohändler mit Verkaufspersonal. SCHWEIZ-SAAS.md §1.4
 * sagt ausdrücklich: "Eine Garage hat Inhaber, Verkauf, Werkstatt,
 * Buchhaltung. Nicht übernehmen — fragen." Die vier Rollen hier sind eine
 * vorläufige Annahme für Phase 1 und mit dem Piloten (Sabit Kadriu,
 * ImmoBit AG) zu bestätigen — siehe ANFORDERUNGEN.md §8/§10.
 *
 * Was UNVERÄNDERT aus dem US-Repo übernommen wird, ist die Disziplin dahinter
 * (lib/roles.js dort, §6 dessen CLAUDE.md): eine Sichtbarkeitsregel gehört an
 * eine Stelle — eine Funktion wie canSeeCompanyTotals() — statt als
 * `role !== 'x'` über mehrere Bildschirme verteilt zu werden.
 */

export const ROLES = Object.freeze(['inhaber', 'verkauf', 'werkstatt', 'buchhaltung'])

export function isAssignableRole(role) {
  return ROLES.includes(role)
}

/**
 * Wer sieht Einkaufspreise, Marge und die Firmen-Summen? Vorläufig: Inhaber
 * und Buchhaltung ja, Verkauf und Werkstatt nein — analog zur Geld-Sichtbarkeit
 * im US-Repo, aber SCHWEIZ-SAAS.md §1.4 warnt ausdrücklich: "Ein Betrieb mit
 * drei Leuten will das vielleicht gar nicht." Diese Funktion ist bewusst der
 * einzige Ort, an dem diese Regel steht, damit sie beim Piloten-Feedback an
 * einer Stelle geändert werden kann.
 */
export function canSeeCompanyTotals(role) {
  return role === 'inhaber' || role === 'buchhaltung'
}
