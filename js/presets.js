// presets.js — الأحجام المعتمدة لمتجري App Store و Google Play
// كل preset يصف مخرجًا واحدًا بأبعاده الحقيقية بالبكسل.

export const PRESETS = [
  // ---- App Store ----
  {
    id: 'appstore-6.5',
    group: 'appstore',
    type: 'screenshot',
    label: 'App Store 6.5" (1242×2688)',
    folder: 'appstore-6.5',
    width: 1242,
    height: 2688,
    defaultOn: true,
  },
  {
    id: 'appstore-6.7',
    group: 'appstore',
    type: 'screenshot',
    label: 'App Store 6.7" (1290×2796)',
    folder: 'appstore-6.7',
    width: 1290,
    height: 2796,
    defaultOn: true,
  },
  // ---- Google Play ----
  {
    id: 'googleplay-phone',
    group: 'googleplay',
    type: 'screenshot',
    label: 'Google Play Phone (1080×1920)',
    folder: 'googleplay',
    width: 1080,
    height: 1920,
    defaultOn: true,
  },
  // ---- Feature graphic (الكفر) ----
  {
    id: 'feature-graphic',
    group: 'graphics',
    type: 'feature',
    label: 'Feature Graphic / الكفر (1024×500)',
    folder: '',
    fileName: 'feature-graphic.png',
    width: 1024,
    height: 500,
    defaultOn: true,
  },
  // ---- الأيقونات ----
  {
    id: 'icon-1024',
    group: 'icons',
    type: 'icon',
    label: 'App Icon (1024×1024)',
    folder: 'icons',
    fileName: 'icon-1024.png',
    width: 1024,
    height: 1024,
    defaultOn: true,
  },
  {
    id: 'icon-512',
    group: 'icons',
    type: 'icon',
    label: 'Play Icon (512×512)',
    folder: 'icons',
    fileName: 'icon-512.png',
    width: 512,
    height: 512,
    defaultOn: true,
  },
  {
    id: 'icon-540',
    group: 'icons',
    type: 'icon',
    label: 'مربع صغير (540×540)',
    folder: 'icons',
    fileName: 'icon-540.png',
    width: 540,
    height: 540,
    defaultOn: false,
  },
];

export const GROUPS = [
  { id: 'appstore', label: 'App Store' },
  { id: 'googleplay', label: 'Google Play' },
  { id: 'graphics', label: 'صورة الكفر' },
  { id: 'icons', label: 'الأيقونات واللوجو' },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id);
}
