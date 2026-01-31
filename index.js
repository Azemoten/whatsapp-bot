import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import crypto from "crypto";
import fs from "fs";
import { storage } from "./storage.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const cfg = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
dayjs.tz.setDefault(cfg.timezone);

// Сессии диалога в памяти (на старте норм; позже можно Redis)
const sessions = new Map();
/**
 * session = {
 *   step: "IDLE" | "CHOOSE_DATE" | "CHOOSE_SLOT" | "CHOOSE_CABIN" | "CONFIRM",
 *   dateISO: "YYYY-MM-DD",
 *   slotStartISO: "...",
 *   slotEndISO: "...",
 *   cabinNumber: 1..N
 * }
 */

function getSession(user) {
  if (!sessions.has(user)) sessions.set(user, { step: "IDLE" });
  return sessions.get(user);
}

function toPhone(fromJid) {
  // from: "123456789@s.whatsapp.net" or "whatsapp:+7..." (зависит от реализации)
  return String(fromJid).replace("whatsapp:", "");
}

function getWeekKey(d) {
  // dayjs: 0=Sunday ... 6=Saturday
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[d.day()];
}

function parseHHmm(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

function makeDayTime(baseDate, hhmm) {
  const { h, m } = parseHHmm(hhmm);
  return baseDate.hour(h).minute(m).second(0).millisecond(0);
}

function buildWorkingRange(dateISO) {
  const date = dayjs.tz(dateISO, cfg.timezone).startOf("day");
  const wk = getWeekKey(date);
  const rule = cfg.openingHours[wk];
  if (!rule) return null;

  const open = makeDayTime(date, rule.open);
  let close = makeDayTime(date, rule.close);

  // если закрытие "после полуночи" (например open=10:00 close=01:00)
  if (close.isSame(open) || close.isBefore(open)) {
    close = close.add(1, "day");
  }

  return { open, close };
}

function buildSlots(dateISO) {
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
    if (slots.length > 200) break; // защита
  }

  return slots;
}

function overlaps(aStartISO, aEndISO, bStartISO, bEndISO) {
  const aS = dayjs(aStartISO);
  const aE = dayjs(aEndISO);
  const bS = dayjs(bStartISO);
  const bE = dayjs(bEndISO);
  return aS.isBefore(bE) && bS.isBefore(aE);
}

function countFreeCabinsForSlot(slot, bookings) {
  // сколько кабинок свободно в этом слоте
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

function isCabinFree(cabinNumber, slot, bookings) {
  return !bookings.some(
    (b) =>
      b.cabinNumber === cabinNumber &&
      overlaps(b.startISO, b.endISO, slot.startISO, slot.endISO)
  );
}

function fmtSlot(slot) {
  const s = dayjs(slot.startISO).tz(cfg.timezone);
  const e = dayjs(slot.endISO).tz(cfg.timezone);
  return `${s.format("HH:mm")}–${e.format("HH:mm")}`;
}

function fmtDate(dateISO) {
  return dayjs.tz(dateISO, cfg.timezone).format("DD.MM.YYYY");
}

async function send(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

function helpText() {
  return (
    `Команды:\n` +
    `• /book — забронировать\n` +
    `• /my — мои брони\n` +
    `• /cancel <id> — отменить бронь\n` +
    `• /reset — сброс диалога\n` +
    `• /help — помощь\n`
  );
}

async function handleBookStart(sock, jid) {
  const s = getSession(jid);
  s.step = "CHOOSE_DATE";
  s.dateISO = null;
  s.slotStartISO = null;
  s.slotEndISO = null;
  s.cabinNumber = null;

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

async function handleChooseDate(sock, jid, text) {
  const s = getSession(jid);
  const today = dayjs().tz(cfg.timezone).startOf("day");

  let dateISO = null;

  // номер из списка
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

  // слоты
  const slots = buildSlots(dateISO);
  if (!slots.length) {
    await send(sock, jid, `На ${fmtDate(dateISO)} нет слотов (проверь часы работы). Выберите другую дату.`);
    return;
  }

  // показываем только те слоты, где есть свободные кабинки
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

  // сохраним слот-лист в сессии (чтобы по номеру выбрать)
  s._availableSlots = available.map((x) => x.slot);
}

async function handleChooseSlot(sock, jid, text) {
  const s = getSession(jid);
  const idx = Number(text);

  if (!Number.isInteger(idx) || idx < 1 || idx > (s._availableSlots?.length || 0)) {
    await send(sock, jid, `Выберите номер слота из списка.`);
    return;
  }

  const slot = s._availableSlots[idx - 1];
  s.slotStartISO = slot.startISO;
  s.slotEndISO = slot.endISO;

  // предлагаём выбрать кабинку
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

async function handleChooseCabin(sock, jid, text) {
  const s = getSession(jid);
  const cabin = Number(text);

  if (!Number.isInteger(cabin) || !s._freeCabins?.includes(cabin)) {
    await send(sock, jid, `Выберите кабинку из доступных: ${s._freeCabins?.join(", ")}`);
    return;
  }

  s.cabinNumber = cabin;
  s.step = "CONFIRM";

  const slot = { startISO: s.slotStartISO, endISO: s.slotEndISO };

  await send(
    sock,
    jid,
    `Подтвердите бронь:\n` +
      `• Дата: ${fmtDate(s.dateISO)}\n` +
      `• Время: ${fmtSlot(slot)}\n` +
      `• Кабинка: ${s.cabinNumber}\n\n` +
      `Ответьте: Да / Нет`
  );
}

async function handleConfirm(sock, jid, text) {
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

  // финальная проверка на пересечение (чтобы не успели занять)
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
    createdAtISO: dayjs().toISOString()
  };

  storage.add(booking);
  s.step = "IDLE";

  await send(
    sock,
    jid,
    `✅ Бронь создана!\n` +
      `ID: ${booking.id}\n` +
      `Дата: ${fmtDate(s.dateISO)}\n` +
      `Время: ${fmtSlot(slot)}\n` +
      `Кабинка: ${booking.cabinNumber}\n\n` +
      `Посмотреть брони: /my\nОтмена: /cancel ${booking.id}`
  );
}

async function handleMy(sock, jid) {
  const phone = toPhone(jid);
  const items = storage.listByPhone(phone).sort((a, b) => a.startISO.localeCompare(b.startISO));

  if (!items.length) {
    await send(sock, jid, `У вас нет активных броней. Напишите /book чтобы забронировать.`);
    return;
  }

  const text =
    `Ваши брони:\n` +
    items
      .map((b) => {
        const s = dayjs(b.startISO).tz(cfg.timezone);
        const e = dayjs(b.endISO).tz(cfg.timezone);
        return `• ${b.id} — ${s.format("DD.MM.YYYY")} ${s.format("HH:mm")}–${e.format("HH:mm")}, кабинка ${b.cabinNumber}`;
      })
      .join("\n");

  await send(sock, jid, text);
}

async function handleCancel(sock, jid, text) {
  const parts = text.trim().split(/\s+/);
  const id = parts[1];

  if (!id) {
    await send(sock, jid, `Формат: /cancel <id>\nНапример: /cancel a1b2c3d4`);
    return;
  }

  const ok = storage.removeById(id, toPhone(jid));
  await send(sock, jid, ok ? `✅ Бронь ${id} отменена.` : `Не нашёл бронь с ID ${id} (или она не ваша).`);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("Сканируй QR: WhatsApp → Настройки → Связанные устройства → Подключить устройство");
    }

    if (connection === "open") console.log("✅ Baileys подключен!");

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("Соединение закрыто. reconnect =", shouldReconnect);
      if (shouldReconnect) start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages?.[0];
    if (!msg?.message) return;
    if (msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      "";

    if (!text) return;

    const t = text.trim();

    // Команды
    if (t === "/help") return send(sock, jid, helpText());
    if (t === "/reset") {
      sessions.set(jid, { step: "IDLE" });
      return send(sock, jid, `Сбросил. ${helpText()}`);
    }
    if (t === "/book") return handleBookStart(sock, jid);
    if (t === "/my") return handleMy(sock, jid);
    if (t.startsWith("/cancel")) return handleCancel(sock, jid, t);

    // Если человек просто написал "привет" — подсказка
    const s = getSession(jid);
    if (s.step === "IDLE") {
      return send(sock, jid, `Привет! ${helpText()}`);
    }

    // Диалоговые шаги
    if (s.step === "CHOOSE_DATE") return handleChooseDate(sock, jid, t);
    if (s.step === "CHOOSE_SLOT") return handleChooseSlot(sock, jid, t);
    if (s.step === "CHOOSE_CABIN") return handleChooseCabin(sock, jid, t);
    if (s.step === "CONFIRM") return handleConfirm(sock, jid, t);

    // Фоллбек
    return send(sock, jid, `Не понял. ${helpText()}`);
  });
}

start();
