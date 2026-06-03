import app from "./app";
import { logger } from "./lib/logger";
import { createBot } from "./bot/index";
import https from "https";
import http from "http";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const DOMAIN =
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null);
const WEBHOOK_PATH = "/api/bot/webhook";
const WEBHOOK_URL = DOMAIN ? `${DOMAIN}${WEBHOOK_PATH}` : null;
const PING_INTERVAL_MS = 4 * 60 * 1000;

function startSelfPing() {
  if (!DOMAIN) return;

  const pingUrl = `${DOMAIN}/api/healthz`;

  setInterval(() => {
    const mod = pingUrl.startsWith("https") ? https : http;
    const req = mod.get(pingUrl, (res) => {
      logger.debug({ status: res.statusCode }, "Self-ping OK");
    });
    req.on("error", (err) => {
      logger.warn({ err: err.message }, "Self-ping failed");
    });
    req.end();
  }, PING_INTERVAL_MS);

  logger.info({ pingUrl, intervalMinutes: PING_INTERVAL_MS / 60000 }, "Self-ping started");
}

async function registerWebhook(bot: ReturnType<typeof createBot>) {
  if (!WEBHOOK_URL) return;
  try {
    const info = await bot.telegram.getWebhookInfo();
    if (info.url !== WEBHOOK_URL) {
      await bot.telegram.setWebhook(WEBHOOK_URL, { drop_pending_updates: true });
      logger.info({ webhookUrl: WEBHOOK_URL }, "Webhook registered");
    } else {
      logger.info({ webhookUrl: WEBHOOK_URL }, "Webhook already set");
    }
  } catch (err) {
    logger.error({ err }, "Failed to register webhook");
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");

  startSelfPing();

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    logger.warn("Bot credentials missing — bot not started");
    return;
  }

  try {
    const bot = createBot();

    if (WEBHOOK_URL) {
      app.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
      await registerWebhook(bot);
      logger.info({ webhookUrl: WEBHOOK_URL }, "Telegram bot started with webhook");

      setInterval(() => registerWebhook(bot), 30 * 60 * 1000);
    } else {
      await bot.launch({ dropPendingUpdates: true });
      logger.info("Telegram bot started with polling");
    }

    const graceful = (signal: string) => {
      logger.info({ signal }, "Stopping bot");
      bot.stop(signal);
    };
    process.once("SIGINT", () => graceful("SIGINT"));
    process.once("SIGTERM", () => graceful("SIGTERM"));
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
  }
});
