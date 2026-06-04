// Zahlungsarten (nur Enum/Labels).

export const PAYMENT_METHODS = [
  { id: 'ueberweisung', label: 'Überweisung' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'netflix', label: 'Netflix-Guthaben' },
  { id: 'sonstige', label: 'Sonstige' }
];

export function paymentMethodLabel(id) {
  return (PAYMENT_METHODS.find((m) => m.id === id) || {}).label || id || '';
}

// Zahlungsarten, die im Kontoauszug anonym erscheinen (kein Personenname,
// gemeinsame IBAN) und daher manuell zugeordnet werden müssen.
export function isAnonymousMethod(id) {
  return id === 'paypal' || id === 'netflix';
}
