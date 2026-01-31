import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import fs from "fs";

dayjs.extend(utc);
dayjs.extend(timezone);

export const cfg = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
dayjs.tz.setDefault(cfg.timezone);

export function toPhone(phone) {
  return String(phone);
}

// const phoneCache = new Map();

// async function getPhone(sock, msg) {
//   const jid =
//     msg.key.participant ||
//     msg.key.remoteJid;

//   if (phoneCache.has(jid)) {
//     return phoneCache.get(jid)!;
//   }

//   let phone: string | null = null;

//   if (jid.endsWith("@s.whatsapp.net")) {
//     phone = jid.replace("@s.whatsapp.net", "");
//   } else {
//     const [res] = await sock.onWhatsApp(jid);
//     if (res?.jid) {
//       phone = res.jid.replace("@s.whatsapp.net", "");
//     }
//   }

//   if (!phone) throw new Error("PHONE_NOT_FOUND");

//   phoneCache.set(jid, phone);
//   return phone;
// }


export function getWeekKey(d) {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[d.day()];
}

export function parseHHmm(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

export function makeDayTime(baseDate, hhmm) {
  const { h, m } = parseHHmm(hhmm);
  return baseDate.hour(h).minute(m).second(0).millisecond(0);
}

export function fmtSlot(slot) {
  const s = dayjs(slot.startISO).tz(cfg.timezone);
  const e = dayjs(slot.endISO).tz(cfg.timezone);
  return `${s.format("HH:mm")}–${e.format("HH:mm")}`;
}

export function fmtDate(dateISO) {
  return dayjs.tz(dateISO, cfg.timezone).format("DD.MM.YYYY");
}

export async function send(sock, jid, text) {
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 1000));
  await sock.sendMessage(jid, { text });
}

export function helpText() {
  return (
    `Команды:\n` +
    `• /book, бронь, забронировать, бронировать — забронировать\n` +
    `• /booknow — быстрая бронь ближайшего слота на 1 человека\n` +
    `• /my — мои брони\n` +
    `• /cancel <номер>, отмена <номер>, отменить <номер>, отказ <номер>, возврат <номер> — отменить бронь\n` +
    `• /reset — сброс диалога\n` +
    `• /help — помощь\n\n` +
    `Пример бронирования:\n` +
    `1. Напишите "бронь"\n` +
    `2. Выберите дату (1-8)\n` +
    `3. Выберите слот (1-...)\n` +
    `4. Выберите кабинку (номер)\n` +
    `5. Укажите количество человек\n` +
    `6. Подтвердите "да"`
  );
}