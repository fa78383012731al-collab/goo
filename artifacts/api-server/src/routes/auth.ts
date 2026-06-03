import { Router } from "express";
import { getAuthUrl, exchangeCodeForTokens, isGoogleAuthorized, getCallbackUrl } from "../bot/oauth";

const router = Router();

router.get("/auth/google", (_req, res) => {
  const url = getAuthUrl();
  if (!url) {
    res.status(500).send(`
      <html dir="rtl" style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5">
        <h2>❌ بيانات OAuth غير مضبوطة</h2>
        <p>يرجى إضافة <code>GOOGLE_CLIENT_ID</code> و <code>GOOGLE_CLIENT_SECRET</code> في إعدادات البيئة.</p>
      </html>
    `);
    return;
  }
  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("<html><body dir='rtl'><h2>❌ لم يتم استلام رمز التفويض.</h2></body></html>");
    return;
  }
  const ok = await exchangeCodeForTokens(code);
  if (ok) {
    res.send(`
      <html dir="rtl" style="font-family:sans-serif;text-align:center;padding:60px;background:#f0fff4">
        <div style="max-width:500px;margin:auto;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px #0001">
          <div style="font-size:64px">✅</div>
          <h2 style="color:#2d7a2d">تم الربط بنجاح!</h2>
          <p style="color:#555">تم ربط حساب Google Drive بنجاح.<br>يمكنك الآن إغلاق هذه الصفحة والعودة إلى البوت.</p>
          <p style="margin-top:24px;padding:12px;background:#f0fff4;border-radius:8px;color:#2d7a2d;font-weight:bold">
            🤖 أرسل أي ملف للبوت لرفعه الآن
          </p>
        </div>
      </html>
    `);
  } else {
    res.status(500).send(`
      <html dir="rtl" style="font-family:sans-serif;text-align:center;padding:60px;background:#fff0f0">
        <h2>❌ فشل التفويض</h2>
        <p>يرجى المحاولة مرة أخرى أو التحقق من بيانات الاعتماد.</p>
        <a href="/api/auth/google">إعادة المحاولة</a>
      </html>
    `);
  }
});

router.get("/auth/status", async (_req, res) => {
  const authorized = await isGoogleAuthorized();
  const callbackUrl = getCallbackUrl();
  res.json({ authorized, callbackUrl });
});

export default router;
