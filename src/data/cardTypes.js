// Karten-/SIM-Typen (nur Enum/Labels – keine personenbezogenen Daten).

export const CARD_TYPES = [
  { id: 'pluskarte', label: 'PlusKarte' },
  { id: 'multisim', label: 'MultiSIM' }
];

export function cardTypeLabel(id) {
  return (CARD_TYPES.find((c) => c.id === id) || {}).label || id || '';
}

// Verwendungsart der Karte (eSIM / physische SIM).
export const SIM_KINDS = [
  { id: 'sim', label: 'SIM-Karte' },
  { id: 'esim', label: 'eSIM' }
];

export function simKindLabel(id) {
  return (SIM_KINDS.find((c) => c.id === id) || {}).label || id || '';
}
