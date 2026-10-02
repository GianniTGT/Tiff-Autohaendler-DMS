/**
 * Übersicht (Dashboard) — liest Fahrzeuge, Kosten und überfällige Rechnungen
 * und reicht sie an die reine Rechenlogik in dashboard-calc.js weiter.
 */
import { withTenant } from '@tiff/core-db'
import { canSeeCompanyTotals } from '@tiff/core-auth'
import { listVehicles } from './vehicles.js'
import { listOverdueInvoices } from './reminders.js'
import { summarizeDashboard, dayKey } from './dashboard-calc.js'
import { countNewLeads } from './leads.js'
import { countOpenJobs } from './recon.js'

export async function costTotalsByVehicle(tenantId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT vehicle_id, SUM(amount_rappen) AS total FROM vehicle_costs GROUP BY vehicle_id')
    return new Map(result.rows.map((r) => [r.vehicle_id, Number(r.total)]))
  })
}

export async function getDashboard(tenantId, role, now = new Date()) {
  const today = dayKey(now)
  const canSeeTotals = canSeeCompanyTotals(role)
  const [vehicles, costsByVehicle, overdue, newLeads, jobs] = await Promise.all([
    listVehicles(tenantId),
    costTotalsByVehicle(tenantId),
    listOverdueInvoices(tenantId, today),
    countNewLeads(tenantId),
    countOpenJobs(tenantId, today),
  ])
  const summary = summarizeDashboard(vehicles, costsByVehicle, { today, canSeeTotals })
  return {
    ...summary,
    overdueInvoices: {
      count: overdue.length,
      outstandingRappen: canSeeTotals ? overdue.reduce((s, i) => s + i.outstandingRappen, 0) : null,
    },
    newLeads,
    openJobs: jobs,
    canSeeTotals,
  }
}
