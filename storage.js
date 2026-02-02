import fs from "fs";

const FILE = "./bookings.json";

function readAll() {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(items) {
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2), "utf-8");
}

/**
 * booking = {
 *   id, phone, cabinNumber, startISO, endISO, numberOfPeople, totalPrice,
 *   status ("pending" or "paid"), createdAtISO
 * }
 */
export const storage = {
  list() {
    return readAll();
  },

  add(booking) {
    const all = readAll();
    all.push(booking);
    writeAll(all);
    return booking;
  },

  removeById(id, phone) {
    const all = readAll();
    const before = all.length;
    const filtered = all.filter((b) => !(b.id === id && b.phone === phone));
    writeAll(filtered);
    return filtered.length !== before;
  },

  updateStatus(id, status) {
    const all = readAll();
    const booking = all.find((b) => b.id === id);
    if (booking) {
      booking.status = status;
      writeAll(all);
      return booking;
    }
    return null;
  },

  listByPhone(phone) {
    return readAll().filter((b) => b.phone === phone);
  }
};
