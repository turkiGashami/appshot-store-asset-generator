// export.js — يولّد كل الصور المختارة ويجمعها في ملف ZIP واحد.
// يعتمد على JSZip المحمّل عالميًا (window.JSZip) من lib/jszip.min.js.

import { PRESETS } from './presets.js';
import { render } from './renderer.js';

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// يبني اسم ملف داخل الـ ZIP لكل preset (مع ترقيم السكرينشوتات).
function entryPath(preset, index) {
  if (preset.fileName) {
    return preset.folder ? `${preset.folder}/${preset.fileName}` : preset.fileName;
  }
  const num = String(index + 1).padStart(2, '0');
  return preset.folder ? `${preset.folder}/${num}.png` : `${num}.png`;
}

// shots: مصفوفة من configs (واحدة لكل سكرينشوت مرفوع).
// selectedPresetIds: قائمة الأحجام المطلوبة.
// shots: [{ screenshot, title, theme, layoutId }] لكل سكرينشوت إعداداته الخاصة.
// globalConfig: { platform, showFrame, statusBarRatio, logo } مشترك لكل الدفعة.
// iconConfig:   { theme, logo } لخلفية الأيقونات والكفر (منفصلة عن الصور الوصفية).
// onProgress(done, total)
export async function exportAll(shots, selectedPresetIds, globalConfig, iconConfig, onProgress) {
  if (!window.JSZip) throw new Error('JSZip غير محمّلة');
  const zip = new window.JSZip();
  const selected = PRESETS.filter((p) => selectedPresetIds.includes(p.id));
  const canvas = document.createElement('canvas');

  // الأيقونات والكفر تُولَّد مرة واحدة (لا تتكرر لكل سكرينشوت)
  const perShot = selected.filter((p) => p.type === 'screenshot');
  const once = selected.filter((p) => p.type !== 'screenshot');

  const total = perShot.length * Math.max(shots.length, 1) + once.length;
  let done = 0;

  // السكرينشوتات: لكل صورة مرفوعة × كل حجم سكرينشوت (بإعدادات الصورة الخاصة)
  for (let i = 0; i < shots.length; i++) {
    const cfg = { ...globalConfig, ...shots[i] };
    for (const preset of perShot) {
      render(canvas, preset, cfg);
      const blob = await canvasToBlob(canvas);
      zip.file(entryPath(preset, i), blob);
      onProgress && onProgress(++done, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // الأيقونات + الكفر (مرة واحدة، بخلفية الأيقونات المنفصلة)
  for (const preset of once) {
    render(canvas, preset, iconConfig);
    const blob = await canvasToBlob(canvas);
    zip.file(entryPath(preset, 0), blob);
    onProgress && onProgress(++done, total);
    await new Promise((r) => setTimeout(r, 0));
  }

  const content = await zip.generateAsync({ type: 'blob' });
  triggerDownload(content, 'store-assets.zip');
}

// تحميل صورة مفردة (للمعاينة الحالية)
export async function exportSingle(canvas, fileName) {
  const blob = await canvasToBlob(canvas);
  triggerDownload(blob, fileName || 'asset.png');
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
