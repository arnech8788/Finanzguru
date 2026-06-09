// Reine Abgleich-Logik: Rechnungspositionen -> Personen, Pro-Person-Soll/Ist.
// DOM-frei, testbar wie match.js.
//
// Zuordnung einer Position zu einer Person:
//   1. Karte mit gleicher SIM-/Profilnummer (alnum-normalisiert)
//   2. Karte mit gleicher Rufnummer (nur Ziffern)
//   3. gelernte Zuordnung in invoiceMap ('sim:'+… / 'tel:'+…)
//   4. sonst null (unzugeordnet)

export function normSim(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function normPhone(s) {
  return String(s ?? '').replace(/\D/g, '');
}

export function resolvePosition(pos, people, invoiceMap = {}) {
  const ps = normSim(pos.simNr);
  const pp = normPhone(pos.phone);
  if (ps) {
    for (const p of people) for (const c of (p.cards || [])) {
      if (normSim(c.simNr) && normSim(c.simNr) === ps) return p.id;
    }
  }
  if (pp) {
    for (const p of people) for (const c of (p.cards || [])) {
      if (normPhone(c.phone) && normPhone(c.phone) === pp) return p.id;
    }
  }
  if (ps && invoiceMap['sim:' + ps]) return invoiceMap['sim:' + ps];
  if (pp && invoiceMap['tel:' + pp]) return invoiceMap['tel:' + pp];
  return null;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Abgleich einer Rechnung gegen die geleisteten Rückzahlungen (Ledger) ihres Monats.
export function reconcileInvoice(invoice, people = [], ledger = {}, invoiceMap = {}, tol = 0.5) {
  const byPerson = new Map();
  const unassigned = [];

  for (const pos of (invoice.positions || [])) {
    const pid = resolvePosition(pos, people, invoiceMap);
    const amt = Number(pos.subtotal) || 0;
    if (!pid) { unassigned.push({ pos, amount: amt }); continue; }
    byPerson.set(pid, (byPerson.get(pid) || 0) + amt);
  }

  const rows = [];
  for (const [pid, invoicedRaw] of byPerson) {
    const person = people.find((p) => p.id === pid);
    const invoiced = round2(invoicedRaw);
    const received = round2(((ledger[pid] || {})[invoice.month] || {}).received || 0);
    const diff = round2(received - invoiced);
    let status;
    if (invoiced > 0 && received <= 0) status = 'open';
    else if (Math.abs(diff) <= tol) status = 'paid';
    else if (diff < 0) status = 'partial';   // unterdeckt
    else status = 'advance';                  // überdeckt
    rows.push({ personId: pid, name: person ? (person.name || '(ohne Name)') : '(unbekannt)', invoiced, received, diff, status });
  }

  const order = { open: 0, partial: 1, advance: 2, paid: 3 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || (a.name || '').localeCompare(b.name || '', 'de'));

  const sumInvoiced = round2(rows.reduce((s, r) => s + r.invoiced, 0) + unassigned.reduce((s, u) => s + u.amount, 0));
  const sumReceived = round2(rows.reduce((s, r) => s + r.received, 0));
  return { rows, unassigned, month: invoice.month, sumInvoiced, sumReceived, total: invoice.total };
}
