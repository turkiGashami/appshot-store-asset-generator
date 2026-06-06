// app.js — نقطة الدخول: إدارة الحالة وربط الواجهة بمحرّك الرسم والتصدير.

import { PRESETS, GROUPS, presetById } from './presets.js';
import { THEMES, themeById } from './themes.js';
import { render, loadImage, fileToDataURL, ensureFontsReady } from './renderer.js';
import { exportAll, exportSingle } from './export.js';

// ---------- الحالة ----------
const state = {
  shots: [], // [{ name, img }]
  logo: null, // img
  title: '',
  themeId: THEMES[1].id, // بنّي افتراضيًا
  platform: 'ios',
  showFrame: true,
  selected: new Set(PRESETS.filter((p) => p.defaultOn).map((p) => p.id)),
  previewShot: 0,
  previewPresetId: PRESETS.find((p) => p.type === 'screenshot').id,
};

// ---------- عناصر DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  shotsInput: $('shotsInput'),
  logoInput: $('logoInput'),
  titleInput: $('titleInput'),
  themeSwatches: $('themeSwatches'),
  frameToggle: $('frameToggle'),
  presetsList: $('presetsList'),
  platformGroup: $('platformGroup'),
  exportBtn: $('exportBtn'),
  downloadCurrentBtn: $('downloadCurrentBtn'),
  spinner: $('spinner'),
  progress: $('progress'),
  errorBox: $('error-box'),
  previewCanvas: $('previewCanvas'),
  previewPreset: $('previewPreset'),
  emptyHint: $('emptyHint'),
  thumbs: $('thumbs'),
};

// ---------- بناء عناصر الواجهة الديناميكية ----------
function buildThemes() {
  els.themeSwatches.innerHTML = '';
  THEMES.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (t.id === state.themeId ? ' is-active' : '');
    b.title = t.label;
    b.style.background = t.swatch;
    b.dataset.theme = t.id;
    b.addEventListener('click', () => {
      state.themeId = t.id;
      buildThemes();
      renderPreview();
    });
    els.themeSwatches.appendChild(b);
  });
}

function buildPresets() {
  els.presetsList.innerHTML = '';
  GROUPS.forEach((g) => {
    const groupPresets = PRESETS.filter((p) => p.group === g.id);
    if (!groupPresets.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'presets__group';
    const h = document.createElement('div');
    h.className = 'presets__group-title';
    h.textContent = g.label;
    wrap.appendChild(h);
    groupPresets.forEach((p) => {
      const label = document.createElement('label');
      label.className = 'presets__item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.selected.has(p.id);
      cb.addEventListener('change', () => {
        if (cb.checked) state.selected.add(p.id);
        else state.selected.delete(p.id);
      });
      const span = document.createElement('span');
      span.textContent = p.label;
      label.appendChild(cb);
      label.appendChild(span);
      wrap.appendChild(label);
    });
    els.presetsList.appendChild(wrap);
  });
}

function buildPreviewPresetOptions() {
  els.previewPreset.innerHTML = '';
  PRESETS.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    if (p.id === state.previewPresetId) opt.selected = true;
    els.previewPreset.appendChild(opt);
  });
}

function buildThumbs() {
  els.thumbs.innerHTML = '';
  state.shots.forEach((shot, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'thumb' + (i === state.previewShot ? ' is-active' : '');
    const img = document.createElement('img');
    img.src = shot.img.src;
    d.appendChild(img);
    d.addEventListener('click', () => {
      state.previewShot = i;
      buildThumbs();
      renderPreview();
    });
    els.thumbs.appendChild(d);
  });
}

// ---------- المعاينة ----------
function currentConfig() {
  return {
    title: state.title,
    theme: themeById(state.themeId),
    platform: state.platform,
    showFrame: state.showFrame,
    logo: state.logo,
  };
}

async function renderPreview() {
  await ensureFontsReady();
  const preset = presetById(state.previewPresetId);
  const cfg = currentConfig();
  const shot = state.shots[state.previewShot];
  if (preset.type === 'screenshot') {
    cfg.screenshot = shot ? shot.img : null;
  }
  const hasContent =
    (preset.type === 'screenshot' && shot) ||
    (preset.type !== 'screenshot' && state.logo);
  els.emptyHint.hidden = hasContent;
  els.previewCanvas.style.visibility = hasContent ? 'visible' : 'hidden';
  if (!hasContent) return;
  render(els.previewCanvas, preset, cfg);
}

// ---------- الأحداث ----------
function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = !msg;
}

els.shotsInput.addEventListener('change', async (e) => {
  showError('');
  const files = [...e.target.files];
  for (const f of files) {
    try {
      const url = await fileToDataURL(f);
      const img = await loadImage(url);
      state.shots.push({ name: f.name, img });
    } catch (err) {
      showError('تعذّر تحميل إحدى الصور: ' + f.name);
    }
  }
  state.previewShot = 0;
  buildThumbs();
  renderPreview();
});

els.logoInput.addEventListener('change', async (e) => {
  showError('');
  const f = e.target.files[0];
  if (!f) return;
  try {
    const url = await fileToDataURL(f);
    state.logo = await loadImage(url);
    renderPreview();
  } catch (err) {
    showError('تعذّر تحميل اللوجو.');
  }
});

els.titleInput.addEventListener('input', (e) => {
  state.title = e.target.value;
  renderPreview();
});

els.platformGroup.addEventListener('change', (e) => {
  if (e.target.name === 'platform') {
    state.platform = e.target.value;
    renderPreview();
  }
});

els.frameToggle.addEventListener('change', (e) => {
  state.showFrame = e.target.checked;
  renderPreview();
});

els.previewPreset.addEventListener('change', (e) => {
  state.previewPresetId = e.target.value;
  renderPreview();
});

els.downloadCurrentBtn.addEventListener('click', () => {
  const preset = presetById(state.previewPresetId);
  exportSingle(els.previewCanvas, `${preset.id}.png`);
});

els.exportBtn.addEventListener('click', async () => {
  showError('');
  if (!state.selected.size) {
    showError('اختر حجمًا واحدًا على الأقل.');
    return;
  }
  const needsShots = [...state.selected].some((id) => presetById(id).type === 'screenshot');
  const needsLogo = [...state.selected].some((id) => presetById(id).type !== 'screenshot');
  if (needsShots && !state.shots.length) {
    showError('ارفع سكرينشوت واحدًا على الأقل لأحجام السكرينشوت.');
    return;
  }
  if (needsLogo && !state.logo) {
    showError('ارفع اللوجو لتوليد الأيقونات/الكفر، أو ألغِ اختيارها.');
    return;
  }

  await ensureFontsReady();
  setBusy(true);
  try {
    const shotsConfig = state.shots.map((s) => ({ screenshot: s.img }));
    await exportAll(shotsConfig, [...state.selected], currentConfig(), (done, total) => {
      els.progress.hidden = false;
      els.progress.textContent = `جارٍ التصدير… ${done}/${total}`;
    });
    els.progress.textContent = 'تم! تم تنزيل الملف store-assets.zip';
  } catch (err) {
    showError('فشل التصدير: ' + (err.message || err));
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  els.exportBtn.disabled = busy;
  els.spinner.hidden = !busy;
}

// ---------- التهيئة ----------
buildThemes();
buildPresets();
buildPreviewPresetOptions();
buildThumbs();
renderPreview();
