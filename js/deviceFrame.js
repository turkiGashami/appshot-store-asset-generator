// deviceFrame.js — يرسم إطار جوال vector (بزل داكن + زوايا دائرية) ويعيد
// مستطيل منطقة الشاشة الداخلية ليُرسم فيها السكرينشوت.
//
// drawDeviceFrame(ctx, { x, y, w, h, platform }) => { screenX, screenY, screenW, screenH, radius }

export function drawDeviceFrame(ctx, opts) {
  const { x, y, w, h, platform = 'ios' } = opts;
  const outerRadius = w * 0.13;
  const bezel = Math.round(w * 0.028);

  ctx.save();

  // ظل خفيف خلف الجهاز
  ctx.save();
  ctx.shadowColor = 'rgba(20, 12, 30, 0.28)';
  ctx.shadowBlur = w * 0.06;
  ctx.shadowOffsetY = h * 0.02;
  roundRectPath(ctx, x, y, w, h, outerRadius);
  ctx.fillStyle = '#1a1a1c';
  ctx.fill();
  ctx.restore();

  // جسم الإطار (تدرّج معدني)
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#3a3a3d');
  grad.addColorStop(0.35, '#1f1f22');
  grad.addColorStop(0.65, '#2c2c2f');
  grad.addColorStop(1, '#1a1a1c');
  roundRectPath(ctx, x, y, w, h, outerRadius);
  ctx.fillStyle = grad;
  ctx.fill();

  // منطقة الشاشة
  const screenX = x + bezel;
  const screenY = y + bezel;
  const screenW = w - bezel * 2;
  const screenH = h - bezel * 2;
  const screenRadius = outerRadius - bezel;

  ctx.restore();

  return { screenX, screenY, screenW, screenH, radius: Math.max(0, screenRadius) };
}

// يقصّ سياق الكانفاس على شكل الشاشة (لاستخدامه قبل رسم السكرينشوت بزوايا دائرية)
export function clipScreen(ctx, screenX, screenY, screenW, screenH, radius) {
  roundRectPath(ctx, screenX, screenY, screenW, screenH, radius);
  ctx.clip();
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
