const sessions = new Map();

/**
 * session = {
 *   step: "IDLE" | "CHOOSE_DATE" | "CHOOSE_SLOT" | "CHOOSE_CABIN" | "CHOOSE_PEOPLE" | "CONFIRM",
 *   dateISO: "YYYY-MM-DD",
 *   slotStartISO: "...",
 *   slotEndISO: "...",
 *   cabinNumber: 1..N,
 *   numberOfPeople: 1..N,
 *   totalPrice: number
 * }
 */

export function getSession(user) {
  if (!sessions.has(user)) sessions.set(user, { step: "IDLE" });
  return sessions.get(user);
}

export function resetSession(user) {
  sessions.set(user, { step: "IDLE" });
}