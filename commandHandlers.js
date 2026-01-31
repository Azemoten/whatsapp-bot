import dayjs from "dayjs";
import { storage } from "./storage.js";
import { toPhone, fmtDate, send, cfg } from "./utils.js";

export async function handleMy(sock, jid, phone) {
  const items = storage.listByPhone(phone).sort((a, b) => a.startISO.localeCompare(b.startISO));

  if (!items.length) {
    await send(sock, jid, `У вас нет активных броней. Напишите /book чтобы забронировать.`);
    return;
  }

  const text =
    `Ваши брони:\n` +
    items
      .map((b, index) => {
        const s = dayjs(b.startISO).tz(cfg.timezone);
        const e = dayjs(b.endISO).tz(cfg.timezone);
        return `${index + 1}) ${s.format("DD.MM.YYYY")} ${s.format("HH:mm")}–${e.format("HH:mm")}, кабинка ${b.cabinNumber}, ${b.numberOfPeople} чел., ${b.totalPrice} тенге`;
      })
      .join("\n");

  await send(sock, jid, text + `\n\nОтменить бронь: /cancel <номер>`);
}

export async function handleCancel(sock, jid, text, phone) {
  const parts = text.trim().split(/\s+/);
  const first = parts[0];

  let numStr;
  if (first === "/cancel") {
    numStr = parts[1];
  } else if (["отмена", "отменить", "отказ", "возврат"].includes(first)) {
    numStr = parts[1];
  }

  if (!numStr) {
    await send(sock, jid, `Формат: /cancel <номер> или отмена <номер>\nНапример: /cancel 1 или отмена 1`);
    return;
  }

  const num = Number(numStr);
  if (!Number.isInteger(num) || num < 1) {
    await send(sock, jid, `Номер должен быть положительным целым числом.`);
    return;
  }

  const items = storage.listByPhone(phone).sort((a, b) => a.startISO.localeCompare(b.startISO));

  if (num > items.length) {
    await send(sock, jid, `Нет брони с таким номером.`);
    return;
  }

  const booking = items[num - 1];
  const ok = storage.removeById(booking.id, phone);
  await send(sock, jid, ok ? `✅ Бронь отменена.` : `Ошибка отмены.`);
}