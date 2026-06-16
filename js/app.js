// app.js — نقطة الدخول: إدارة الحالة وربط الواجهة بمحرّك الرسم والتصدير.

import { PRESETS, GROUPS, presetById } from './presets.js';
import { THEMES, themeById, makeCustomTheme, hexShade } from './themes.js';
import { LAYOUTS } from './layouts.js';
import { BG_BASES, BG_DECORS, migrateLegacyStyle } from './backgrounds.js';
import { render, loadImage, fileToDataURL, ensureFontsReady } from './renderer.js';
import { exportAll, exportSingle } from './export.js';
import {
  validateMerchantConfig, buildExportConfig, downloadConfig,
  listPresets, savePreset, deletePreset, presetByName,
} from './merchantConfig.js';

// ---------- جلب إعدادات المتجر (لون + شعار) عبر بروكسي CORS ----------
// نفس آلية مشروع zid_web_mockup_app.
const PROXY_URL = 'https://zid-mockup-proxy.dev-60c.workers.dev';

function normalizeUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\/+$/, '');
}
const viaProxy = (target) => `${PROXY_URL}/${target}`;

// يقرأ صفحة المتجر نفسها ويستخرج الهوية (ألوان + شعار + اسم) من الـ HTML.
// يعمل مع أي منصة (زد، سلة، شوبيفاي…) — API زد القديم (/api/v1/settings) صار deprecated.
async function fetchStoreBranding(storeUrl) {
  const res = await fetch(viaProxy(storeUrl), { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  const html = await res.text();
  const pick = (...patterns) => {
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return m[1];
    }
    return null;
  };

  // اللون الأساسي: متغيرات CSS الشائعة ثم theme-color
  const primary = pick(
    /--(?:color-primary|primary-color|store-primary|main-color|brand-color|primary)\s*:\s*(#[0-9a-fA-F]{3,8})/,
    /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,8})["']/i
  );
  // درجات إضافية من هوية المتجر إن وُجدت (سلة تعرّف dark/light مثلًا)
  const extras = [
    pick(/--(?:color-primary-dark|primary-dark)\s*:\s*(#[0-9a-fA-F]{3,8})/),
    pick(/--(?:color-primary-light|primary-light)\s*:\s*(#[0-9a-fA-F]{3,8})/),
    pick(/--(?:color-secondary|secondary-color|store-secondary)\s*:\s*(#[0-9a-fA-F]{3,8})/),
  ].filter(Boolean);

  // الشعار: <img> بكلاس logo، ثم JSON-LD، ثم og:image كخيار أخير
  let logo = pick(
    /<img[^>]+class=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*logo[^"']*["']/i,
    /"logo"\s*:\s*"(https?:[^"]+)"/,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  );
  if (logo) {
    logo = logo.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    try { logo = new URL(logo, storeUrl).href; } catch (e) { logo = null; }
  }

  const name = pick(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([^<|–-]+)/i
  );

  return { name: name ? name.trim() : '', primary: normalizeHex(primary), logo, extras: extras.map(normalizeHex).filter(Boolean) };
}

// ‎#abc → ‎#aabbcc، ويرفض أي صيغة غير صالحة.
function normalizeHex(hex) {
  if (!hex) return null;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6); // تجاهل قناة الألفا
  return /^[0-9a-fA-F]{6}$/.test(h) ? '#' + h.toLowerCase() : null;
}

// تحميل صورة من رابط خارجي بأمان للكانفاس (عبر البروكسي + crossOrigin).
function loadImageCors(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---------- الحالة ----------
// كل سكرينشوت له إعداداته الخاصة (عنوان/ثيم/تخطيط) ليختلف عن بقية الصفحات.
const state = {
  shots: [], // [{ name, img, title, themeId, layoutId, customColor }]
  defaults: { title: '', themeId: 'brown', layoutId: LAYOUTS[0].id, customColor: '#6F008A', bgBaseId: 'gradient', bgDecors: [], showLogo: false },
  logo: null,
  platform: 'ios',          // مشترك للدفعة
  statusBarRatio: 0.12,     // مشترك (تغطية شريط الحالة)
  showFrame: true,          // مشترك
  showHeaderLogo: false,    // إظهار شعار المتجر أعلى كل الصفحات
  iconThemeId: 'purple',    // خلفية الأيقونات/الكفر (منفصلة عن الصور الوصفية)
  iconCustomColor: '#6F008A',
  bgGradient: true,         // خلفية اللون المخصص: تدرّج أو لون صلب (من إعداد التاجر)
  brandPalette: [],         // ألوان الهوية (من المتجر/الاستيراد) — تظهر كحبّات جاهزة قابلة للتعديل
  appName: '',              // اسم التطبيق من إعداد التاجر المستورد
  lastImported: null,       // آخر merchant config مستورد (للحفاظ على round-trip كامل)
  selected: new Set(PRESETS.filter((p) => p.defaultOn).map((p) => p.id)),
  previewShot: 0,
  previewPresetId: PRESETS.find((p) => p.type === 'screenshot').id,
};

// الهدف الذي تعدّله عناصر التحكم (الصورة المحددة، أو الإعدادات الافتراضية إن لم توجد صور).
function activeTarget() {
  return state.shots[state.previewShot] || state.defaults;
}

// ---------- حفظ واستعادة الجلسة (localStorage) ----------
// الإعدادات والشعار يبقيان بعد إغلاق الصفحة — السكرينشوتات لا تُحفظ (حجمها كبير).
const SESSION_KEY = 'sag:lastSession';

// يحوّل صورة الشعار لـ dataURL قابل للحفظ (null لو الكانفاس ملوّث بمصدر خارجي).
function imageToDataURL(img) {
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

function setLogo(img) {
  state.logo = img;
  state.logoDataURL = img ? imageToDataURL(img) : null;
  updateLogoPreview();
}

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      defaults: state.defaults,
      platform: state.platform,
      statusBarRatio: state.statusBarRatio,
      showFrame: state.showFrame,
      showHeaderLogo: state.showHeaderLogo,
      iconThemeId: state.iconThemeId,
      iconCustomColor: state.iconCustomColor,
      bgGradient: state.bgGradient,
      appName: state.appName,
      lastImported: state.lastImported,
      logoDataURL: state.logoDataURL || null,
      brandPalette: state.brandPalette,
    }));
  } catch (e) {
    /* امتلاء localStorage — نتجاهل، الجلسة الحالية لا تتأثر */
  }
}

async function restoreSession() {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch (e) { return; }
  if (!s) return;
  Object.assign(state.defaults, s.defaults || {});
  // هجرة جلسات قديمة: bgStyleId الواحد → أساس + زخارف
  if (state.defaults.bgStyleId && !s.defaults.bgBaseId) {
    const m = migrateLegacyStyle(state.defaults.bgStyleId);
    state.defaults.bgBaseId = m.base;
    state.defaults.bgDecors = m.decors;
    delete state.defaults.bgStyleId;
  }
  if (!Array.isArray(state.defaults.bgDecors)) state.defaults.bgDecors = [];
  if (s.platform) state.platform = s.platform;
  if (typeof s.statusBarRatio === 'number') state.statusBarRatio = s.statusBarRatio;
  if (typeof s.showFrame === 'boolean') state.showFrame = s.showFrame;
  if (typeof s.showHeaderLogo === 'boolean') state.showHeaderLogo = s.showHeaderLogo;
  if (s.iconThemeId) state.iconThemeId = s.iconThemeId;
  if (s.iconCustomColor) state.iconCustomColor = s.iconCustomColor;
  if (typeof s.bgGradient === 'boolean') state.bgGradient = s.bgGradient;
  state.appName = s.appName || '';
  state.lastImported = s.lastImported || null;
  if (Array.isArray(s.brandPalette)) state.brandPalette = s.brandPalette;
  if (s.logoDataURL) {
    try { setLogo(await loadImage(s.logoDataURL)); } catch (e) { /* شعار تالف — نتجاهله */ }
  }
  // مزامنة عناصر التحكم مع الحالة المستعادة
  els.frameToggle.checked = state.showFrame;
  els.headerLogoToggle.checked = state.showHeaderLogo;
  const radio = els.platformGroup.querySelector(`input[value="${state.platform}"]`);
  if (radio) radio.checked = true;
}

function updateLogoPreview() {
  if (!els.logoPreview) return;
  if (state.logo) {
    els.logoPreview.src = state.logo.src;
    els.logoPreviewRow.hidden = false;
  } else {
    els.logoPreviewRow.hidden = true;
  }
}

// ---------- عناصر DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  storeUrlInput: $('storeUrlInput'),
  fetchStoreBtn: $('fetchStoreBtn'),
  fetchSpinner: $('fetchSpinner'),
  storeInfo: $('storeInfo'),
  storeName: $('storeName'),
  storeColorHex: $('storeColorHex'),
  storeColorSwatch: $('storeColorSwatch'),
  headerLogoToggle: $('headerLogoToggle'),
  merchantConfigInput: $('merchantConfigInput'),
  importConfigBtn: $('importConfigBtn'),
  exportConfigBtn: $('exportConfigBtn'),
  presetSelect: $('presetSelect'),
  savePresetBtn: $('savePresetBtn'),
  deletePresetBtn: $('deletePresetBtn'),
  shotsInput: $('shotsInput'),
  logoInput: $('logoInput'),
  logoPreviewRow: $('logoPreviewRow'),
  logoPreview: $('logoPreview'),
  titleInput: $('titleInput'),
  themeSwatches: $('themeSwatches'),
  iconThemeSwatches: $('iconThemeSwatches'),
  layoutChips: $('layoutChips'),
  bgBaseChips: $('bgBaseChips'),
  bgDecorChips: $('bgDecorChips'),
  shotLogoToggle: $('shotLogoToggle'),
  openMockupBtn: $('openMockupBtn'),
  stageTabs: $('stageTabs'),
  mockupFrame: $('mockupFrame'),
  captureMockupBtn: $('captureMockupBtn'),
  openTabBtn: $('openTabBtn'),
  mockupEmpty: $('mockupEmpty'),
  mockupHint: $('mockupHint'),
  cropOverlay: $('cropOverlay'),
  cropCanvas: $('cropCanvas'),
  cropConfirmBtn: $('cropConfirmBtn'),
  cropCancelBtn: $('cropCancelBtn'),
  statusBarRange: $('statusBarRange'),
  statusBarVal: $('statusBarVal'),
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

// ---------- بناة الواجهة الديناميكية ----------
// opts: { currentId(), onPick(id), customColor(), onCustom(hex) }
function buildSwatches(container, opts) {
  container.innerHTML = '';
  const active = opts.currentId();
  THEMES.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (t.id === active ? ' is-active' : '');
    b.title = t.label;
    b.style.background = t.swatch;
    b.addEventListener('click', () => {
      opts.onPick(t.id);
      buildSwatches(container, opts);
      renderPreview();
    });
    container.appendChild(b);
  });

  // ألوان الهوية المجلوبة من المتجر (قابلة للتعديل: اخترها ثم عدّلها بالمنتقي)
  (state.brandPalette || []).forEach((hex) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch swatch--brand' + (active === 'custom' && opts.customColor() === hex ? ' is-active' : '');
    b.title = 'من هوية المتجر: ' + hex;
    b.style.background = hex;
    b.addEventListener('click', () => {
      opts.onCustom(hex);
      buildSwatches(container, opts);
      renderPreview();
    });
    container.appendChild(b);
  });

  // لون مخصص (color picker)
  const label = document.createElement('label');
  label.className = 'swatch swatch--custom' + (active === 'custom' ? ' is-active' : '');
  label.title = 'لون مخصص';
  label.style.background = active === 'custom' ? opts.customColor() : '';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = opts.customColor();
  // أثناء السحب داخل المنتقي: حدّث الحالة والمعاينة فقط — إعادة بناء العناصر هنا
  // تدمّر المنتقي المفتوح وتقفله (سبب مشكلة "يختار اللون علطول").
  input.addEventListener('input', (e) => {
    opts.onCustom(e.target.value);
    label.style.background = e.target.value;
    label.classList.add('is-active');
    renderPreview();
  });
  // عند الإغلاق/التأكيد فقط: أعد بناء الصف لمزامنة حالة التحديد
  input.addEventListener('change', () => {
    buildSwatches(container, opts);
  });
  label.appendChild(input);
  container.appendChild(label);
}

function buildLayouts() {
  els.layoutChips.innerHTML = '';
  LAYOUTS.forEach((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (l.id === activeTarget().layoutId ? ' is-active' : '');
    b.textContent = l.label;
    b.addEventListener('click', () => {
      activeTarget().layoutId = l.id;
      buildLayouts();
      renderPreview();
    });
    els.layoutChips.appendChild(b);
  });
}

function buildBgStyles() {
  // أساس الخلفية — اختيار واحد
  els.bgBaseChips.innerHTML = '';
  BG_BASES.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (s.id === activeTarget().bgBaseId ? ' is-active' : '');
    b.textContent = s.label;
    b.addEventListener('click', () => {
      activeTarget().bgBaseId = s.id;
      buildBgStyles();
      renderPreview();
    });
    els.bgBaseChips.appendChild(b);
  });
  // الزخارف — تبديل متعدد (يمكن دمج أكثر من زخرفة)
  els.bgDecorChips.innerHTML = '';
  BG_DECORS.forEach((s) => {
    const t = activeTarget();
    if (!Array.isArray(t.bgDecors)) t.bgDecors = [];
    const on = t.bgDecors.includes(s.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (on ? ' is-active' : '');
    b.textContent = s.label;
    b.addEventListener('click', () => {
      const cur = activeTarget();
      cur.bgDecors = cur.bgDecors.includes(s.id)
        ? cur.bgDecors.filter((id) => id !== s.id)
        : [...cur.bgDecors, s.id];
      buildBgStyles();
      renderPreview();
    });
    els.bgDecorChips.appendChild(b);
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
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'thumb' + (i === state.previewShot ? ' is-active' : '');
    const img = document.createElement('img');
    img.src = shot.img.src;
    d.appendChild(img);
    d.addEventListener('click', () => {
      state.previewShot = i;
      buildThumbs();
      syncControls();
      renderPreview();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'thumb-del';
    del.title = 'حذف الصورة';
    del.textContent = '✕';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.shots.splice(i, 1);
      if (state.previewShot >= state.shots.length) state.previewShot = Math.max(0, state.shots.length - 1);
      buildThumbs();
      syncControls();
      renderPreview();
    });
    wrap.appendChild(d);
    wrap.appendChild(del);
    els.thumbs.appendChild(wrap);
  });
}

// مزامنة عناصر التحكم (عنوان/ثيم/تخطيط/شعار) مع إعدادات الصورة المحددة.
function syncControls() {
  const t = activeTarget();
  els.titleInput.value = t.title || '';
  els.shotLogoToggle.checked = !!t.showLogo;
  buildSwatches(els.themeSwatches, {
    currentId: () => activeTarget().themeId,
    onPick: (id) => { activeTarget().themeId = id; },
    customColor: () => activeTarget().customColor,
    onCustom: (hex) => { const a = activeTarget(); a.themeId = 'custom'; a.customColor = hex; },
  });
  buildLayouts();
  buildBgStyles();
}

// يحلّ ثيم الصورة الوصفية (مع دعم اللون المخصص).
function shotTheme(t) {
  return t.themeId === 'custom' ? makeCustomTheme(t.customColor, state.bgGradient) : themeById(t.themeId);
}
function iconTheme() {
  return state.iconThemeId === 'custom' ? makeCustomTheme(state.iconCustomColor, state.bgGradient) : themeById(state.iconThemeId);
}

// ---------- المعاينة ----------
function configFor(preset) {
  if (preset.type === 'screenshot') {
    const t = activeTarget();
    return {
      title: t.title,
      theme: shotTheme(t),
      layoutId: t.layoutId,
      bgBaseId: t.bgBaseId,
      bgDecors: t.bgDecors || [],
      platform: state.platform,
      statusBarRatio: state.statusBarRatio,
      showFrame: state.showFrame,
      showHeaderLogo: !!t.showLogo,
      logo: state.logo,
      screenshot: state.shots[state.previewShot] ? state.shots[state.previewShot].img : null,
    };
  }
  // أيقونة / كفر
  return { theme: iconTheme(), logo: state.logo };
}

async function renderPreview() {
  saveSession(); // كل تغيير يمر من هنا — أرخص نقطة حفظ تلقائي
  await ensureFontsReady();
  const preset = presetById(state.previewPresetId);
  const cfg = configFor(preset);
  const hasContent =
    (preset.type === 'screenshot' && cfg.screenshot) ||
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

// صور الآيفون كثيرًا ما تصل بصيغة HEIC التي لا تفكّها المتصفحات —
// نحوّلها لـ JPEG عبر heic-to (libheif حديثة تدعم صور HDR 10-bit من الآيفونات الجديدة).
// تُحمَّل عند الحاجة فقط (الملف ~3MB).
let heicToModule = null;
function isHeic(file) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function fileToImage(f) {
  let blob = f;
  if (isHeic(f)) {
    try {
      if (!heicToModule) heicToModule = await import('../lib/heic-to.min.js');
      blob = await heicToModule.heicTo({ blob: f, type: 'image/jpeg', quality: 0.95 });
    } catch (e) {
      blob = f; // بعض المتصفحات (Safari) تفك HEIC مباشرة — نجرب التحميل المباشر قبل الاستسلام
    }
  }
  const url = await fileToDataURL(blob);
  return loadImage(url);
}

els.shotsInput.addEventListener('change', async (e) => {
  showError('');
  // الترتيب حسب اسم الملف (الصور المُلتقطة مرقمة: 01-home.png…) = ترتيب الرفع النهائي في الـ ZIP.
  const files = [...e.target.files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  for (const f of files) {
    try {
      const img = await fileToImage(f);
      state.shots.push({ name: f.name, img, ...state.defaults });
    } catch (err) {
      showError('تعذّر تحميل إحدى الصور: ' + f.name + (isHeic(f) ? ' — فشل تحويل HEIC، حوّلها يدويًا لـ PNG/JPG' : ' — تأكد أنها PNG أو JPG'));
    }
  }
  state.previewShot = state.shots.length ? state.shots.length - files.length : 0;
  buildThumbs();
  syncControls();
  renderPreview();
});

// ---------- التصفح والالتقاط من معاينة المتجر ----------
// تحمّل موقع المتجر الحقيقي عبر البروكسي داخل إطار جوال (390px = عرض موبايل)،
// وزر الالتقاط يصوّر التبويب الحالي عبر getDisplayMedia ويقص منطقة الشاشة بدقة
// (الإطار عنصر عندنا فموضعه معروف دائمًا).
// ملاحظة: متاجر سلة تمنع التضمين (CSP frame-ancestors) — متاجر زد تعمل.

// رسالة داخل لوحة المعاينة (الشريط الجانبي مغطّى باللوحة فلا تظهر أخطاؤه).
// mockupMsg → طبقة فوق الإطار (تحميل/فراغ). mockupHint → السطر السفلي (لا يغطّي المعاينة).
function mockupMsg(text) {
  els.mockupEmpty.textContent = text || '';
  els.mockupEmpty.hidden = !text;
}
const MOCKUP_HINT_DEFAULT = els.mockupHint.textContent;
function mockupHint(text) {
  els.mockupHint.textContent = text || MOCKUP_HINT_DEFAULT;
}

// أداة معاينة التطبيق (تطبيق Flutter) — منسوخة داخل ريبونا تحت mockup/v2/ لتكون
// same-origin مع أداتنا، فيعمل قراءة موضع شاشة الجوال والقص التلقائي الدقيق.
// (canvaskit يُحمَّل من gstatic CDN، فلم نحتج نسخه.)
const MOCKUP_TOOL_URL = 'mockup/v2/';

// ---------- تبويبات منطقة العرض ----------
// تبديل بين "تصميم الصورة" و"تصفّح المتجر"، وتحميل أداة المعاينة عند أول دخول للتبويب.
function showTab(name) {
  els.stageTabs.querySelectorAll('.tabs__tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.tab === name);
  });
  document.querySelectorAll('.stage__panel').forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  // تاب التصفّح يأخذ كامل النافذة (يخفي الشريط الجانبي) لعرض الجوال بحجم أكبر
  document.body.classList.toggle('browse-active', name === 'browse');
  if (name === 'browse') {
    ensureMockupLoaded();
    fitMockupFrame();
  }
}

// أداة المعاينة تُرسم بمقاس سطح المكتب (الجوال بارز)؛ نصغّرها لتُعرض كاملة داخل التاب.
const MOCK_W = 1200;
const MOCK_H = 820;
// موضع شاشة الجوال داخل الموك أب (بإحداثيات محتوى الإطار = فضاء scaler)، أو null.
function innerPhoneRect() {
  try {
    const doc = els.mockupFrame.contentDocument;
    if (!doc) return null;
    const el = doc.getElementById('preview-iframe') || doc.querySelector('.phone__screen');
    if (!el) return null;
    // نكبّر فقط بعد تحميل متجر فعلي (لا قبلها — يبقى الفورم ظاهرًا لإدخال الرابط).
    const appIframe = doc.getElementById('preview-iframe');
    const loaded = appIframe && appIframe.src && appIframe.src !== 'about:blank';
    if (!loaded) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 20) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  } catch (e) {
    return null; // cross-origin
  }
}

function fitMockupFrame() {
  const stage = document.querySelector('.browse__stage');
  const scaler = document.querySelector('.browse__scaler');
  if (!stage || !scaler) return;
  els.mockupFrame.style.width = MOCK_W + 'px';
  els.mockupFrame.style.height = MOCK_H + 'px';
  scaler.style.width = MOCK_W + 'px';
  scaler.style.height = MOCK_H + 'px';

  // متجر محمّل (same-origin): نكبّر الجوال ليملأ المنطقة → أقصى دقة ممكنة، ثابتة.
  const phone = innerPhoneRect();
  if (phone) {
    const s = Math.min((stage.clientHeight * 0.98) / phone.h, (stage.clientWidth * 0.98) / phone.w);
    const cx = phone.x + phone.w / 2;
    const cy = phone.y + phone.h / 2;
    scaler.style.transformOrigin = `${cx}px ${cy}px`;
    scaler.style.left = (stage.clientWidth / 2 - cx) + 'px';
    scaler.style.top = (stage.clientHeight / 2 - cy) + 'px';
    scaler.style.transform = `scale(${s})`;
    return;
  }
  // قبل التحميل (أو cross-origin): نعرض الموك أب كاملًا موسّطًا (الفورم ظاهر).
  const scale = Math.min(stage.clientWidth / MOCK_W, stage.clientHeight / MOCK_H, 1);
  scaler.style.left = '50%';
  scaler.style.top = '50%';
  scaler.style.transformOrigin = 'center center';
  scaler.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

// إعادة الملاءمة عدة مرات بعد تشغيل المعاينة (لالتقاط لحظة تحميل المتجر والتكبير).
function refitAfterLoad() {
  [600, 1500, 3000, 6000].forEach((ms) => setTimeout(() => {
    if (document.body.classList.contains('browse-active')) fitMockupFrame();
  }, ms));
}
window.addEventListener('resize', () => {
  if (document.body.classList.contains('browse-active')) fitMockupFrame();
});

// يحمّل الأداة الرسمية مرة واحدة (lazy) ويحاول تعبئة رابط المتجر تلقائيًا.
function ensureMockupLoaded() {
  if (els.mockupFrame.dataset.loaded === '1') {
    prefillMockupStore();
    return;
  }
  mockupMsg('جارٍ فتح أداة المعاينة…');
  els.mockupFrame.src = MOCKUP_TOOL_URL;
  els.mockupFrame.dataset.loaded = '1';
  els.mockupFrame.onload = () => {
    mockupMsg('');
    hookMockupPreviewButton();
    prefillMockupStore();
  };
}

// يربط زر "معاينة التطبيق" داخل الموك أب بإعادة الملاءمة (للتكبير عند التحميل).
function hookMockupPreviewButton() {
  try {
    const doc = els.mockupFrame.contentDocument;
    if (!doc) return;
    const btn = [...doc.querySelectorAll('button')].find((b) => /معاينة التطبيق/.test(b.textContent || ''));
    if (btn && !btn.dataset.refitHooked) {
      btn.dataset.refitHooked = '1';
      btn.addEventListener('click', refitAfterLoad);
    }
  } catch (e) {
    /* cross-origin */
  }
}

// يحاول وضع رابط المتجر في خانة الأداة الرسمية وتشغيل المعاينة (same-origin فقط).
function prefillMockupStore() {
  const url = normalizeUrl(els.storeUrlInput.value);
  if (!url) return;
  try {
    const doc = els.mockupFrame.contentDocument;
    const input = doc && doc.getElementById('storeUrl');
    if (input && !input.value) {
      input.value = url;
      const btn = doc.getElementById('previewBtn') || doc.querySelector('button[type="submit"], .button--primary');
      if (btn) { btn.click(); refitAfterLoad(); }
    }
  } catch (e) {
    // cross-origin (تشغيل محلي): المستخدم يكتب الرابط داخل الأداة يدويًا
  }
}

els.stageTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tabs__tab');
  if (tab) showTab(tab.dataset.tab);
});

// زر الشريط الجانبي: ينقل لتبويب التصفّح.
els.openMockupBtn.addEventListener('click', () => showTab('browse'));

els.openTabBtn.addEventListener('click', () => {
  window.open(MOCKUP_TOOL_URL, '_blank', 'noopener');
});

// مستطيل شاشة الجوال بدقة — يعمل فقط عند same-origin (نفس نطاق الموك أب).
// يحوّل إحداثيات العنصر داخل الإطار إلى فضاء النافذة العليا مع مراعاة التصغير.
// يعيد null عند cross-origin (نطاق مختلف) فنلجأ للقص اليدوي.
function preciseScreenRect() {
  try {
    const doc = els.mockupFrame.contentDocument;
    if (!doc) return null;
    // #preview-iframe = محتوى المتجر فقط (تحت شريط الحالة) — قص نظيف بلا الشريط الأسود/notch.
    const screen = doc.getElementById('preview-iframe') ||
                   doc.querySelector('.phone__screen') ||
                   doc.querySelector('.phone__frame') ||
                   doc.querySelector('.phone');
    if (!screen) return null;
    const r = screen.getBoundingClientRect(); // بإحداثيات نافذة الإطار
    if (r.width <= 20 || r.height <= 20) return null;
    const f = els.mockupFrame.getBoundingClientRect();
    // معامل التصغير = العرض المعروض ÷ العرض المنطقي للإطار
    const scaleX = f.width / (els.mockupFrame.offsetWidth || f.width);
    const scaleY = f.height / (els.mockupFrame.offsetHeight || f.height);
    return {
      left: f.left + r.left * scaleX,
      top: f.top + r.top * scaleY,
      width: r.width * scaleX,
      height: r.height * scaleY,
    };
  } catch (e) {
    return null; // cross-origin
  }
}

// تخمين منطقة الجوال (للمربع الافتراضي في القص اليدوي عند cross-origin).
function guessScreenRect() {
  const stage = document.querySelector('.browse__stage');
  return (stage || els.mockupFrame).getBoundingClientRect();
}


// يضيف صورة ملتقطة كسكرينشوت جديد.
function addMockupShot(img) {
  const num = String(state.shots.length + 1).padStart(2, '0');
  state.shots.push({ ...state.defaults, name: `mockup-${num}.png`, img });
  state.previewShot = state.shots.length - 1;
  buildThumbs();
  syncControls();
  renderPreview();
  return num;
}

els.captureMockupBtn.addEventListener('click', async () => {
  mockupHint('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    mockupHint('متصفحك لا يدعم التقاط الشاشة — خذ سكرينشوت يدويًا والصقه بـ Ctrl+V.');
    return;
  }
  // نطلب أعلى دقة. ملاحظة مهمة: مشاركة "تبويب" تلتقط بالدقة المنطقية (CSS) فينتج
  // أنعم؛ مشاركة "الشاشة/النافذة" تلتقط بالدقة الفيزيائية (أحدّ بمقدار DPR).
  // فلا نفرض preferCurrentTab — نترك المستخدم يختار (الأحدّ = شاشة كاملة).
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 5 } },
      audio: false,
    });
  } catch (e) {
    mockupHint('أُلغي الالتقاط (لازم توافق على المشاركة).');
    return;
  }
  try {
    const track = stream.getVideoTracks()[0];
    const surface = track && track.getSettings ? track.getSettings().displaySurface : undefined;
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 350)); // استقرار أول إطار
    const full = document.createElement('canvas');
    full.width = video.videoWidth;
    full.height = video.videoHeight;
    full.getContext('2d').drawImage(video, 0, 0);

    const sx = full.width / document.documentElement.clientWidth;
    const sy = full.height / document.documentElement.clientHeight;

    // مشاركة تبويب (browser) → القص التلقائي صحيح لأن الإطار = التبويب نفسه.
    // مشاركة شاشة/نافذة → لا نعرف موضع التبويب داخلها، فنفتح أداة القص اليدوية
    //   (وهي الخيار الأحدّ دقةً — ننصح بها).
    const precise = surface === 'browser' ? preciseScreenRect() : null;
    if (precise) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(precise.width * sx));
      c.height = Math.max(1, Math.round(precise.height * sy));
      c.getContext('2d').drawImage(
        full,
        precise.left * sx, precise.top * sy, precise.width * sx, precise.height * sy,
        0, 0, c.width, c.height
      );
      const img = await loadImage(c.toDataURL('image/png'));
      addMockupShot(img);
      showTab('design');
      mockupHint(`أُضيفت — الدقة ${c.width}×${c.height}px. للأحدّ: شارك "الشاشة الكاملة" بدل التبويب.`);
      return;
    }

    // شاشة/نافذة (أو نطاق مختلف): أداة القص — يسحب المستخدم مربعًا حول الجوال.
    const rect = guessScreenRect();
    openCropOverlay(full, {
      x: rect.left * sx, y: rect.top * sy, w: rect.width * sx, h: rect.height * sy,
    });
  } catch (e) {
    mockupHint('فشل الالتقاط: ' + (e.message || e));
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
});

// ---------- أداة القص بعد الالتقاط ----------
let cropState = null; // { full, dispScale, sel:{x,y,w,h} بإحداثيات العرض, drag }

function openCropOverlay(full, defaultSelFull) {
  const canvas = els.cropCanvas;
  const maxW = window.innerWidth - 40;
  const maxH = window.innerHeight - 110;
  const dispScale = Math.min(maxW / full.width, maxH / full.height, 1);
  canvas.width = Math.round(full.width * dispScale);
  canvas.height = Math.round(full.height * dispScale);

  let sel;
  if (defaultSelFull && defaultSelFull.w > 10) {
    // نضيّق المربع الافتراضي على شكل جوال داخل المنطقة المرئية (الجوال موسّط)
    const cx = (defaultSelFull.x + defaultSelFull.w / 2) * dispScale;
    const h = Math.min(defaultSelFull.h, full.height * 0.92) * dispScale;
    const w = Math.min(h * 0.46, defaultSelFull.w * dispScale); // نسبة جوال تقريبية
    const top = defaultSelFull.y * dispScale + (defaultSelFull.h * dispScale - h) / 2;
    sel = { x: cx - w / 2, y: Math.max(0, top), w, h };
  } else {
    sel = { x: canvas.width * 0.32, y: canvas.height * 0.12, w: canvas.width * 0.36, h: canvas.height * 0.76 };
  }
  cropState = { full, dispScale, sel, drag: null };
  els.cropOverlay.hidden = false;
  drawCrop();
}

function drawCrop() {
  if (!cropState) return;
  const { full, sel } = cropState;
  const canvas = els.cropCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(20, 12, 30, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // أظهر المنطقة المحددة بوضوح
  const s = cropState.dispScale;
  ctx.drawImage(full, sel.x / s, sel.y / s, sel.w / s, sel.h / s, sel.x, sel.y, sel.w, sel.h);
  ctx.strokeStyle = '#a020c0';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(sel.x + 1, sel.y + 1, sel.w - 2, sel.h - 2);
  ctx.setLineDash([]);
}

function cropPos(e) {
  const r = els.cropCanvas.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return {
    x: (p.clientX - r.left) * (els.cropCanvas.width / r.width),
    y: (p.clientY - r.top) * (els.cropCanvas.height / r.height),
  };
}

function cropStart(e) {
  if (!cropState) return;
  e.preventDefault();
  const p = cropPos(e);
  cropState.drag = { sx: p.x, sy: p.y };
  cropState.sel = { x: p.x, y: p.y, w: 0, h: 0 };
}
function cropMove(e) {
  if (!cropState || !cropState.drag) return;
  e.preventDefault();
  const p = cropPos(e);
  const d = cropState.drag;
  cropState.sel = {
    x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y),
    w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy),
  };
  drawCrop();
}
function cropEnd() { if (cropState) cropState.drag = null; }

els.cropCanvas.addEventListener('mousedown', cropStart);
els.cropCanvas.addEventListener('mousemove', cropMove);
window.addEventListener('mouseup', cropEnd);
els.cropCanvas.addEventListener('touchstart', cropStart, { passive: false });
els.cropCanvas.addEventListener('touchmove', cropMove, { passive: false });
window.addEventListener('touchend', cropEnd);

els.cropConfirmBtn.addEventListener('click', async () => {
  if (!cropState) return;
  const { full, sel, dispScale } = cropState;
  const fx = sel.x / dispScale, fy = sel.y / dispScale;
  const fw = sel.w / dispScale, fh = sel.h / dispScale;
  if (fw < 10 || fh < 10) { mockupHint('المربع صغير جدًا — اسحب مربعًا أكبر حول الجوال.'); return; }
  const c = document.createElement('canvas');
  c.width = Math.round(fw);
  c.height = Math.round(fh);
  c.getContext('2d').drawImage(full, fx, fy, fw, fh, 0, 0, c.width, c.height);
  const img = await loadImage(c.toDataURL('image/png'));
  els.cropOverlay.hidden = true;
  cropState = null;
  addMockupShot(img);
  // انتقل لتاب التصميم ليرى النتيجة مركّبة فورًا (يعود للتصفّح لالتقاط المزيد)
  showTab('design');
  mockupHint(`أُضيفت — الدقة ${c.width}×${c.height}px.`);
});

els.cropCancelBtn.addEventListener('click', () => {
  els.cropOverlay.hidden = true;
  cropState = null;
});

// لصق سكرينشوت مباشرة (Ctrl/Cmd+V) — يسهّل النقل من أداة الموك أب أو أي مصدر.
window.addEventListener('paste', async (e) => {
  const items = [...((e.clipboardData && e.clipboardData.items) || [])]
    .filter((it) => it.type.startsWith('image/'));
  if (!items.length) return;
  e.preventDefault();
  showError('');
  for (const it of items) {
    const f = it.getAsFile();
    if (!f) continue;
    try {
      const img = await fileToImage(f);
      const num = String(state.shots.length + 1).padStart(2, '0');
      state.shots.push({ ...state.defaults, name: `pasted-${num}.png`, img });
    } catch (err) {
      showError('تعذّر لصق الصورة من الحافظة.');
    }
  }
  state.previewShot = state.shots.length - 1;
  buildThumbs();
  syncControls();
  renderPreview();
});

els.logoInput.addEventListener('change', async (e) => {
  showError('');
  const f = e.target.files[0];
  if (!f) return;
  try {
    setLogo(await fileToImage(f));
    renderPreview();
  } catch (err) {
    showError('تعذّر تحميل اللوجو.');
  }
});

els.titleInput.addEventListener('input', (e) => {
  activeTarget().title = e.target.value;
  renderPreview();
});

els.platformGroup.addEventListener('change', (e) => {
  if (e.target.name === 'platform') {
    state.platform = e.target.value;
    renderPreview();
  }
});

els.statusBarRange.addEventListener('input', (e) => {
  state.statusBarRatio = Number(e.target.value) / 100;
  els.statusBarVal.textContent = e.target.value + '%';
  renderPreview();
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
  exportSingle(els.previewCanvas, preset.id, preset.fmt);
});

// تطبيق جماعي: يضبط خيار الشعار في كل الصور دفعة واحدة (ويبقى قابلًا للتعديل فرديًا)
els.headerLogoToggle.addEventListener('change', (e) => {
  state.showHeaderLogo = e.target.checked;
  state.defaults.showLogo = e.target.checked;
  state.shots.forEach((s) => { s.showLogo = e.target.checked; });
  syncControls();
  renderPreview();
});

// خيار الشعار للصورة المحددة فقط
els.shotLogoToggle.addEventListener('change', (e) => {
  activeTarget().showLogo = e.target.checked;
  renderPreview();
});

// يبني لوحة ألوان الهوية: ألوان المتجر الفعلية + درجات محسوبة (حتى 5 حبّات فريدة).
function setBrandPalette(primary, extras = []) {
  const all = [primary, ...extras, hexShade(primary, -0.25), hexShade(primary, 0.25)]
    .filter(Boolean);
  state.brandPalette = [...new Set(all)].slice(0, 5);
}

// ---------- إعداد التاجر (استيراد/تصدير/presets) ----------
// يطبّق merchant config (صيغة merchants/<id>.json المشتركة) على حالة الأداة.
async function applyMerchantConfig(cfg) {
  const hex = cfg.brand && cfg.brand.primaryColor;
  if (hex) {
    state.defaults.themeId = 'custom';
    state.defaults.customColor = hex;
    state.shots.forEach((s) => { s.themeId = 'custom'; s.customColor = hex; });
    state.iconThemeId = 'custom';
    state.iconCustomColor = hex;
    setBrandPalette(hex, cfg.brand.secondaryColor ? [cfg.brand.secondaryColor] : []);
  }

  const ag = cfg.assetGenerator || {};
  if (typeof ag.statusBarCoverage === 'number') {
    state.statusBarRatio = ag.statusBarCoverage / 100;
    els.statusBarRange.value = ag.statusBarCoverage;
    els.statusBarVal.textContent = ag.statusBarCoverage + '%';
  }
  if (typeof ag.showDeviceFrame === 'boolean') {
    state.showFrame = ag.showDeviceFrame;
    els.frameToggle.checked = ag.showDeviceFrame;
  }
  if (ag.background && ag.background.type) {
    state.bgGradient = ag.background.type !== 'solid';
    const m = migrateLegacyStyle(ag.background.type);
    const decors = Array.isArray(ag.background.decors)
      ? ag.background.decors.filter((id) => BG_DECORS.some((s) => s.id === id))
      : m.decors;
    state.defaults.bgBaseId = m.base;
    state.defaults.bgDecors = decors;
    state.shots.forEach((s) => { s.bgBaseId = m.base; s.bgDecors = [...decors]; });
  }
  if (ag.template) {
    const layoutId = ag.template === 'default' ? 'classic' : ag.template;
    if (LAYOUTS.some((l) => l.id === layoutId)) {
      state.defaults.layoutId = layoutId;
      state.shots.forEach((s) => { s.layoutId = layoutId; });
    }
  }

  // الويب لا يقرأ مسارات محلية (brand.logo) — البديل: logoBase64 أو رفع يدوي.
  if (cfg.logoBase64) {
    const src = cfg.logoBase64.startsWith('data:')
      ? cfg.logoBase64
      : 'data:image/png;base64,' + cfg.logoBase64;
    try { setLogo(await loadImage(src)); }
    catch (e) { showError('تعذّر تحميل الشعار من logoBase64 — ارفعه يدويًا.'); }
  }

  state.appName = cfg.appName || '';
  state.lastImported = cfg;
  showStoreInfo(cfg.appName || cfg.id, hex || null);
  syncControls();
  rebuildIconSwatches();
  renderPreview();
}

// القيم الحالية للأداة بصيغة تصلح للتصدير/الحفظ كـ preset.
function currentToolSettings() {
  const d = state.defaults;
  return {
    appName: state.appName,
    primaryColor: d.themeId === 'custom' ? d.customColor : themeById(d.themeId).swatch,
    template: d.layoutId,
    statusBarCoverage: Math.round(state.statusBarRatio * 100),
    showDeviceFrame: state.showFrame,
    backgroundType: state.defaults.bgBaseId || 'gradient',
    backgroundDecors: state.defaults.bgDecors || [],
  };
}

function rebuildPresetSelect(selected) {
  els.presetSelect.innerHTML = '<option value="">— الإعدادات المحفوظة —</option>';
  listPresets().forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    if (p.name === selected) opt.selected = true;
    els.presetSelect.appendChild(opt);
  });
}

els.importConfigBtn.addEventListener('click', () => els.merchantConfigInput.click());

els.merchantConfigInput.addEventListener('change', async (e) => {
  showError('');
  const f = e.target.files[0];
  e.target.value = ''; // يسمح بإعادة استيراد نفس الملف
  if (!f) return;
  let cfg;
  try {
    cfg = JSON.parse(await f.text());
  } catch (err) {
    showError('الملف ليس JSON صالحًا: ' + (err.message || err));
    return;
  }
  const errors = validateMerchantConfig(cfg);
  if (errors.length) {
    showError('إعداد التاجر غير صالح — ' + errors.join(' • '));
    return;
  }
  await applyMerchantConfig(cfg);
});

els.exportConfigBtn.addEventListener('click', () => {
  downloadConfig(buildExportConfig(currentToolSettings(), state.lastImported));
});

els.presetSelect.addEventListener('change', async (e) => {
  const p = presetByName(e.target.value);
  if (p) await applyMerchantConfig(p.config);
});

els.savePresetBtn.addEventListener('click', () => {
  const suggested = state.appName || (state.lastImported && state.lastImported.id) || '';
  const name = (window.prompt('اسم الإعداد المحفوظ:', suggested) || '').trim();
  if (!name) return;
  savePreset(name, buildExportConfig(currentToolSettings(), state.lastImported));
  rebuildPresetSelect(name);
});

els.deletePresetBtn.addEventListener('click', () => {
  const name = els.presetSelect.value;
  if (!name) return;
  deletePreset(name);
  rebuildPresetSelect('');
});

// جلب لون وشعار المتجر من الرابط
els.fetchStoreBtn.addEventListener('click', async () => {
  showError('');
  const url = normalizeUrl(els.storeUrlInput.value);
  if (!url) { showError('أدخل رابط المتجر أولًا.'); return; }
  els.fetchStoreBtn.disabled = true;
  els.fetchSpinner.hidden = false;
  try {
    const { name, primary, logo, extras } = await fetchStoreBranding(url);
    const hex = primary;
    if (!hex && !logo) throw new Error('ما لقينا ألوانًا أو شعارًا في صفحة المتجر');

    // تطبيق اللون على خلفيات الصور الوصفية والأيقونة (مع إبقاء إمكانية التغيير يدويًا)
    if (hex) {
      state.defaults.themeId = 'custom';
      state.defaults.customColor = hex;
      state.shots.forEach((s) => { s.themeId = 'custom'; s.customColor = hex; });
      state.iconThemeId = 'custom';
      state.iconCustomColor = hex;
      setBrandPalette(hex, extras);
    }
    // تحميل شعار المتجر (يبقى رفع لوجو آخر متاحًا ويستبدله)
    if (logo) {
      try { setLogo(await loadImageCors(viaProxy(logo))); }
      catch (e) { showError('تم جلب اللون، لكن تعذّر تحميل الشعار (يمكنك رفعه يدويًا).'); }
    }
    showStoreInfo(name, hex);
    syncControls();
    rebuildIconSwatches();
    renderPreview();
  } catch (err) {
    showError('تعذّر جلب إعدادات المتجر: ' + (err.message || err));
  } finally {
    els.fetchStoreBtn.disabled = false;
    els.fetchSpinner.hidden = true;
  }
});

function showStoreInfo(name, hex) {
  els.storeName.textContent = name || '—';
  els.storeColorHex.textContent = hex || '—';
  els.storeColorSwatch.style.background = hex || 'transparent';
  els.storeInfo.hidden = false;
}

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
    const shotsConfig = state.shots.map((s) => ({
      screenshot: s.img,
      title: s.title,
      theme: shotTheme(s),
      layoutId: s.layoutId,
      bgBaseId: s.bgBaseId,
      bgDecors: s.bgDecors || [],
      showHeaderLogo: !!s.showLogo,
    }));
    const globalConfig = {
      platform: state.platform,
      statusBarRatio: state.statusBarRatio,
      showFrame: state.showFrame,
      logo: state.logo,
    };
    const iconConfig = { theme: iconTheme(), logo: state.logo };
    await exportAll(shotsConfig, [...state.selected], globalConfig, iconConfig, (done, total) => {
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

function rebuildIconSwatches() {
  buildSwatches(els.iconThemeSwatches, {
    currentId: () => state.iconThemeId,
    onPick: (id) => { state.iconThemeId = id; },
    customColor: () => state.iconCustomColor,
    onCustom: (hex) => { state.iconThemeId = 'custom'; state.iconCustomColor = hex; },
  });
}

// ---------- التهيئة ----------
(async () => {
  await restoreSession();
  buildPresets();
  buildPreviewPresetOptions();
  rebuildPresetSelect('');
  buildThumbs();
  rebuildIconSwatches();
  syncControls();
  updateLogoPreview();
  els.statusBarRange.value = Math.round(state.statusBarRatio * 100);
  els.statusBarVal.textContent = Math.round(state.statusBarRatio * 100) + '%';
  renderPreview();
})();
