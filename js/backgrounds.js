// backgrounds.js — خلفيات الصور الوصفية بطبقتين قابلتين للدمج:
//   BG_BASES  : أساس يملأ الكانفاس (تدرّج/صلب/إشعاعي…) — اختيار واحد.
//   BG_DECORS : زخارف شفافة تُرسم فوق الأساس (نجوم/حلقات/أعمدة…) — يمكن دمج أكثر من واحدة.
// كل الأشكال تُشتق من لون الثيم المختار (theme.swatch) فتتناسق مع أي براند.
// المواضع ثابتة (لا عشوائية) — نفس المدخلات تعطي نفس الصورة في كل تصدير.

import { resolveBackground, shade } from './themes.js';
import { drawPattern } from './layouts.js';

// اللون الأساس للاشتقاق (موجود على كل الثيمات بما فيها المخصصة).
const base = (theme) => theme.swatch;

// لون الزخارف فوق الخلفية: أبيض شفاف على الداكن، أسود شفاف على الفاتح.
function deco(theme, alpha) {
  const t = (theme.textColor || '#000').toLowerCase();
  const isLight = t === '#fff' || t === '#ffffff' || t === 'white';
  return isLight ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
}

// ---------------------------------------------------------------------------
// الأساسات — تملأ الكانفاس بالكامل
export const BG_BASES = [
  {
    id: 'gradient',
    label: 'تدرّج',
    paint(ctx, theme, w, h) {
      ctx.fillStyle = resolveBackground(ctx, theme.bg, w, h);
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'solid',
    label: 'صلب',
    paint(ctx, theme, w, h) {
      ctx.fillStyle = base(theme);
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'vertical',
    label: 'رأسي',
    paint(ctx, theme, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, shade(base(theme), 0.12));
      g.addColorStop(1, shade(base(theme), -0.22));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'radial',
    label: 'إشعاعي',
    paint(ctx, theme, w, h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.max(w, h) * 0.85);
      g.addColorStop(0, shade(base(theme), 0.16));
      g.addColorStop(1, shade(base(theme), -0.25));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'duo',
    label: 'قطري',
    paint(ctx, theme, w, h) {
      ctx.fillStyle = base(theme);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = shade(base(theme), -0.18);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.55);
      ctx.lineTo(w, h * 0.25);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'mesh',
    label: 'ضبابي',
    paint(ctx, theme, w, h) {
      ctx.fillStyle = base(theme);
      ctx.fillRect(0, 0, w, h);
      // بقع ضوئية ضبابية كبيرة (mesh gradient) بدرجات مشتقة من اللون
      const blobs = [
        [0.15, 0.1, 0.6, shade(base(theme), 0.25), 0.5],
        [0.9, 0.35, 0.55, shade(base(theme), -0.3), 0.45],
        [0.25, 0.9, 0.65, shade(base(theme), 0.15), 0.4],
        [0.85, 0.95, 0.4, shade(base(theme), -0.2), 0.35],
      ];
      blobs.forEach(([fx, fy, fr, color, alpha]) => {
        const r = w * fr;
        const g = ctx.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, r);
        const rgb = color.startsWith('rgb') ? color.slice(4, -1) : color;
        g.addColorStop(0, `rgba(${rgb},${alpha})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
    },
  },
];

// ---------------------------------------------------------------------------
// الزخارف — طبقات شفافة فوق الأساس، تقبل الدمج بأي تركيبة
export const BG_DECORS = [
  {
    id: 'bubbles',
    label: 'فقاعات',
    paint(ctx, theme, w, h) {
      const circles = [
        [w * 0.85, h * 0.12, w * 0.3, 0.14],
        [w * 0.08, h * 0.3, w * 0.18, 0.1],
        [w * 0.15, h * 0.85, w * 0.34, 0.12],
        [w * 0.92, h * 0.7, w * 0.2, 0.08],
      ];
      circles.forEach(([cx, cy, r, a]) => {
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  },
  {
    id: 'blob',
    label: 'كتلة',
    paint(ctx, theme, w, h) {
      ctx.fillStyle = shade(base(theme), -0.2);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.45);
      ctx.bezierCurveTo(w * 0.4, h * 0.3, w * 0.75, h * 0.55, w, h * 0.4);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'wave',
    label: 'موجة',
    paint(ctx, theme, w, h) {
      const wave = (baseY, amp, alpha) => {
        ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        ctx.bezierCurveTo(w * 0.25, baseY - amp, w * 0.6, baseY + amp, w, baseY - amp * 0.4);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
      };
      wave(h * 0.62, h * 0.06, 0.1);
      wave(h * 0.72, h * 0.05, 0.14);
    },
  },
  {
    id: 'sparkles',
    label: 'نجوم',
    paint(ctx, theme, w, h) {
      // نجوم رباعية + علامات بريق متناثرة بمواضع ثابتة
      const stars = [
        [0.08, 0.06, 0.030], [0.16, 0.11, 0.016], [0.88, 0.05, 0.022],
        [0.94, 0.12, 0.014], [0.06, 0.42, 0.018], [0.93, 0.5, 0.02],
        [0.1, 0.9, 0.026], [0.18, 0.95, 0.014], [0.86, 0.92, 0.028], [0.94, 0.84, 0.015],
      ];
      ctx.fillStyle = deco(theme, 0.5);
      stars.forEach(([fx, fy, fr]) => fourStar(ctx, w * fx, h * fy, w * fr));
      ctx.strokeStyle = deco(theme, 0.35);
      ctx.lineWidth = w * 0.004;
      ctx.lineCap = 'round';
      [[0.24, 0.05], [0.78, 0.1], [0.04, 0.55], [0.96, 0.65], [0.3, 0.93], [0.7, 0.96]].forEach(([fx, fy]) => {
        const s = w * 0.012;
        const cx = w * fx, cy = h * fy;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
        ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
        ctx.stroke();
      });
    },
  },
  {
    id: 'contours',
    label: 'طبوغرافي',
    paint(ctx, theme, w, h) {
      // خطوط كنتورية (تضاريس) — حلقات متعرّجة متراكزة حول زاويتين
      ctx.strokeStyle = deco(theme, 0.09);
      ctx.lineWidth = Math.max(1, w * 0.0035);
      const blob = (cx, cy, baseR, rings, seed) => {
        for (let k = 1; k <= rings; k++) {
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.08) {
            const wobble = 1 + 0.1 * Math.sin(3 * a + seed + k * 0.7) + 0.05 * Math.sin(7 * a + seed * 2);
            const r = baseR * k * wobble;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r * 0.85;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      };
      blob(w * 0.08, h * 0.1, w * 0.07, 7, 1.3);
      blob(w * 0.95, h * 0.92, w * 0.08, 8, 4.1);
    },
  },
  {
    id: 'shell',
    label: 'صدفة',
    paint(ctx, theme, w, h) {
      // مراوح بتلات مشعّة من الزوايا (كزخارف المصمم)
      const fan = (cx, cy, R, from, to, petals, alpha) => {
        ctx.strokeStyle = deco(theme, alpha);
        ctx.lineWidth = Math.max(1, w * 0.004);
        for (let i = 0; i <= petals; i++) {
          const a = from + ((to - from) * i) / petals;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          const tipX = cx + Math.cos(a) * R;
          const tipY = cy + Math.sin(a) * R;
          const spread = (to - from) / petals / 2.2;
          ctx.quadraticCurveTo(
            cx + Math.cos(a - spread) * R * 0.62, cy + Math.sin(a - spread) * R * 0.62,
            tipX, tipY
          );
          ctx.quadraticCurveTo(
            cx + Math.cos(a + spread) * R * 0.62, cy + Math.sin(a + spread) * R * 0.62,
            cx, cy
          );
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, R, from, to);
        ctx.stroke();
      };
      fan(w * 1.0, h * 0.28, w * 0.3, Math.PI * 0.55, Math.PI * 1.45, 9, 0.16);
      fan(w * 0.0, h * 0.78, w * 0.34, -Math.PI * 0.45, Math.PI * 0.45, 9, 0.14);
    },
  },
  {
    id: 'pillars',
    label: 'أعمدة',
    paint(ctx, theme, w, h) {
      const n = 9;
      const colW = w / n;
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) continue;
        ctx.fillStyle = deco(theme, 0.05);
        ctx.fillRect(i * colW, 0, colW, h);
      }
      ctx.fillStyle = deco(theme, 0.07);
      for (let i = 1; i < n; i++) ctx.fillRect(i * colW - 1, 0, 2, h);
    },
  },
  {
    id: 'hatch',
    label: 'تظليل',
    paint(ctx, theme, w, h) {
      // خطوط مائلة رفيعة جدًا تغطي الخلفية كاملة (نسيج ناعم)
      ctx.strokeStyle = deco(theme, 0.045);
      ctx.lineWidth = Math.max(1, w * 0.0018);
      const gap = w * 0.024;
      for (let x = -h; x < w + h; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h * 0.6, h);
        ctx.stroke();
      }
    },
  },
  // نقوش التخطيطات السابقة — زخارف مستقلة الآن (تعاد عبر drawPattern في layouts.js)
  { id: 'chevrons', label: 'أسهم', paint: (ctx, theme, w, h) => drawPattern(ctx, { pattern: 'chevron' }, theme, w, h) },
  { id: 'dots', label: 'نقاط', paint: (ctx, theme, w, h) => drawPattern(ctx, { pattern: 'dots' }, theme, w, h) },
  { id: 'linewaves', label: 'تموّجات', paint: (ctx, theme, w, h) => drawPattern(ctx, { pattern: 'waves' }, theme, w, h) },
  { id: 'diagstripes', label: 'أشرطة', paint: (ctx, theme, w, h) => drawPattern(ctx, { pattern: 'stripes' }, theme, w, h) },
  { id: 'rings', label: 'حلقات', paint: (ctx, theme, w, h) => drawPattern(ctx, { pattern: 'rings' }, theme, w, h) },
];

// نجمة رباعية (معيّن منحني الأضلاع) — زخرفة "البريق".
function fourStar(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + r);
  ctx.quadraticCurveTo(cx, cy, cx - r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - r);
  ctx.closePath();
  ctx.fill();
}

export function bgBaseById(id) {
  return BG_BASES.find((s) => s.id === id) || BG_BASES[0];
}
export function bgDecorById(id) {
  return BG_DECORS.find((s) => s.id === id) || null;
}

// توافق خلفي: bgStyleId القديم كان قائمة واحدة — لو كان زخرفةً نحوّله لأساس تدرّج + زخرفة.
export function migrateLegacyStyle(styleId) {
  if (!styleId) return { base: 'gradient', decors: [] };
  if (BG_BASES.some((s) => s.id === styleId)) return { base: styleId, decors: [] };
  if (BG_DECORS.some((s) => s.id === styleId)) return { base: 'gradient', decors: [styleId] };
  return { base: 'gradient', decors: [] };
}

// يرسم الأساس ثم الزخارف المختارة بالترتيب.
export function paintBackgroundStyle(ctx, theme, w, h, baseId, decorIds = []) {
  bgBaseById(baseId).paint(ctx, theme, w, h);
  decorIds.forEach((id) => {
    const d = bgDecorById(id);
    if (d) d.paint(ctx, theme, w, h);
  });
}
