import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import { getSession, resetSession } from "./sessionManager.js";
import { send, helpText, toPhone } from "./utils.js";
import { generateAvailabilityTable, handleBookStart, handleChooseDate, handleChooseSlot, handleChooseCabin, handleChoosePeople, handleConfirm, handleBookNow } from "./bookingLogic.js";
import { handleMy, handleCancel } from "./commandHandlers.js";

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
    const phone = sock.user.id.split(':')[0];

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
      resetSession(jid);
      return send(sock, jid, `Сбросил. ${helpText()}`);
    }
    if (t === "/book" || t === "бронь" || t === "забронировать" || t === "бронировать") return handleBookStart(sock, jid, getSession);
    if (t === "/booknow") return handleBookNow(sock, jid, phone);
    if (t === "/my") return handleMy(sock, jid, phone);
    if (t.startsWith("/cancel") || ["отмена", "отменить", "отказ", "возврат"].some(word => t.startsWith(word + " ") || t === word)) return handleCancel(sock, jid, t, phone);

    // Если человек просто написал "привет" — подсказка
    const s = getSession(jid);
    if (s.step === "IDLE") {
      return send(sock, jid, `Привет! ${helpText()}\n\n${generateAvailabilityTable()}`);
    }

    // Диалоговые шаги
    if (s.step === "CHOOSE_DATE") return handleChooseDate(sock, jid, t, getSession);
    if (s.step === "CHOOSE_SLOT") return handleChooseSlot(sock, jid, t, getSession);
    if (s.step === "CHOOSE_CABIN") return handleChooseCabin(sock, jid, t, getSession);
    if (s.step === "CHOOSE_PEOPLE") return handleChoosePeople(sock, jid, t, getSession);
    if (s.step === "CONFIRM") return handleConfirm(sock, jid, t, getSession, phone);

    // Фоллбек
    return send(sock, jid, `Не понял. ${helpText()}`);
  });
}

start();
