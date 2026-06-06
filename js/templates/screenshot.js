// templates/screenshot.js — قالب السكرينشوت التسويقي:
// خلفية الثيم + عنوان أعلى + إطار جوال (اختياري) + السكرينشوت مع شريط حالة موحّد فوقه.

import { drawDeviceFrame, clipScreen, roundRectPath } from '../deviceFrame.js';
import { drawStatusBar, statusBarHeight } from '../statusBar.js';

export function renderScreenshot(ctx, preset, config, helpers) {
  const { width, height } = preset;
  const { screenshot, title, theme, platform = 'ios', showFrame = true } = config;

  // 1) الخلفية
  helpers.paintBackground(ctx, theme, width, height);

  // 2) العنوان أعلى الصورة
  const titleFont = Math.round(width * 0.058);
  const titleTop = Math.round(height * 0.04);
  let titleBlock = 0;
  if (title) {
    titleBlock = helpers.drawTitle(ctx, title, {
      centerX: width / 2,
      top: titleTop,
      maxWidth: width * 0.86,
      fontSize: titleFont,
      color: theme.textColor,
    });
  }

  if (!screenshot) return;

  // 3) منطقة الجهاز: تحت العنوان مع هوامش
  const topGap = title ? titleTop + titleBlock + height * 0.03 : height * 0.06;
  const bottomGap = height * 0.05;
  const availH = height - topGap - bottomGap;
  const sideMargin = width * (showFrame ? 0.12 : 0.08);
  const availW = width - sideMargin * 2;

  // نسبة أبعاد السكرينشوت
  const imgRatio = (screenshot.naturalHeight || screenshot.height) / (screenshot.naturalWidth || screenshot.width);

  // نحسب حجم الجهاز ليتسع ضمن المساحة المتاحة محافظًا على نسبة الصورة
  let frameW = availW;
  let frameH = frameW * imgRatio;
  if (frameH > availH) {
    frameH = availH;
    frameW = frameH / imgRatio;
  }
  const frameX = (width - frameW) / 2;
  const frameY = topGap + (availH - frameH) / 2;

  if (showFrame) {
    const screen = drawDeviceFrame(ctx, { x: frameX, y: frameY, w: frameW, h: frameH, platform });
    drawScreenshotInto(ctx, screenshot, screen, platform, helpers);
  } else {
    // بدون إطار: زوايا دائرية بسيطة
    const radius = frameW * 0.08;
    ctx.save();
    roundRectPath(ctx, frameX, frameY, frameW, frameH, radius);
    ctx.clip();
    drawCover(ctx, screenshot, frameX, frameY, frameW, frameH);
    ctx.restore();
    overlayStatusBar(ctx, screenshot, frameX, frameY, frameW, platform, helpers);
  }
}

// يرسم السكرينشوت داخل منطقة شاشة الجهاز ثم يضع شريط الحالة فوقه.
function drawScreenshotInto(ctx, img, screen, platform, helpers) {
  const { screenX, screenY, screenW, screenH, radius } = screen;
  ctx.save();
  clipScreen(ctx, screenX, screenY, screenW, screenH, radius);
  drawCover(ctx, img, screenX, screenY, screenW, screenH);
  // شريط الحالة فوق السكرينشوت (داخل القص)
  const tint = helpers.detectTopTint(img);
  const bgFill = helpers.topBackgroundColor(img);
  drawStatusBar(ctx, { x: screenX, y: screenY, w: screenW, platform, tint, bgFill });
  ctx.restore();
}

// نسخة بدون إطار
function overlayStatusBar(ctx, img, x, y, w, platform, helpers) {
  const radius = w * 0.08;
  ctx.save();
  roundRectPath(ctx, x, y, w, statusBarHeight(w, platform) + radius, radius);
  ctx.clip();
  const tint = helpers.detectTopTint(img);
  const bgFill = helpers.topBackgroundColor(img);
  drawStatusBar(ctx, { x, y, w, platform, tint, bgFill });
  ctx.restore();
}

// يرسم الصورة بأسلوب cover (يملأ المنطقة مع قص الفائض، محافظًا على النسبة).
function drawCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
