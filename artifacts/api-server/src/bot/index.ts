import { Telegraf, Markup, Context } from "telegraf";
import axios from "axios";
import { logger } from "../lib/logger";
import { createFolder as driveCreateFolder, uploadFile as driveUploadFile } from "./drive";
import { isGoogleAuthorized } from "./oauth";
import { generateQrBuffer } from "./qr";
import { compressFile, formatSize } from "./compress";
import {
  getSession,
  upsertSession,
  createProject,
  createFolder,
  getProject,
  getProjectFolders,
  getFolder,
  listProjects,
  recordUpload,
  getProjectStats,
  getGlobalStats,
} from "./storage";

const DEVELOPER = "فيصل الصوفي";

const ADAA_FOLDERS = [
  "أداء الواجبات الوظيفية",
  "التفاعل مع المجتمع المهني",
  "التفاعل مع أولياء الأمور",
  "التنويع في استراتيجيات التدريس",
  "تحسين نتائج المتعلمين",
  "إعداد وتنفيذ خطة التعلم",
  "توظيف تقنيات ووسائل التعلم",
  "تهيئة البيئة التعليمية",
  "الإدارة الصفية",
  "تحليل نتائج المتعلمين وتشخيص مستوياتهم",
  "تنويع أساليب التقويم",
];

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  mp4: "video/mp4",
  txt: "text/plain",
};

function getMimeType(fileName: string, fallback = "application/octet-stream"): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? fallback;
}

async function downloadFile(url: string): Promise<Buffer> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📊 ملف أداء وظيفي", "project:type:adaa"),
      Markup.button.callback("🗂 ملف إنجاز", "project:type:injaz"),
    ],
    [Markup.button.callback("🗃 المشاريع السابقة", "projects:list:0")],
  ]);
}

function projectFoldersKeyboard(
  folders: Array<{ id: number; name: string }>,
  projectId: number,
  projectType: "adaa" | "injaz",
  currentFolderId?: number | null
) {
  const buttons = folders.map((f) => {
    const isActive = f.id === currentFolderId;
    const label = isActive ? `✅ ${f.name}` : f.name;
    return Markup.button.callback(label, `folder:select:${f.id}`);
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    if (buttons[i + 1]) {
      rows.push([buttons[i], buttons[i + 1]]);
    } else {
      rows.push([buttons[i]]);
    }
  }

  if (projectType === "injaz") {
    rows.push([Markup.button.callback("➕ إضافة مجلد فرعي", "folder:add")]);
  }
  rows.push([
    Markup.button.callback("📊 إحصائيات", `project:stats:${projectId}`),
    Markup.button.callback("🔗 الروابط والباركودات", `project:links:${projectId}`),
  ]);
  rows.push([Markup.button.callback("🏠 القائمة الرئيسية", "menu:main")]);

  return Markup.inlineKeyboard(rows);
}

async function sendProjectView(ctx: Context, projectId: number, currentFolderId?: number | null) {
  const project = await getProject(projectId);
  if (!project) {
    await ctx.reply("⚠️ المشروع غير موجود.");
    return;
  }
  const folders = await getProjectFolders(projectId);
  const typeLabel = project.type === "adaa" ? "📊 أداء وظيفي" : "🗂 ملف إنجاز";
  const activeFolder = folders.find((f) => f.id === currentFolderId);

  const text =
    `${typeLabel}\n` +
    `👤 ${project.name}\n` +
    `─────────────────\n` +
    (activeFolder
      ? `📂 المجلد المحدد: ${activeFolder.name}\n📤 أرسل ملفاتك الآن\n`
      : `📂 اختر المجلد لرفع الملفات إليه:`);

  const keyboard = projectFoldersKeyboard(folders, projectId, project.type, currentFolderId);

  await ctx.reply(text, keyboard);
}

export function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const bot = new Telegraf(token);

  async function getUserId(ctx: Context): Promise<number | null> {
    return ctx.from?.id ?? null;
  }

  bot.start(async (ctx) => {
    const name = ctx.from?.first_name || "مستخدم";
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle", currentProjectId: null, currentFolderId: null });

    const driveOk = await isGoogleAuthorized();

    await ctx.reply(
      `👋 أهلاً ${name}!\n` +
      `─────────────────\n` +
      `☁️ Google Drive: ${driveOk ? "✅ متصل" : "❌ غير متصل"}\n` +
      `👨‍💻 المطور: ${DEVELOPER}\n` +
      `─────────────────\n` +
      `اختر نوع الملف:`,
      mainMenuKeyboard()
    );
  });

  bot.command("menu", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.reply(
      `🏠 القائمة الرئيسية\n─────────────────\nاختر نوع الملف:`,
      mainMenuKeyboard()
    );
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.reply(
      `↩️ تم الإلغاء\n─────────────────\nاختر نوع الملف:`,
      mainMenuKeyboard()
    );
  });

  bot.command("stats", async (ctx) => {
    const global = await getGlobalStats();
    await ctx.reply(
      `📊 إحصائيات عامة\n` +
      `─────────────────\n` +
      `📋 المشاريع: ${global.totalProjects}\n` +
      `📁 إجمالي الملفات: ${global.totalFiles}\n` +
      `💾 إجمالي الحجم: ${formatSize(global.totalBytes)}\n` +
      `─────────────────\n` +
      `👨‍💻 ${DEVELOPER}`,
      mainMenuKeyboard()
    );
  });

  bot.command("status", async (ctx) => {
    const userId = ctx.from!.id;
    const session = await getSession(userId);
    const driveOk = await isGoogleAuthorized();
    const allProjects = await listProjects();

    let statusText = `📊 الحالة\n─────────────────\n`;
    statusText += `☁️ Drive: ${driveOk ? "✅ متصل" : "❌ غير متصل"}\n`;
    statusText += `📋 عدد المشاريع: ${allProjects.length}\n`;

    if (session?.currentProjectId) {
      const project = await getProject(session.currentProjectId);
      if (project) {
        const icon = project.type === "adaa" ? "📊" : "🗂";
        statusText += `${icon} المشروع: ${project.name}\n`;
      }
    }

    if (session?.currentFolderId) {
      const folder = await getFolder(session.currentFolderId);
      if (folder) statusText += `📂 المجلد: ${folder.name}\n`;
    }

    statusText += `─────────────────\n👨‍💻 ${DEVELOPER}`;
    await ctx.reply(statusText, mainMenuKeyboard());
  });

  bot.action("menu:main", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.answerCbQuery();
    await ctx.reply(
      `🏠 القائمة الرئيسية\n─────────────────\nاختر نوع الملف:`,
      mainMenuKeyboard()
    );
  });

  bot.action("project:type:adaa", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "waiting_project_name_adaa" });
    await ctx.answerCbQuery();
    await ctx.reply(
      `📊 ملف أداء وظيفي\n─────────────────\n✏️ اكتب اسم صاحب الملف:`
    );
  });

  bot.action("project:type:injaz", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "waiting_project_name_injaz" });
    await ctx.answerCbQuery();
    await ctx.reply(
      `🗂 ملف إنجاز\n─────────────────\n✏️ اكتب اسم صاحب الملف:`
    );
  });

  bot.action(/^projects:list:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const projects = await listProjects();
    if (projects.length === 0) {
      await ctx.reply(
        `🗃 المشاريع السابقة\n─────────────────\n📭 لا توجد مشاريع بعد`,
        mainMenuKeyboard()
      );
      return;
    }

    const page = parseInt(ctx.match[1]);
    const pageSize = 8;
    const start = page * pageSize;
    const slice = projects.slice(start, start + pageSize);

    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (let i = 0; i < slice.length; i += 2) {
      const p1 = slice[i];
      const p2 = slice[i + 1];
      const icon1 = p1.type === "adaa" ? "📊" : "🗂";
      const btn1 = Markup.button.callback(`${icon1} ${p1.name}`, `project:open:${p1.id}`);
      if (p2) {
        const icon2 = p2.type === "adaa" ? "📊" : "🗂";
        const btn2 = Markup.button.callback(`${icon2} ${p2.name}`, `project:open:${p2.id}`);
        rows.push([btn1, btn2]);
      } else {
        rows.push([btn1]);
      }
    }

    const nav: ReturnType<typeof Markup.button.callback>[] = [];
    if (page > 0) nav.push(Markup.button.callback("◀️ السابق", `projects:list:${page - 1}`));
    if (start + pageSize < projects.length)
      nav.push(Markup.button.callback("التالي ▶️", `projects:list:${page + 1}`));
    if (nav.length > 0) rows.push(nav);
    rows.push([Markup.button.callback("🏠 القائمة الرئيسية", "menu:main")]);

    await ctx.reply(
      `🗃 المشاريع السابقة\n─────────────────\n📋 ${projects.length} مشروع`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/^project:open:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const projectId = parseInt(ctx.match[1]);
    await upsertSession(userId, {
      state: "in_project",
      currentProjectId: projectId,
      currentFolderId: null,
    });
    await sendProjectView(ctx, projectId, null);
  });

  bot.action(/^folder:select:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const folderId = parseInt(ctx.match[1]);
    const folder = await getFolder(folderId);
    if (!folder) {
      await ctx.reply("⚠️ المجلد غير موجود.");
      return;
    }

    const session = await getSession(userId);
    const projectId = folder.projectId;

    await upsertSession(userId, {
      state: "in_project",
      currentProjectId: projectId,
      currentFolderId: folderId,
    });

    const folders = await getProjectFolders(projectId);
    const project = await getProject(projectId);
    if (!project) return;

    const keyboard = projectFoldersKeyboard(folders, projectId, project.type, folderId);

    await ctx.reply(
      `✅ تم تحديد المجلد\n─────────────────\n📂 ${folder.name}\n📤 أرسل ملفاتك الآن`,
      keyboard
    );
  });

  bot.action("folder:add", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const session = await getSession(userId);
    if (!session?.currentProjectId) {
      await ctx.reply("⚠️ يرجى اختيار مشروع أولاً.", mainMenuKeyboard());
      return;
    }
    await upsertSession(userId, { state: "waiting_subfolder_name" });
    await ctx.reply(`➕ مجلد فرعي جديد\n─────────────────\n✏️ اكتب اسم المجلد:`);
  });

  bot.action(/^project:stats:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const projectId = parseInt(ctx.match[1]);
    const project = await getProject(projectId);
    if (!project) {
      await ctx.reply("⚠️ المشروع غير موجود.");
      return;
    }

    const stats = await getProjectStats(projectId);
    const typeIcon = project.type === "adaa" ? "📊" : "🗂";

    let text = `📊 إحصائيات المشروع\n`;
    text += `─────────────────\n`;
    text += `${typeIcon} ${project.name}\n`;
    text += `─────────────────\n`;
    text += `📁 إجمالي الملفات: ${stats.totalFiles}\n`;
    text += `💾 إجمالي الحجم: ${formatSize(stats.totalBytes)}\n`;

    if (stats.lastUploadAt) {
      const d = stats.lastUploadAt;
      const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      text += `🕐 آخر رفع: ${dateStr}\n`;
    }

    if (stats.folderStats.length > 0) {
      text += `─────────────────\n`;
      text += `📂 تفاصيل المجلدات:\n`;
      for (const f of stats.folderStats) {
        if (f.fileCount > 0) {
          text += `• ${f.folderName}\n`;
          text += `  ${f.fileCount} ملف — ${formatSize(f.totalBytes)}\n`;
        }
      }
    } else {
      text += `─────────────────\n`;
      text += `📭 لم يُرفع أي ملف بعد\n`;
    }

    await ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback("🔙 العودة للمشروع", `project:open:${projectId}`)],
      [Markup.button.callback("🏠 القائمة الرئيسية", "menu:main")],
    ]));
  });

  bot.action(/^project:links:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const projectId = parseInt(ctx.match[1]);
    const project = await getProject(projectId);
    const folders = await getProjectFolders(projectId);

    if (!project) {
      await ctx.reply("⚠️ المشروع غير موجود.");
      return;
    }

    let text = `🔗 روابط مجلدات مشروع: ${project.name}\n`;
    text += `🌐 (مصرح بالمشاهدة للجميع)\n\n`;
    text += `📂 المجلد الرئيسي:\n${project.mainFolderLink}\n\n`;
    text += `📁 المجلدات الفرعية:\n`;
    folders.forEach((f, i) => {
      text += `\n${i + 1}. ${f.name}\n${f.driveFolderLink}\n`;
    });

    await ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback("📲 تحويل الروابط إلى باركودات", `project:qrcodes:${projectId}`)],
      [Markup.button.callback("🔙 العودة للمشروع", `project:open:${projectId}`)],
      [Markup.button.callback("🏠 القائمة الرئيسية", "menu:main")],
    ]));
  });

  bot.action(/^project:qrcodes:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("⏳ جاري إنشاء الباركودات...");
    const projectId = parseInt(ctx.match[1]);
    const project = await getProject(projectId);
    const folders = await getProjectFolders(projectId);

    if (!project) {
      await ctx.reply("⚠️ المشروع غير موجود.");
      return;
    }

    await ctx.reply(`📲 جاري إنشاء باركودات مشروع: ${project.name}\nعدد المجلدات: ${folders.length + 1}\nيرجى الانتظار...`);

    try {
      const mainQr = await generateQrBuffer(project.mainFolderLink);
      await ctx.replyWithPhoto(
        { source: mainQr },
        { caption: `📂 المجلد الرئيسي\n${project.name}\n\n🔗 ${project.mainFolderLink}` }
      );

      for (const folder of folders) {
        const qrBuf = await generateQrBuffer(folder.driveFolderLink);
        await ctx.replyWithPhoto(
          { source: qrBuf },
          { caption: `📁 ${folder.name}\n\n🔗 ${folder.driveFolderLink}` }
        );
      }

      await ctx.reply(`✅ تم إنشاء ${folders.length + 1} باركود بنجاح!`, Markup.inlineKeyboard([
        [Markup.button.callback("🔙 العودة للمشروع", `project:open:${projectId}`)],
        [Markup.button.callback("🏠 القائمة الرئيسية", "menu:main")],
      ]));
    } catch (err) {
      logger.error(err, "Error generating QR codes");
      await ctx.reply("❌ حدث خطأ أثناء إنشاء الباركودات.");
    }
  });

  async function handleNewAdaaProject(ctx: Context, userId: number, name: string) {
    const progressMsg = await ctx.reply(
      `⏳ جاري إنشاء ملف الأداء الوظيفي لـ "${name}"\n` +
      `📂 إنشاء المجلد الرئيسي... (0/${ADAA_FOLDERS.length})`
    );
    const chatId = progressMsg.chat.id;
    const msgId = progressMsg.message_id;

    const mainFolder = await driveCreateFolder(name);
    const project = await createProject(name, "adaa", mainFolder.id, mainFolder.link);

    const dbFolders = [];
    for (let i = 0; i < ADAA_FOLDERS.length; i++) {
      const subName = ADAA_FOLDERS[i];
      try {
        await ctx.telegram.editMessageText(
          chatId, msgId, undefined,
          `⏳ جاري إنشاء ملف الأداء الوظيفي لـ "${name}"\n` +
          `📁 ${subName}\n` +
          `التقدم: ${i + 1}/${ADAA_FOLDERS.length} ${"▓".repeat(i + 1)}${"░".repeat(ADAA_FOLDERS.length - i - 1)}`
        );
      } catch { /* ignore edit errors */ }

      const sub = await driveCreateFolder(subName, mainFolder.id);
      const dbF = await createFolder(project.id, subName, sub.id, sub.link, i);
      dbFolders.push(dbF);
    }

    await upsertSession(userId, {
      state: "in_project",
      currentProjectId: project.id,
      currentFolderId: null,
    });

    const keyboard = projectFoldersKeyboard(dbFolders, project.id, "adaa", null);
    await ctx.reply(
      `✅ تم إنشاء الملف\n─────────────────\n📊 أداء وظيفي\n👤 ${name}\n─────────────────\nاختر البند:`,
      keyboard
    );
  }

  async function handleNewInjazProject(ctx: Context, userId: number, name: string) {
    await ctx.reply(`⏳ جاري إنشاء ملف الإنجاز...`);

    const mainFolder = await driveCreateFolder(name);
    const project = await createProject(name, "injaz", mainFolder.id, mainFolder.link);

    await upsertSession(userId, {
      state: "in_project",
      currentProjectId: project.id,
      currentFolderId: null,
    });

    await ctx.reply(
      `✅ تم إنشاء الملف\n─────────────────\n🗂 ملف إنجاز\n👤 ${name}\n─────────────────\nأضف مجلدات فرعية:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("➕ إضافة مجلد", "folder:add"),
          Markup.button.callback("🔗 الروابط", `project:links:${project.id}`),
        ],
        [Markup.button.callback("🏠 القائمة الرئيسية", "menu:main")],
      ])
    );
  }

  async function handleNewSubfolder(ctx: Context, userId: number, name: string) {
    const session = await getSession(userId);
    if (!session?.currentProjectId) {
      await ctx.reply("⚠️ يرجى اختيار مشروع أولاً.", mainMenuKeyboard());
      return;
    }

    const project = await getProject(session.currentProjectId);
    if (!project) return;

    await ctx.reply(`⏳ جاري إنشاء المجلد الفرعي "${name}"...`);
    const sub = await driveCreateFolder(name, project.mainFolderId);

    const existingFolders = await getProjectFolders(project.id);
    const dbFolder = await createFolder(
      project.id,
      name,
      sub.id,
      sub.link,
      existingFolders.length
    );

    await upsertSession(userId, {
      state: "in_project",
      currentFolderId: dbFolder.id,
    });

    const allFolders = await getProjectFolders(project.id);
    const keyboard = projectFoldersKeyboard(allFolders, project.id, "injaz", dbFolder.id);
    await ctx.reply(
      `✅ تم إنشاء المجلد\n─────────────────\n📂 ${name}\n📤 أرسل ملفاتك الآن`,
      keyboard
    );
  }

  async function handleFileUpload(
    ctx: Context,
    fileId: string,
    fileName: string,
    mimeType: string,
    userId: number
  ) {
    const authorized = await isGoogleAuthorized();
    if (!authorized) {
      const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
      const authUrl = `https://${domain}/api/auth/google`;
      await ctx.reply(
        `⚠️ حساب Google Drive غير مرتبط بعد.\n\n` +
        `اضغط على الرابط التالي لربط حسابك مرة واحدة:\n${authUrl}\n\n` +
        `بعد الربط، أعد إرسال الملف.`
      );
      return;
    }

    const session = await getSession(userId);
    if (!session?.currentProjectId) {
      await ctx.reply(
        "⚠️ يرجى اختيار مشروع ومجلد أولاً.",
        mainMenuKeyboard()
      );
      return;
    }
    if (!session.currentFolderId) {
      const project = await getProject(session.currentProjectId);
      const folders = await getProjectFolders(session.currentProjectId);
      await ctx.reply(
        "⚠️ يرجى اختيار المجلد الذي تريد الرفع إليه:",
        projectFoldersKeyboard(folders, session.currentProjectId, project!.type, null)
      );
      return;
    }

    const folder = await getFolder(session.currentFolderId);
    if (!folder) {
      await ctx.reply("⚠️ المجلد غير موجود. يرجى اختيار مجلد آخر.");
      return;
    }

    await ctx.reply(`⏳ جاري معالجة "${fileName}"...`);

    try {
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const rawBuffer = await downloadFile(fileLink.href);
      const resolvedMime = getMimeType(fileName, mimeType);

      const result = await compressFile(rawBuffer, fileName, resolvedMime);

      if (result.compressed) {
        await ctx.reply(
          `🗜️ تم الضغط التلقائي\n` +
          `─────────────────\n` +
          `قبل: ${formatSize(result.originalSize)}\n` +
          `بعد: ${formatSize(result.finalSize)}\n` +
          `⏳ جاري الرفع...`
        );
      }

      await driveUploadFile(result.fileName, result.mime, result.buffer, folder.driveFolderId);

      await recordUpload(
        session.currentProjectId!,
        session.currentFolderId!,
        result.fileName,
        result.mime,
        result.finalSize
      );

      const project = await getProject(session.currentProjectId!);
      const folders = await getProjectFolders(session.currentProjectId!);
      const keyboard = projectFoldersKeyboard(folders, session.currentProjectId!, project!.type, session.currentFolderId);

      await ctx.reply(
        `✅ تم الرفع بنجاح\n─────────────────\n📄 ${result.fileName}\n📂 ${folder.name}\n💾 ${formatSize(result.finalSize)}`,
        keyboard
      );
    } catch (err: any) {
      logger.error(err, "Error uploading file");
      if (err?.message?.includes("file is too big")) {
        const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
        const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
        const isPdf = ext === "pdf";
        const isVideo = ["mp4", "mov", "avi", "mkv"].includes(ext);

        let tips = "📌 للحل:\n";
        if (isImage) {
          tips += "• أرسل الصورة كـ **صورة** (photo) وليس كملف، تيليغرام سيضغطها تلقائياً";
        } else if (isPdf) {
          tips += "• استخدم موقع https://smallpdf.com أو https://ilovepdf.com لضغط الـ PDF أولاً";
        } else if (isVideo) {
          tips += "• استخدم تطبيق ضغط الفيديو على هاتفك ثم أعد الإرسال";
        } else {
          tips += "• قسّم الملف إلى أجزاء أصغر من 20MB وأرسلها على دفعات";
        }

        await ctx.reply(
          `⚠️ الملف أكبر من 20MB (حد تيليغرام)\n\n${tips}`
        );
      } else {
        await ctx.reply("❌ حدث خطأ أثناء رفع الملف. يرجى المحاولة مجدداً.");
      }
    }
  }

  bot.on("document", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const doc = ctx.message.document;
    await handleFileUpload(ctx, doc.file_id, doc.file_name || "file", doc.mime_type || "application/octet-stream", userId);
  });

  bot.on("photo", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    await handleFileUpload(ctx, largest.file_id, `photo_${Date.now()}.jpg`, "image/jpeg", userId);
  });

  bot.on("video", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const video = ctx.message.video;
    await handleFileUpload(ctx, video.file_id, video.file_name || `video_${Date.now()}.mp4`, video.mime_type || "video/mp4", userId);
  });

  bot.on("audio", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const audio = ctx.message.audio;
    await handleFileUpload(ctx, audio.file_id, audio.file_name || `audio_${Date.now()}.mp3`, audio.mime_type || "audio/mpeg", userId);
  });

  bot.on("text", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const session = await getSession(userId);
    const state = session?.state ?? "idle";

    if (state === "waiting_project_name_adaa") {
      await upsertSession(userId, { state: "idle" });
      try {
        await handleNewAdaaProject(ctx, userId, text);
      } catch (err) {
        logger.error(err, "Error creating adaa project");
        await ctx.reply("❌ حدث خطأ أثناء إنشاء المشروع. يرجى المحاولة مجدداً.");
      }
    } else if (state === "waiting_project_name_injaz") {
      await upsertSession(userId, { state: "idle" });
      try {
        await handleNewInjazProject(ctx, userId, text);
      } catch (err) {
        logger.error(err, "Error creating injaz project");
        await ctx.reply("❌ حدث خطأ أثناء إنشاء المشروع. يرجى المحاولة مجدداً.");
      }
    } else if (state === "waiting_subfolder_name") {
      await upsertSession(userId, { state: "in_project" });
      try {
        await handleNewSubfolder(ctx, userId, text);
      } catch (err) {
        logger.error(err, "Error creating subfolder");
        await ctx.reply("❌ حدث خطأ أثناء إنشاء المجلد الفرعي. يرجى المحاولة مجدداً.");
      }
    } else {
      await ctx.reply(
        `💡 أرسل ملفاً للرفع أو اختر من القائمة`,
        mainMenuKeyboard()
      );
    }
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      `📋 دليل الاستخدام\n` +
      `─────────────────\n` +
      `/start  — القائمة الرئيسية\n` +
      `/menu   — العودة للقائمة\n` +
      `/status — الحالة الحالية\n` +
      `/cancel — إلغاء العملية\n` +
      `─────────────────\n` +
      `📊 أداء وظيفي\n` +
      `ينشئ 11 مجلداً تلقائياً\n\n` +
      `🗂 ملف إنجاز\n` +
      `مجلدات فرعية مخصصة\n` +
      `─────────────────\n` +
      `📤 رفع الملفات\n` +
      `• الصور والـ PDF والفيديو تُضغط تلقائياً\n` +
      `• أقصى حجم: 20MB\n` +
      `─────────────────\n` +
      `👨‍💻 ${DEVELOPER}`
    );
  });

  bot.catch((err: any, ctx) => {
    logger.error({ err, updateType: ctx.updateType }, "Bot error");
    if (ctx.chat) {
      ctx.reply("⚠️ حدث خطأ غير متوقع. يرجى المحاولة مجدداً أو /cancel للبدء من جديد.").catch(() => {});
    }
  });

  return bot;
}
