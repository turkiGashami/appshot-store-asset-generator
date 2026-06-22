// templates/icon.js — قالب الأيقونة: لوجو موسّط على خلفية الثيم بهوامش مناسبة.

export function renderIcon(ctx, preset, config, helpers) {
  const { width, height } = preset;
  const { logo, theme, logoScale = 1 } = config;

  helpers.paintBackground(ctx, theme, width, height);

  if (!logo) return;

  // هامش الأيقونة ~ 18% من كل جهة (يتغيّر بمقياس الشعار)
  const pad = width * 0.18;
  const boxW = (width - pad * 2) * logoScale;
  const boxH = (height - pad * 2) * logoScale;

  const iw = logo.naturalWidth || logo.width;
  const ih = logo.naturalHeight || logo.height;
  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;

  ctx.drawImage(logo, dx, dy, dw, dh);
}
