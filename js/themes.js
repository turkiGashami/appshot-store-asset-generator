// themes.js — ثيمات خلفيات الصور المُصدَّرة (منفصلة عن ثيم واجهة الموقع)
// مستوحاة من مخرجات المصمم: بنّي / ذهبي / أخضر + نسخة بيضاء.
// كل ثيم:
//   bg        : خلفية الصورة (لون صلب أو تدرّج)
//   textColor : لون نص العنوان فوق الخلفية
//   frameColor: لون إطار الجوال (اختياري، الافتراضي داكن)

export const THEMES = [
  {
    id: 'white',
    label: 'أبيض',
    bg: '#ffffff',
    textColor: '#1b1424',
    swatch: '#ffffff',
  },
  {
    id: 'brown',
    label: 'بنّي',
    bg: { type: 'linear', angle: 135, stops: ['#4a2c20', '#7a4a32'] },
    textColor: '#ffffff',
    swatch: '#5e3826',
  },
  {
    id: 'gold',
    label: 'ذهبي',
    bg: { type: 'linear', angle: 135, stops: ['#caa24a', '#e7c66a'] },
    textColor: '#3a2c0a',
    swatch: '#d4af37',
  },
  {
    id: 'green',
    label: 'أخضر',
    bg: { type: 'linear', angle: 135, stops: ['#0f5c46', '#1f8a66'] },
    textColor: '#ffffff',
    swatch: '#1f8a66',
  },
  {
    id: 'purple',
    label: 'بنفسجي',
    bg: { type: 'linear', angle: 135, stops: ['#6F008A', '#8A1FA9'] },
    textColor: '#ffffff',
    swatch: '#6F008A',
  },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// يبني fillStyle مناسبًا من تعريف الخلفية (لون صلب أو تدرّج) على سياق canvas معيّن.
export function resolveBackground(ctx, bg, width, height) {
  if (typeof bg === 'string') return bg;
  if (bg && bg.type === 'linear') {
    const angle = ((bg.angle || 135) * Math.PI) / 180;
    // اتجاه التدرّج عبر مركز الكانفاس
    const cx = width / 2;
    const cy = height / 2;
    const len = Math.max(width, height);
    const dx = (Math.cos(angle) * len) / 2;
    const dy = (Math.sin(angle) * len) / 2;
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const stops = bg.stops || ['#000', '#333'];
    stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
    return grad;
  }
  return '#ffffff';
}
