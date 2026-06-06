// templates/feature.js — قالب صورة الكفر (Feature Graphic 1024×500):
// خلفية الثيم + لوجو موسّط (وإن وُجد عنوان يظهر تحته).

export function renderFeature(ctx, preset, config, helpers) {
  const { width, height } = preset;
  const { logo, title, theme } = config;

  helpers.paintBackground(ctx, theme, width, height);

  const hasTitle = !!title;
  const logoMaxH = height * (hasTitle ? 0.4 : 0.55);
  const logoMaxW = width * 0.6;

  let logoBottom = height / 2;
  if (logo) {
    const iw = logo.naturalWidth || logo.width;
    const ih = logo.naturalHeight || logo.height;
    const scale = Math.min(logoMaxW / iw, logoMaxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (width - dw) / 2;
    const dy = hasTitle ? height * 0.22 : (height - dh) / 2;
    ctx.drawImage(logo, dx, dy, dw, dh);
    logoBottom = dy + dh;
  }

  if (hasTitle) {
    helpers.drawTitle(ctx, title, {
      centerX: width / 2,
      top: logo ? logoBottom + height * 0.06 : height * 0.4,
      maxWidth: width * 0.85,
      fontSize: Math.round(height * 0.1),
      color: theme.textColor,
    });
  }
}
