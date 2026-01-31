import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import fs from "fs";

dayjs.extend(utc);
dayjs.extend(timezone);

export const cfg = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
dayjs.tz.setDefault(cfg.timezone);

export function toPhone(fromJid) {
  return String(fromJid).replace("whatsapp:", "");
}

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
    `• /my — мои брони\n` +
    `• /cancel <номер>, отмена <номер>, отменить <номер>, отказ <номер>, возврат <номер> — отменить бронь\n` +
    `• /reset — сброс диалога\n` +
    `• /help — помощь\n`
  );
}