/**
 * Auswertungen: Gewinn je verkauftem Fahrzeug und Lagerbestand nach Alter.
 * Die Rechenlogik steht in reports-calc.js; hier nur das Laden.
 */
import { listVehicles } from './vehicles.js'
import { costTotalsByVehicle } from './dashboard.js'
import { salesReport, stockAgeReport } from './reports-calc.js'
import { dayKey } from './dashboard-calc.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function getSalesReport(tenantId, { from, to }) {
  if (!DAY.test(String(from)) || !DAY.test(String(to))) throw new Error('from und to müssen JJJJ-MM-TT sein.')
  if (from > to) throw new Error('Das Von-Datum liegt nach dem Bis-Datum.')
  const [vehicles, costs] = await Promise.all([listVehicles(tenantId), costTotalsByVehicle(tenantId)])
  return salesReport(vehicles, costs, { from, to })
}

export async function getStockReport(tenantId, now = new Date()) {
  const [vehicles, costs] = await Promise.all([listVehicles(tenantId), costTotalsByVehicle(tenantId)])
  return stockAgeReport(vehicles, costs, dayKey(now))
}
