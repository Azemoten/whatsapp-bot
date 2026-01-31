import dayjs from "dayjs";
import crypto from "crypto";
import { storage } from "./storage.js";
import { makeDayTime, getWeekKey, fmtSlot, fmtDate, send, cfg } from "./utils.js";

export function buildWorkingRange(dateISO) {
  const date = dayjs.tz(dateISO, cfg.timezone).startOf("day");
  const wk = getWeekKey(date);
  const rule = cfg.openingHours[wk];
  if (!rule) return null;

  const open = makeDayTime(date, rule.open);
  let close = makeDayTime(date, rule.close);

  if (close.isSame(open) || close.isBefore(open)) {
    close = close.add(1, "day");
  }

  return { open, close };
}

export function buildSlots(dateISO) {
  const range = buildWorkingRange(dateISO);
  if (!range) return [];
  const { open, close } = range;

  const slots = [];
  let start = open;

  while (true) {
    const end = start.add(cfg.slotMinutes, "minute");
    if (end.isAfter(close) || end.isSame(close) === false && end.isAfter(close)) break;
    slots.push({ startISO: start.toISOString(), endISO: end.toISOString() });
    start = end;
    if (slots.length > 200) break;
  }

  return slots;
}

export function overlaps(aStartISO, aEndISO, bStartISO, bEndISO) {
  const aS = dayjs(aStartISO);
  const aE = dayjs(aEndISO);
  const bS = dayjs(bStartISO);
  const bE = dayjs(bEndISO);
  return aS.isBefore(bE) && bS.isBefore(aE);
}

export function countFreeCabinsForSlot(slot, bookings) {
  let busy = 0;
  for (let cabin = 1; cabin <= cfg.cabinCount; cabin++) {
    const hasOverlap = bookings.some(
      (b) =>
        b.cabinNumber === cabin &&
        overlaps(b.startISO, b.endISO, slot.startISO, slot.endISO)
    );
    if (hasOverlap) busy++;
  }
  return cfg.cabinCount - busy;
}

export function isCabinFree(cabinNumber, slot, bookings) {
  return !bookings.some(
    (b) =>
      b.cabinNumber === cabinNumber &&
      overlaps(b.startISO, b.endISO, slot.startISO, slot.endISO)
  );
}

export function generateAvailabilityTable() {
  const today = dayjs().tz(cfg.timezone).startOf("day").format("YYYY-MM-DD");
  const slots = buildSlots(today);
  if (!slots.length) return "Сегодня нет доступных слотов.";

  const bookings = storage.list();
  const available = slots
    .map(slot => {
      const freeCabins = [];
      for (let c = 1; c <= cfg.cabinCount; c++) {
        if (isCabinFree(c, slot, bookings)) freeCabins.push(c);
      }
      return { slot, freeCabins };
    })
    .filter(x => x.freeCabins.length > 0)
    .slice(0, 5);

  if (!available.length) return "Сегодня всё занято.";

  const lines = available.map(x => `${fmtSlot(x.slot)}: кабинки ${x.freeCabins.join(', ')}`);
  return `Ближайшие свободные слоты сегодня:\n${lines.join('\n')}`;
}

export async function handleBookStart(sock, jid, getSession) {
  const s = getSession(jid);
  s.step = "CHOOSE_DATE";
  s.dateISO = null;
  s.slotStartISO = null;
  s.slotEndISO = null;
  s.cabinNumber = null;
  s.numberOfPeople = null;
  s.totalPrice = null;

  const today = dayjs().tz(cfg.timezone).startOf("day");
  const lines = [];
  for (let i = 0; i <= cfg.advanceDays; i++) {
    const d = today.add(i, "day");
    lines.push(`${i + 1}) ${d.format("DD.MM.YYYY")} (${getWeekKey(d)})`);
  }

  await send(
    sock,
    jid,
    `Выберите дату (1–${cfg.advanceDays + 1}):\n` +
      lines.join("\n") +
      `\n\nИли введите дату в формате YYYY-MM-DD`
  );
}

export async function handleChooseDate(sock, jid, text, getSession) {
  const s = getSession(jid);
  const today = dayjs().tz(cfg.timezone).startOf("day");

  let dateISO = null;

  const num = Number(text);
  if (Number.isInteger(num) && num >= 1 && num <= cfg.advanceDays + 1) {
    dateISO = today.add(num - 1, "day").format("YYYY-MM-DD");
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    dateISO = text;
  }

  if (!dateISO) {
    await send(sock, jid, `Не понял дату. Введите номер (1–${cfg.advanceDays + 1}) или YYYY-MM-DD`);
    return;
  }

  const slots = buildSlots(dateISO);
  if (!slots.length) {
    await send(sock, jid, `На ${fmtDate(dateISO)} нет слотов (проверь часы работы). Выберите другую дату.`);
    return;
  }

  const bookings = storage.list();
  const available = slots
    .map((slot) => ({ slot, free: countFreeCabinsForSlot(slot, bookings) }))
    .filter((x) => x.free > 0);

  if (!available.length) {
    await send(sock, jid, `На ${fmtDate(dateISO)} всё занято. Выберите другую дату.`);
    return;
  }

  s.dateISO = dateISO;
  s.step = "CHOOSE_SLOT";

  const list = available
    .slice(0, 30)
    .map((x, i) => `${i + 1}) ${fmtSlot(x.slot)} (свободно: ${x.free}/${cfg.cabinCount})`)
    .join("\n");

  await send(
    sock,
    jid,
    `Доступные слоты на ${fmtDate(dateISO)}:\n` +
      list +
      `\n\nВыберите номер слота`
  );

  s._availableSlots = available.map((x) => x.slot);
}

export async function handleChooseSlot(sock, jid, text, getSession) {
  const s = getSession(jid);
  const idx = Number(text);

  if (!Number.isInteger(idx) || idx < 1 || idx > (s._availableSlots?.length || 0)) {
    await send(sock, jid, `Выберите номер слота из списка.`);
    return;
  }

  const slot = s._availableSlots[idx - 1];
  s.slotStartISO = slot.startISO;
  s.slotEndISO = slot.endISO;

  const bookings = storage.list();
  const freeCabins = [];
  for (let cabin = 1; cabin <= cfg.cabinCount; cabin++) {
    if (isCabinFree(cabin, slot, bookings)) freeCabins.push(cabin);
  }

  s.step = "CHOOSE_CABIN";
  s._freeCabins = freeCabins;

  await send(
    sock,
    jid,
    `Выбран слот: ${fmtDate(s.dateISO)} ${fmtSlot(slot)}\n` +
      `Свободные кабинки: ${freeCabins.map((c) => `${c}`).join(", ")}\n\n` +
      `Напишите номер кабинки`
  );
}

export async function handleChooseCabin(sock, jid, text, getSession) {
  const s = getSession(jid);
  const cabin = Number(text);

  if (!Number.isInteger(cabin) || !s._freeCabins?.includes(cabin)) {
    await send(sock, jid, `Выберите кабинку из доступных: ${s._freeCabins?.join(", ")}`);
    return;
  }

  s.cabinNumber = cabin;
  s.step = "CHOOSE_PEOPLE";

  const slot = { startISO: s.slotStartISO, endISO: s.slotEndISO };

  await send(
    sock,
    jid,
    `Выбран слот: ${fmtDate(s.dateISO)} ${fmtSlot(slot)}\n` +
      `Кабинка: ${s.cabinNumber}\n\n` +
      `Сколько человек? (1 или больше)`
  );
}

export async function handleChoosePeople(sock, jid, text, getSession) {
  const s = getSession(jid);
  const num = Number(text);

  if (!Number.isInteger(num) || num < 1) {
    await send(sock, jid, `Введите количество человек (целое число больше 0).`);
    return;
  }

  s.numberOfPeople = num;
  s.totalPrice = num === 1 ? cfg.priceSingle : num * cfg.pricePerPerson;
  s.step = "CONFIRM";

  const slot = { startISO: s.slotStartISO, endISO: s.slotEndISO };

  await send(
    sock,
    jid,
    `Подтвердите бронь:\n` +
      `• Дата: ${fmtDate(s.dateISO)}\n` +
      `• Время: ${fmtSlot(slot)}\n` +
      `• Кабинка: ${s.cabinNumber}\n` +
      `• Количество человек: ${s.numberOfPeople}\n` +
      `• Стоимость: ${s.totalPrice} тенге\n\n` +
      `Ответьте: Да / Нет`
  );
}

export async function handleConfirm(sock, jid, text, getSession, toPhone) {
  const s = getSession(jid);
  const yes = ["да", "yes", "y", "+", "ok"].includes(text.toLowerCase());
  const no = ["нет", "no", "n", "-", "cancel"].includes(text.toLowerCase());

  if (!yes && !no) {
    await send(sock, jid, `Ответьте "Да" или "Нет".`);
    return;
  }

  if (no) {
    s.step = "IDLE";
    await send(sock, jid, `Ок, отменил. Напиши /book чтобы начать заново.`);
    return;
  }

  const slot = { startISO: s.slotStartISO, endISO: s.slotEndISO };
  const bookings = storage.list();
  const cabinFree = isCabinFree(s.cabinNumber, slot, bookings);

  if (!cabinFree) {
    s.step = "IDLE";
    await send(sock, jid, `Упс, эту кабинку только что забронировали. Напиши /book и выбери другой слот/кабинку.`);
    return;
  }

  const booking = {
    id: crypto.randomBytes(4).toString("hex"),
    phone: toPhone(jid),
    cabinNumber: s.cabinNumber,
    startISO: slot.startISO,
    endISO: slot.endISO,
    numberOfPeople: s.numberOfPeople,
    totalPrice: s.totalPrice,
    createdAtISO: dayjs().toISOString()
  };

  storage.add(booking);
  s.step = "IDLE";

  await send(
    sock,
    jid,
    `✅ Бронь создана!\n` +
      `Дата: ${fmtDate(s.dateISO)}\n` +
      `Время: ${fmtSlot(slot)}\n` +
      `Кабинка: ${booking.cabinNumber}\n` +
      `Количество человек: ${booking.numberOfPeople}\n` +
      `Стоимость: ${booking.totalPrice} тенге\n\n` +
      `Посмотреть брони: /my`
  );
}