// AppsBunches Mockup — fetch store settings then preview the app
(() => {
  'use strict';

  // CORS proxy used for all cross-origin store API calls. Hardcoded so the
  // end user never needs to configure it. If we ever rotate this, update here
  // and redeploy.
  const PROXY_URL = 'https://zid-mockup-proxy.dev-60c.workers.dev';

  const $ = (id) => document.getElementById(id);

  const form = $('config-form');
  const storeUrlInput = $('storeUrl');
  const submitBtn = form.querySelector('button[type="submit"]');
  const spinner = $('spinner');
  const reloadBtn = $('reload-btn');

  const iframe = $('preview-iframe');
  const storeInfo = $('store-info');
  const storeName = $('storeName');
  const colorSwatch = $('colorSwatch');
  const colorHex = $('colorHex');
  const storeLogo = $('storeLogo');
  const errorBox = $('error-box');

  // Path to the built Flutter web app (relative to this site)
  const APP_PATH = 'app/';

  /** last fetched settings, used by Reload */
  let lastSettings = null;

  // ---- Remote-config editor state ----
  /** theme_name of the currently loaded store (from /api/v1/settings). */
  let currentTheme = null;
  /** Uploaded remote-config JSON object (point 5). Empty until a file is loaded. */
  let currentRemoteConfig = {};
  /** Latest customization per section: { [sectionKey]: { payload, targetOrder } }. */
  const currentEdits = {};
  /** When true, edits are published under the generic `default` key (point 7). */
  let publishAllThemes = false;

  // Maps each *_PROPERTIES_OVERRIDE message type to its section key and back.
  const TYPE_TO_SECTION = {
    BANNER_PROPERTIES_OVERRIDE: 'banner',
    FEATURES_PROPERTIES_OVERRIDE: 'features',
    PARTNERS_PROPERTIES_OVERRIDE: 'partners',
    SLIDER_PROPERTIES_OVERRIDE: 'slider',
    PRODUCTS_PROPERTIES_OVERRIDE: 'products',
    CATEGORIES_PROPERTIES_OVERRIDE: 'categories',
    COUNTDOWN_PROPERTIES_OVERRIDE: 'countdown',
    TESTIMONIALS_PROPERTIES_OVERRIDE: 'testimonials',
    VIDEO_PROPERTIES_OVERRIDE: 'video',
    DESCRIPTION_PROPERTIES_OVERRIDE: 'description',
    INSTAGRAM_PROPERTIES_OVERRIDE: 'instagram',
    ICON_BOX_PROPERTIES_OVERRIDE: 'icon_box',
    BRAND_PROPERTIES_OVERRIDE: 'brand',
    TRUST_PAYMENT_PROPERTIES_OVERRIDE: 'trust_payment',
    ANNOUNCEMENT_BAR_PROPERTIES_OVERRIDE: 'announcement_bar',
    FAQS_PROPERTIES_OVERRIDE: 'faqs',
    PRODUCTS_TAB_PROPERTIES_OVERRIDE: 'products_tab',
  };
  const SECTION_TO_TYPE = Object.fromEntries(
    Object.entries(TYPE_TO_SECTION).map(([type, key]) => [key, type]),
  );

  // Record the latest customization for a section, then forward it to the
  // Flutter preview. Every section "save" handler funnels through here so the
  // remote-config exporter can gather all edits in one place.
  function sendUpdate(message) {
    const key = TYPE_TO_SECTION[message.type];
    if (key) {
      currentEdits[key] = {
        payload: message.payload,
        targetOrder: message.targetOrder ?? null,
      };
    }
    iframe.contentWindow.postMessage(message, '*');
  }

  // ---- Section-form visibility (driven by Flutter's SECTIONS_LOADED) ----
  // Maps each resolved component type (from ComponentResolver) to its
  // <details> form ID in the sidebar. `announcement_bar` is store-wide and
  // is always included by the Flutter broadcast.
  const SECTION_TO_FORM_ID = {
    banner: 'banner-form',
    features: 'features-form',
    partners: 'partners-form',
    slider: 'slider-form',
    products: 'products-form',
    categories: 'categories-form',
    countdown: 'countdown-form',
    testimonials: 'testimonials-form',
    video: 'video-form',
    description: 'description-form',
    instagram: 'instagram-form',
    icon_box: 'icon-box-form',
    brand: 'brand-form',
    trust_payment: 'trust-payment-form',
    announcement_bar: 'announcement-bar-form',
    faqs: 'faqs-form',
    products_tab: 'products-tab-form',
  };

  function applySectionVisibility(sectionTypes) {
    const allowed = new Set(sectionTypes || []);
    Object.entries(SECTION_TO_FORM_ID).forEach(([type, formId]) => {
      const el = document.getElementById(formId);
      if (!el) return;
      // Use inline display because `.ctrl-section { display: flex }` in CSS
      // overrides the HTML `hidden` attribute.
      const display = allowed.has(type) ? '' : 'none';

      // The first 9 forms (banner..video) are wrapped in
      // `<section class="X-controls">` with an `<hr class="divider" />`
      // between them. Hide/show the wrapper + its preceding divider so the
      // sidebar doesn't end up with orphan or duplicate horizontal rules.
      const wrapper = el.closest('section[class$="-controls"]') || el;
      wrapper.style.display = display;

      const prev = wrapper.previousElementSibling;
      if (prev && prev.tagName === 'HR' && prev.classList.contains('divider')) {
        prev.style.display = display;
      }
    });
  }

  // Hide every section form until Flutter reports which ones the store has.
  // The store-wide form (announcement-bar-form) reappears as soon as
  // SECTIONS_LOADED arrives because Flutter always includes it.
  applySectionVisibility([]);

  window.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'SECTIONS_LOADED') return;
    const sections = Array.isArray(data.sections) ? data.sections : [];
    applySectionVisibility(sections);
  });

  // ---- Helpers ----
  function normalizeUrl(raw) {
    let url = (raw || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url.replace(/\/+$/, '');
  }

  function hasStoreUrlInPageUrl() {
    return new URLSearchParams(window.location.search).has('storeUrl');
  }

  function applyStoreUrlPageMode(enabled) {
    const storeField = storeUrlInput ? storeUrlInput.closest('.field') : null;
    const headerTitle = document.querySelector('.sidebar__header h1');
    const headerText = document.querySelector('.sidebar__header p');

    [storeField, submitBtn, reloadBtn, headerTitle, headerText].forEach((el) => {
      if (el) el.style.display = enabled ? 'none' : '';
    });
  }

  /** Wrap a URL with the hardcoded proxy. */
  function viaProxy(targetUrl) {
    return `${PROXY_URL}/${targetUrl}`;
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    spinner.hidden = !busy;
  }

  function updateStoreInfo({ name, color, logo, theme, hidden = false }) {
    const themeEl = $('storeTheme');
    const storeNameRow = storeName ? storeName.closest('.store-info__row') : null;
    const themeRow = themeEl ? themeEl.closest('.store-info__row') : null;

    if (storeNameRow) storeNameRow.style.display = hidden ? 'none' : '';
    if (themeRow) themeRow.style.display = '';

    storeName.textContent = name || '—';
    if (colorHex) colorHex.textContent = color || '—';
    if (colorSwatch) colorSwatch.style.background = color || 'transparent';
    if (storeLogo) {
      if (logo) {
        storeLogo.src = logo;
        storeLogo.hidden = false;
      } else {
        storeLogo.removeAttribute('src');
        storeLogo.hidden = true;
      }
    }
    if (themeEl) themeEl.textContent = theme || '—';
    storeInfo.hidden = false;
  }

  // ---- API ----
  async function fetchStoreSettings(storeUrl) {
    const endpoint = viaProxy(`${storeUrl}/api/v1/settings`);
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'ar',
        'zid-client-platform': 'mobile_app',
      },
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    }

    return res.json();
  }

  function extractBranding(payload) {
    const root = payload?.data || payload;
    const settings = root?.settings || {};
    const branding = settings?.branding || {};
    const colors = branding?.colors || {};

    const primary = colors.primary || branding.primary_color || null;
    const logo =
      branding.logo || root.logo || branding.mobile_app_logo || null;
    const name = root.name || branding.name || '';
    const theme = root.theme || settings.theme || {};
    const themeName = theme.theme_name || theme.name || null;

    return { name, primary, logo, themeName };
  }

  // ---- Build preview URL ----
  function buildPreviewUrl(storeUrl, color, logo) {
    const params = new URLSearchParams();
    params.set('storeUrl', storeUrl);
    if (color) params.set('primaryColor', color.replace('#', ''));
    if (logo) params.set('logoUrl', logo);
    params.set('proxyUrl', PROXY_URL);

    return `${APP_PATH}?${params.toString()}`;
  }

  // ---- Main flow ----
  async function loadPreview() {
    clearError();
    if (!storeUrlInput.checkValidity()) {
      storeUrlInput.reportValidity();
      return;
    }

    const storeUrl = normalizeUrl(storeUrlInput.value);
    const storeUrlPageMode = hasStoreUrlInPageUrl();
    applyStoreUrlPageMode(storeUrlPageMode);
    setBusy(true);
    try {
      const payload = await fetchStoreSettings(storeUrl);
      const { name, primary, logo, themeName } = extractBranding(payload);

      currentTheme = themeName;
      lastSettings = { storeUrl, primary, logo, name };
      updateStoreInfo({
        name,
        color: primary,
        logo,
        theme: themeName,
        hidden: storeUrlPageMode,
      });

      // Reflect the store in the page URL so it can be shared/bookmarked (point 2).
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set('storeUrl', storeUrl);
      window.history.replaceState(null, '', shareUrl.toString());

      iframe.src = buildPreviewUrl(storeUrl, primary, logo);
    } catch (err) {
      console.error(err);
      showError(`تعذّر جلب إعدادات المتجر: ${err.message}`);
      iframe.src = buildPreviewUrl(storeUrl, null, null);
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    loadPreview();
  });

  reloadBtn.addEventListener('click', () => {
    iframe.src = 'about:blank';
    setTimeout(() => {
      if (lastSettings) {
        iframe.src = buildPreviewUrl(
          lastSettings.storeUrl,
          lastSettings.primary,
          lastSettings.logo,
        );
      } else {
        loadPreview();
      }
    }, 50);
  });

  // ---- Boot: take the store from the page URL (point 2) ----
  // The store-URL input is hidden (point 3); the merchant opens this page with
  // `?storeUrl=<their store>` and the preview loads automatically.
  (function bootFromUrl() {
    const fromUrl = new URLSearchParams(window.location.search).get('storeUrl');
    if (fromUrl) {
      applyStoreUrlPageMode(true);
      // Normalize first so the (hidden) type="url" field passes checkValidity().
      storeUrlInput.value = normalizeUrl(fromUrl);
      loadPreview();
    } else {
      applyStoreUrlPageMode(false);
      showError('افتح الصفحة برابط المتجر: ‎?storeUrl=اسم-متجرك');
    }
  })();

  // ---- Remote-config toolbar (points 4, 5, 6, 7) ----
  (function initRemoteConfig() {
    const sendLiveBtn = $('send-live-btn');
    const uploadBtn = $('upload-rc-btn');
    const fileInput = $('rc-file-input');
    const allThemesToggle = $('all-themes-toggle');
    const modal = $('rc-modal');
    const modalJson = $('rc-modal-json');
    const modalClose = $('rc-modal-close');
    const copyBtn = $('rc-copy-btn');
    const downloadBtn = $('rc-download-btn');
    if (!sendLiveBtn) return;

    /** JSON string of the last merged config, used by copy/download. */
    let lastMerged = '';

    // The theme bucket edits are written under: the store's theme, or the
    // generic `default` bucket when "publish to all themes" is on (point 7).
    function themeKey() {
      if (allThemesToggle && allThemesToggle.checked) return 'default';
      return currentTheme || 'default';
    }

    function cloneConfig(obj) {
      try {
        return structuredClone(obj);
      } catch (e) {
        return JSON.parse(JSON.stringify(obj || {}));
      }
    }

    // Merge the gathered section edits into the uploaded config (point 4/6).
    // Whatever already exists in the uploaded file is preserved.
    function buildMergedConfig() {
      const merged = cloneConfig(currentRemoteConfig) || {};
      merged.parameters = merged.parameters || {};

      // Extract existing themes from THEME_OVERRIDES if present
      let themeOverridesObj = { themes: {} };
      try {
        const existingVal = merged.parameters.THEME_OVERRIDES?.defaultValue?.value;
        if (existingVal) {
          themeOverridesObj = JSON.parse(existingVal);
          themeOverridesObj.themes = themeOverridesObj.themes || {};
        }
      } catch (e) {
        console.warn('Failed to parse existing THEME_OVERRIDES, starting fresh.');
      }

      const key = themeKey();
      themeOverridesObj.themes[key] = themeOverridesObj.themes[key] || {};
      themeOverridesObj.themes[key].sections = themeOverridesObj.themes[key].sections || {};
      Object.entries(currentEdits).forEach(([section, edit]) => {
        themeOverridesObj.themes[key].sections[section] = edit.payload;
      });

      // Write it back as a stringified JSON parameter
      merged.parameters.THEME_OVERRIDES = {
        defaultValue: {
          value: JSON.stringify(themeOverridesObj)
        },
        description: "Store widget overrides customized per theme",
        valueType: "JSON"
      };

      // Ensure root-level themes are deleted if they existed accidentally
      delete merged.themes;

      return merged;
    }

    // (4) Compile everything into one file and show it. No real network call
    // to remote config is made — this only simulates the publish step.
    sendLiveBtn.addEventListener('click', () => {
      lastMerged = JSON.stringify(buildMergedConfig(), null, 2);
      modalJson.textContent = lastMerged;
      modal.hidden = false;
    });

    modalClose.addEventListener('click', () => {
      modal.hidden = true;
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(lastMerged);
        copyBtn.textContent = 'تم النسخ ✓';
        setTimeout(() => {
          copyBtn.textContent = 'نسخ';
        }, 1500);
      } catch (e) {
        console.error(e);
      }
    });

    downloadBtn.addEventListener('click', () => {
      const blob = new Blob([lastMerged], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `remote-config-${themeKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    // Push every section from a config bucket into the live preview.
    function applyConfigToPreview(config) {
      let themes = {};
      try {
        const existingVal = config?.parameters?.THEME_OVERRIDES?.defaultValue?.value;
        if (existingVal) {
          const parsed = JSON.parse(existingVal);
          themes = parsed.themes || {};
        } else if (config?.themes) {
          // Fallback for older incorrectly formatted files
          themes = config.themes;
        }
      } catch (e) {
        console.warn('Could not parse THEME_OVERRIDES', e);
      }

      const bucket =
        (themes[themeKey()] && themes[themeKey()].sections) ||
        (themes.default && themes.default.sections) ||
        {};
      Object.entries(bucket).forEach(([section, payload]) => {
        const type = SECTION_TO_TYPE[section];
        if (type) sendUpdate({ type, targetOrder: null, payload });
      });
    }

    // (5) Upload an existing remote-config JSON, then apply it to the preview.
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          currentRemoteConfig = JSON.parse(reader.result);
          clearError();
          applyConfigToPreview(currentRemoteConfig);
        } catch (e) {
          showError(`تعذّر قراءة ملف الرموت كونفج: ${e.message}`);
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
  })();

  // ---- Status bar clock ----
  function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const t = $('statusBarTime');
    if (t) t.textContent = `${h}:${m}`;
  }
  updateClock();
  // ---- Banner Playground Logic ----
  const bannerForm = $('banner-form');
  if (bannerForm) {
    const saveBtn = $('save-banner-btn');
    const jsonPreview = $('jsonPreview');

    // Number Controls (+/- buttons)
    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      
      const step = parseFloat(input.step) || 1;
      
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('aspectRatioMinus', 'aspectRatioPlus', 'imageAspectRatio');
    setupNumberControl('titleSizeMinus', 'titleSizePlus', 'titleFontSize');
    setupNumberControl('heightFactorMinus', 'heightFactorPlus', 'imageHeightScreenFactor');
    setupNumberControl('borderRadiusMinus', 'borderRadiusPlus', 'imageBorderRadius');

    // Color picker toggle
    const enableContainerColor = $('enableContainerColor');
    const containerColor = $('containerColor');
    if (enableContainerColor && containerColor) {
      enableContainerColor.addEventListener('change', (e) => {
        containerColor.disabled = !e.target.checked;
      });
    }

    const gatherJson = () => {
      const payload = {};
      
      // Booleans
      payload.display = $('display').checked;
      if ($('layoutIsColumn').checked) payload.layoutIsColumn = true;
      if ($('imageFullWidth').checked) payload.imageFullWidth = true;
      
      // Strings/Enums
      const imageFit = $('imageFit').value;
      if (imageFit) payload.imageFit = imageFit;
      
      if (enableContainerColor && enableContainerColor.checked) {
        payload.containerColor = containerColor.value;
      }

      // Numbers
      const aspectRatio = parseFloat($('imageAspectRatio').value);
      if (!isNaN(aspectRatio)) payload.imageAspectRatio = aspectRatio;

      const titleSize = parseFloat($('titleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;
      
      const heightFactor = parseFloat($('imageHeightScreenFactor').value);
      if (!isNaN(heightFactor)) payload.imageHeightScreenFactor = heightFactor;

      const borderRadius = parseFloat($('imageBorderRadius').value);
      if (!isNaN(borderRadius)) payload.imageBorderRadius = borderRadius;

      return payload;
    };

    saveBtn.addEventListener('click', () => {
      const payload = gatherJson();
      const targetOrderVal = $('targetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);
      
      const message = {
        type: 'BANNER_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload
      };
      
      jsonPreview.textContent = JSON.stringify(message, null, 2);
      
      // Send to iframe
      sendUpdate(message);
    });
  }

  // ---- Features Playground Logic ----
  const featuresForm = $('features-form');
  if (featuresForm) {
    const saveFeaturesBtn = $('save-features-btn');
    const featuresJsonPreview = $('featuresJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('featureItemBorderRadiusMinus', 'featureItemBorderRadiusPlus', 'featuresItemBorderRadius');
    setupNumberControl('featureGridMinus', 'featureGridPlus', 'featuresGridCrossAxisCount');
    setupNumberControl('featuresImageWidthMinus', 'featuresImageWidthPlus', 'featuresImageWidth');
    setupNumberControl('featuresImageHeightMinus', 'featuresImageHeightPlus', 'featuresImageHeight');
    setupNumberControl('featuresImageBorderRadiusMinus', 'featuresImageBorderRadiusPlus', 'featuresImageBorderRadius');
    setupNumberControl('featuresTitleSizeMinus', 'featuresTitleSizePlus', 'featuresTitleFontSize');
    setupNumberControl('featuresDescSizeMinus', 'featuresDescSizePlus', 'featuresDescFontSize');
    setupNumberControl('featuresItemTitleSizeMinus', 'featuresItemTitleSizePlus', 'featuresItemTitleFontSize');
    setupNumberControl('featuresItemDescSizeMinus', 'featuresItemDescSizePlus', 'featuresItemDescFontSize');

    const toggleColor = (chkId, colorId) => {
      const chk = $(chkId);
      const col = $(colorId);
      if (chk && col) {
        chk.addEventListener('change', (e) => col.disabled = !e.target.checked);
      }
    };

    toggleColor('featuresEnableBgColor', 'featuresBgColor');
    toggleColor('featuresEnableItemBgColor', 'featuresItemBgColor');
    toggleColor('featuresEnableTitleColor', 'featuresTitleColor');
    toggleColor('featuresEnableDescColor', 'featuresDescColor');
    toggleColor('featuresEnableItemTitleColor', 'featuresItemTitleColor');
    toggleColor('featuresEnableItemDescColor', 'featuresItemDescColor');

    const gatherFeaturesJson = () => {
      const payload = {};
      
      payload.display = $('featuresDisplay').checked;
      payload.item_has_shadow = $('featuresItemHasShadow').checked;
      
      const layoutType = $('featuresLayoutType').value;
      if (layoutType) payload.layout_type = layoutType;
      
      if ($('featuresEnableBgColor').checked) payload.bg_color = $('featuresBgColor').value;
      if ($('featuresEnableItemBgColor').checked) payload.feature_bg_color = $('featuresItemBgColor').value;
      
      const itemBorderRadius = parseFloat($('featuresItemBorderRadius').value);
      if (!isNaN(itemBorderRadius)) payload.item_border_radius = itemBorderRadius;
      
      const gridCount = parseInt($('featuresGridCrossAxisCount').value, 10);
      if (!isNaN(gridCount)) payload.grid_cross_axis_count = gridCount;
      
      const imageFit = $('featuresImageFit').value;
      if (imageFit) payload.image_fit = imageFit;

      const imageWidth = parseFloat($('featuresImageWidth').value);
      if (!isNaN(imageWidth)) payload.image_width = imageWidth;

      const imageHeight = parseFloat($('featuresImageHeight').value);
      if (!isNaN(imageHeight)) payload.image_height = imageHeight;

      const imageBorderRadiusType = $('featuresImageBorderRadiusType').value;
      if (imageBorderRadiusType) payload.image_border_radius_type = imageBorderRadiusType;

      const imageBorderRadius = parseFloat($('featuresImageBorderRadius').value);
      if (!isNaN(imageBorderRadius)) payload.image_border_radius = imageBorderRadius;

      if ($('featuresEnableTitleColor').checked) payload.title_color = $('featuresTitleColor').value;
      if ($('featuresEnableDescColor').checked) payload.desc_color = $('featuresDescColor').value;
      if ($('featuresEnableItemTitleColor').checked) payload.feature_title_color = $('featuresItemTitleColor').value;
      if ($('featuresEnableItemDescColor').checked) payload.feature_desc_color = $('featuresItemDescColor').value;

      const titleFontSize = parseFloat($('featuresTitleFontSize').value);
      if (!isNaN(titleFontSize)) payload.title_font_size = titleFontSize;

      const descFontSize = parseFloat($('featuresDescFontSize').value);
      if (!isNaN(descFontSize)) payload.desc_font_size = descFontSize;

      const featureTitleFontSize = parseFloat($('featuresItemTitleFontSize').value);
      if (!isNaN(featureTitleFontSize)) payload.feature_title_font_size = featureTitleFontSize;

      const featureDescFontSize = parseFloat($('featuresItemDescFontSize').value);
      if (!isNaN(featureDescFontSize)) payload.feature_desc_font_size = featureDescFontSize;
      
      return payload;
    };

    saveFeaturesBtn.addEventListener('click', () => {
      const payload = gatherFeaturesJson();
      const targetOrderVal = $('featuresTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'FEATURES_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload
      };

      featuresJsonPreview.textContent = JSON.stringify(message, null, 2);

      // Send to iframe
      sendUpdate(message);
    });
  }

  // ---- Partners Playground Logic ----
  const partnersForm = $('partners-form');
  if (partnersForm) {
    const savePartnersBtn = $('save-partners-btn');
    const partnersJsonPreview = $('partnersJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('partnersItemsPerPageMinus', 'partnersItemsPerPagePlus', 'partnersItemsPerPage');
    setupNumberControl('partnersItemHeightMinus', 'partnersItemHeightPlus', 'partnersItemHeight');
    setupNumberControl('partnersSectionAspectMinus', 'partnersSectionAspectPlus', 'partnersSectionAspectRatio');
    setupNumberControl('partnersItemHPaddingMinus', 'partnersItemHPaddingPlus', 'partnersItemHorizontalPadding');
    setupNumberControl('partnersImageBorderWidthMinus', 'partnersImageBorderWidthPlus', 'partnersImageBorderWidth');
    setupNumberControl('partnersImageBorderRadiusMinus', 'partnersImageBorderRadiusPlus', 'partnersImageBorderRadius');
    setupNumberControl('partnersAutoplayIntervalMinus', 'partnersAutoplayIntervalPlus', 'partnersAutoplayInterval');
    setupNumberControl('partnersTitleSizeMinus', 'partnersTitleSizePlus', 'partnersTitleFontSize');
    setupNumberControl('partnersDescSizeMinus', 'partnersDescSizePlus', 'partnersDescFontSize');

    const gatherPartnersJson = () => {
      const payload = {};

      // Booleans (always include display)
      payload.display = $('partnersDisplay').checked;
      payload.autoplay = $('partnersAutoplayEnabled').checked;
      payload.showDots = $('partnersShowDots').checked;

      // Strings/Enums
      const layoutType = $('partnersLayoutType').value;
      if (layoutType) payload.layoutType = layoutType;

      const itemWrap = $('partnersItemWrap').value;
      if (itemWrap) payload.itemWrap = itemWrap;

      const imageFit = $('partnersImageFit').value;
      if (imageFit) payload.imageFit = imageFit;

      // Colors
      if ($('partnersEnableContainerColor').checked) {
        payload.containerColor = $('partnersContainerColor').value;
      }
      if ($('partnersEnableImageBorderColor').checked) {
        payload.imageBorderColor = $('partnersImageBorderColor').value;
      }

      // Numbers
      const itemsPerPage = parseInt($('partnersItemsPerPage').value, 10);
      if (!isNaN(itemsPerPage)) payload.itemsPerPage = itemsPerPage;

      const itemHeight = parseFloat($('partnersItemHeight').value);
      if (!isNaN(itemHeight)) payload.itemHeight = itemHeight;

      const sectionAspect = parseFloat($('partnersSectionAspectRatio').value);
      if (!isNaN(sectionAspect) && sectionAspect > 0) {
        payload.sectionAspectRatio = sectionAspect;
      }

      const itemHPadding = parseFloat($('partnersItemHorizontalPadding').value);
      if (!isNaN(itemHPadding)) payload.itemHorizontalPadding = itemHPadding;

      const imageBorderWidth = parseFloat($('partnersImageBorderWidth').value);
      if (!isNaN(imageBorderWidth)) payload.imageBorderWidth = imageBorderWidth;

      const imageBorderRadius = parseFloat($('partnersImageBorderRadius').value);
      if (!isNaN(imageBorderRadius)) payload.imageBorderRadius = imageBorderRadius;

      const interval = parseFloat($('partnersAutoplayInterval').value);
      if (!isNaN(interval)) payload.autoplayIntervalSeconds = interval;

      const titleFontSize = parseFloat($('partnersTitleFontSize').value);
      if (!isNaN(titleFontSize)) payload.titleFontSize = titleFontSize;

      const descFontSize = parseFloat($('partnersDescFontSize').value);
      if (!isNaN(descFontSize)) payload.descFontSize = descFontSize;

      return payload;
    };

    savePartnersBtn.addEventListener('click', () => {
      const payload = gatherPartnersJson();
      const targetOrderVal = $('partnersTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'PARTNERS_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      partnersJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Slider Playground Logic ----
  const sliderForm = $('slider-form');
  if (sliderForm) {
    const saveSliderBtn = $('save-slider-btn');
    const sliderJsonPreview = $('sliderJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('sliderAspectRatioMinus', 'sliderAspectRatioPlus', 'sliderAspectRatio');
    setupNumberControl('sliderMinHeightMinus', 'sliderMinHeightPlus', 'sliderMinHeight');
    setupNumberControl('sliderImageBorderRadiusMinus', 'sliderImageBorderRadiusPlus', 'sliderImageBorderRadius');
    setupNumberControl('sliderDotsBottomOffsetMinus', 'sliderDotsBottomOffsetPlus', 'sliderDotsBottomOffset');
    setupNumberControl('sliderAutoplayIntervalMinus', 'sliderAutoplayIntervalPlus', 'sliderAutoplayInterval');
    setupNumberControl('sliderBadgeFontSizeMinus', 'sliderBadgeFontSizePlus', 'sliderBadgeFontSize');
    setupNumberControl('sliderTitleFontSizeMinus', 'sliderTitleFontSizePlus', 'sliderTitleFontSize');
    setupNumberControl('sliderSubtitleFontSizeMinus', 'sliderSubtitleFontSizePlus', 'sliderSubtitleFontSize');
    setupNumberControl('sliderButtonBorderRadiusMinus', 'sliderButtonBorderRadiusPlus', 'sliderButtonBorderRadius');
    setupNumberControl('sliderButtonFontSizeMinus', 'sliderButtonFontSizePlus', 'sliderButtonFontSize');

    const gatherSliderJson = () => {
      const payload = {};

      // Booleans (always include)
      payload.display = $('sliderDisplay').checked;
      payload.showDots = $('sliderShowDots').checked;
      payload.autoplay = $('sliderAutoplayEnabled').checked;
      payload.showOverlay = $('sliderShowOverlay').checked;

      // Strings / Enums
      const imageFit = $('sliderImageFit').value;
      if (imageFit) payload.imageFit = imageFit;

      const dotsPosition = $('sliderDotsPosition').value;
      if (dotsPosition) payload.dotsPosition = dotsPosition;

      const overlayPosition = $('sliderOverlayPosition').value;
      if (overlayPosition) payload.overlayPosition = overlayPosition;

      const buttonStyle = $('sliderButtonStyle').value;
      if (buttonStyle) payload.buttonStyle = buttonStyle;

      // Numbers — 0/empty is "no override" for size/ratio fields
      const aspect = parseFloat($('sliderAspectRatio').value);
      if (!isNaN(aspect) && aspect > 0) payload.aspectRatio = aspect;

      const minHeight = parseFloat($('sliderMinHeight').value);
      if (!isNaN(minHeight) && minHeight > 0) payload.minHeight = minHeight;

      const imageRadius = parseFloat($('sliderImageBorderRadius').value);
      if (!isNaN(imageRadius)) payload.imageBorderRadius = imageRadius;

      const dotsOffset = parseFloat($('sliderDotsBottomOffset').value);
      if (!isNaN(dotsOffset)) payload.dotsBottomOffset = dotsOffset;

      const interval = parseFloat($('sliderAutoplayInterval').value);
      if (!isNaN(interval)) payload.autoplayIntervalSeconds = interval;

      const badgeSize = parseFloat($('sliderBadgeFontSize').value);
      if (!isNaN(badgeSize)) payload.badgeFontSize = badgeSize;

      const titleSize = parseFloat($('sliderTitleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;

      const subtitleSize = parseFloat($('sliderSubtitleFontSize').value);
      if (!isNaN(subtitleSize)) payload.subtitleFontSize = subtitleSize;

      const buttonRadius = parseFloat($('sliderButtonBorderRadius').value);
      if (!isNaN(buttonRadius)) payload.buttonBorderRadius = buttonRadius;

      const buttonFont = parseFloat($('sliderButtonFontSize').value);
      if (!isNaN(buttonFont)) payload.buttonFontSize = buttonFont;

      return payload;
    };

    saveSliderBtn.addEventListener('click', () => {
      const payload = gatherSliderJson();
      const targetOrderVal = $('sliderTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'SLIDER_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      sliderJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Products Playground Logic ----
  const productsForm = $('products-form');
  if (productsForm) {
    const saveProductsBtn = $('save-products-btn');
    const productsJsonPreview = $('productsJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('productsTitleSizeMinus', 'productsTitleSizePlus', 'productsTitleFontSize');
    setupNumberControl('productsDescSizeMinus', 'productsDescSizePlus', 'productsDescFontSize');
    setupNumberControl('productsCrossAxisMinus', 'productsCrossAxisPlus', 'productsCrossAxisCount');
    setupNumberControl('productsCardAspectMinus', 'productsCardAspectPlus', 'productsCardAspectRatio');
    setupNumberControl('productsItemWidthMinus', 'productsItemWidthPlus', 'productsItemWidth');
    setupNumberControl('productsSpacingMinus', 'productsSpacingPlus', 'productsCrossAxisSpacing');
    setupNumberControl('productsMaxItemsMinus', 'productsMaxItemsPlus', 'productsMaxItems');
    setupNumberControl('productsContainerRadiusMinus', 'productsContainerRadiusPlus', 'productsContainerBorderRadius');
    setupNumberControl('productsCtaRadiusMinus', 'productsCtaRadiusPlus', 'productsCtaBorderRadius');
    setupNumberControl('productsCtaBorderWidthMinus', 'productsCtaBorderWidthPlus', 'productsCtaBorderWidth');
    setupNumberControl('productsCtaFontSizeMinus', 'productsCtaFontSizePlus', 'productsCtaFontSize');

    const gatherProductsJson = () => {
      const payload = {};

      // Booleans (always include the always-relevant ones)
      payload.display = $('productsDisplay').checked;
      payload.showHeader = $('productsShowHeader').checked;
      payload.showDescription = $('productsShowDescription').checked;
      payload.descriptionAboveTitle = $('productsDescAboveTitle').checked;
      payload.showBottomDivider = $('productsShowBottomDivider').checked;
      payload.ctaShowArrow = $('productsCtaShowArrow').checked;

      // Strings / Enums
      const headerLayout = $('productsHeaderLayout').value;
      if (headerLayout) payload.headerLayout = headerLayout;

      const layoutMode = $('productsLayoutMode').value;
      if (layoutMode) payload.layoutMode = layoutMode;

      const ctaPosition = $('productsCtaPosition').value;
      if (ctaPosition) payload.ctaPosition = ctaPosition;

      // Colors
      if ($('productsEnableContainerColor').checked) {
        payload.containerColor = $('productsContainerColor').value;
      }

      // Numbers
      const titleSize = parseFloat($('productsTitleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;

      const descSize = parseFloat($('productsDescFontSize').value);
      if (!isNaN(descSize)) payload.descFontSize = descSize;

      const crossAxis = parseInt($('productsCrossAxisCount').value, 10);
      if (!isNaN(crossAxis)) payload.crossAxisCount = crossAxis;

      const cardAspect = parseFloat($('productsCardAspectRatio').value);
      if (!isNaN(cardAspect) && cardAspect > 0) payload.cardAspectRatio = cardAspect;

      const itemWidth = parseFloat($('productsItemWidth').value);
      if (!isNaN(itemWidth) && itemWidth > 0) payload.itemWidth = itemWidth;

      const spacing = parseFloat($('productsCrossAxisSpacing').value);
      if (!isNaN(spacing)) {
        payload.crossAxisSpacing = spacing;
        payload.mainAxisSpacing = spacing;
      }

      const maxItems = parseInt($('productsMaxItems').value, 10);
      if (!isNaN(maxItems)) payload.maxItems = maxItems;

      const containerRadius = parseFloat($('productsContainerBorderRadius').value);
      if (!isNaN(containerRadius)) payload.containerBorderRadius = containerRadius;

      const ctaRadius = parseFloat($('productsCtaBorderRadius').value);
      if (!isNaN(ctaRadius)) payload.ctaBorderRadius = ctaRadius;

      const ctaBorderWidth = parseFloat($('productsCtaBorderWidth').value);
      if (!isNaN(ctaBorderWidth)) payload.ctaBorderWidth = ctaBorderWidth;

      const ctaFontSize = parseFloat($('productsCtaFontSize').value);
      if (!isNaN(ctaFontSize)) payload.ctaFontSize = ctaFontSize;

      return payload;
    };

    saveProductsBtn.addEventListener('click', () => {
      const payload = gatherProductsJson();
      const targetOrderVal = $('productsTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'PRODUCTS_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      productsJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Categories Playground Logic ----
  const categoriesForm = $('categories-form');
  if (categoriesForm) {
    const saveCategoriesBtn = $('save-categories-btn');
    const categoriesJsonPreview = $('categoriesJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('categoriesTitleSizeMinus', 'categoriesTitleSizePlus', 'categoriesTitleFontSize');
    setupNumberControl('categoriesItemWidthMinus', 'categoriesItemWidthPlus', 'categoriesItemWidth');
    setupNumberControl('categoriesListHeightMinus', 'categoriesListHeightPlus', 'categoriesListHeight');
    setupNumberControl('categoriesCrossAxisMinus', 'categoriesCrossAxisPlus', 'categoriesCrossAxisCount');
    setupNumberControl('categoriesCardAspectMinus', 'categoriesCardAspectPlus', 'categoriesCardAspectRatio');
    setupNumberControl('categoriesVerticalHeightMinus', 'categoriesVerticalHeightPlus', 'categoriesVerticalItemHeight');
    setupNumberControl('categoriesSpacingMinus', 'categoriesSpacingPlus', 'categoriesCrossAxisSpacing');
    setupNumberControl('categoriesMaxItemsMinus', 'categoriesMaxItemsPlus', 'categoriesMaxItems');
    setupNumberControl('categoriesItemRadiusMinus', 'categoriesItemRadiusPlus', 'categoriesItemCornerRadius');
    setupNumberControl('categoriesItemBorderWidthMinus', 'categoriesItemBorderWidthPlus', 'categoriesItemBorderWidth');
    setupNumberControl('categoriesLabelSizeMinus', 'categoriesLabelSizePlus', 'categoriesLabelFontSize');
    setupNumberControl('categoriesContainerRadiusMinus', 'categoriesContainerRadiusPlus', 'categoriesContainerBorderRadius');
    setupNumberControl('categoriesCtaRadiusMinus', 'categoriesCtaRadiusPlus', 'categoriesCtaBorderRadius');
    setupNumberControl('categoriesCtaBorderWidthMinus', 'categoriesCtaBorderWidthPlus', 'categoriesCtaBorderWidth');

    const gatherCategoriesJson = () => {
      const payload = {};

      // Booleans (always include)
      payload.display = $('categoriesDisplay').checked;
      payload.showHeader = $('categoriesShowHeader').checked;
      payload.showDescription = $('categoriesShowDescription').checked;
      payload.showBottomDivider = $('categoriesShowBottomDivider').checked;
      payload.ctaShowArrow = $('categoriesCtaShowArrow').checked;
      payload.overlayLabelHasScrim = $('categoriesOverlayScrim').checked;

      // Strings / Enums
      const headerLayout = $('categoriesHeaderLayout').value;
      if (headerLayout) payload.headerLayout = headerLayout;

      const layoutMode = $('categoriesLayoutMode').value;
      if (layoutMode) payload.layoutMode = layoutMode;

      const itemShape = $('categoriesItemShape').value;
      if (itemShape) payload.itemShape = itemShape;

      const labelMode = $('categoriesLabelMode').value;
      if (labelMode) payload.labelMode = labelMode;

      const bgSource = $('categoriesItemBgSource').value;
      if (bgSource) payload.itemBgSource = bgSource;

      const ctaPosition = $('categoriesCtaPosition').value;
      if (ctaPosition) payload.ctaPosition = ctaPosition;

      // Colors
      if ($('categoriesEnableContainerColor').checked) {
        payload.containerColor = $('categoriesContainerColor').value;
      }
      if ($('categoriesEnableItemBorderColor').checked) {
        payload.itemBorderColor = $('categoriesItemBorderColor').value;
      }

      // Numbers
      const titleSize = parseFloat($('categoriesTitleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;

      const itemWidth = parseFloat($('categoriesItemWidth').value);
      if (!isNaN(itemWidth) && itemWidth > 0) payload.itemWidth = itemWidth;

      const listHeight = parseFloat($('categoriesListHeight').value);
      if (!isNaN(listHeight) && listHeight > 0) payload.listHeight = listHeight;

      const crossAxis = parseInt($('categoriesCrossAxisCount').value, 10);
      if (!isNaN(crossAxis)) payload.crossAxisCount = crossAxis;

      const cardAspect = parseFloat($('categoriesCardAspectRatio').value);
      if (!isNaN(cardAspect) && cardAspect > 0) payload.cardAspectRatio = cardAspect;

      const verticalHeight = parseFloat($('categoriesVerticalItemHeight').value);
      if (!isNaN(verticalHeight) && verticalHeight > 0) payload.verticalItemHeight = verticalHeight;

      const spacing = parseFloat($('categoriesCrossAxisSpacing').value);
      if (!isNaN(spacing)) {
        payload.crossAxisSpacing = spacing;
        payload.mainAxisSpacing = spacing;
      }

      const maxItems = parseInt($('categoriesMaxItems').value, 10);
      if (!isNaN(maxItems)) payload.maxItems = maxItems;

      const itemRadius = parseFloat($('categoriesItemCornerRadius').value);
      if (!isNaN(itemRadius)) payload.itemCornerRadius = itemRadius;

      const itemBorderWidth = parseFloat($('categoriesItemBorderWidth').value);
      if (!isNaN(itemBorderWidth)) payload.itemBorderWidth = itemBorderWidth;

      const labelSize = parseFloat($('categoriesLabelFontSize').value);
      if (!isNaN(labelSize)) payload.labelFontSize = labelSize;

      const containerRadius = parseFloat($('categoriesContainerBorderRadius').value);
      if (!isNaN(containerRadius)) payload.containerBorderRadius = containerRadius;

      const ctaRadius = parseFloat($('categoriesCtaBorderRadius').value);
      if (!isNaN(ctaRadius)) payload.ctaBorderRadius = ctaRadius;

      const ctaBorderWidth = parseFloat($('categoriesCtaBorderWidth').value);
      if (!isNaN(ctaBorderWidth)) payload.ctaBorderWidth = ctaBorderWidth;

      return payload;
    };

    saveCategoriesBtn.addEventListener('click', () => {
      const payload = gatherCategoriesJson();
      const targetOrderVal = $('categoriesTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'CATEGORIES_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      categoriesJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Countdown Playground Logic ----
  const countdownForm = $('countdown-form');
  if (countdownForm) {
    const saveCountdownBtn = $('save-countdown-btn');
    const countdownJsonPreview = $('countdownJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('countdownImageHeightMinus', 'countdownImageHeightPlus', 'countdownImageHeight');
    setupNumberControl('countdownImageRadiusMinus', 'countdownImageRadiusPlus', 'countdownImageBorderRadius');
    setupNumberControl('countdownOverlayOpacityMinus', 'countdownOverlayOpacityPlus', 'countdownOverlayOpacity');
    setupNumberControl('countdownTitleSizeMinus', 'countdownTitleSizePlus', 'countdownTitleFontSize');
    setupNumberControl('countdownDescSizeMinus', 'countdownDescSizePlus', 'countdownDescFontSize');
    setupNumberControl('countdownCellSizeMinus', 'countdownCellSizePlus', 'countdownCellSize');
    setupNumberControl('countdownCellRadiusMinus', 'countdownCellRadiusPlus', 'countdownCellRadius');
    setupNumberControl('countdownCellBorderWidthMinus', 'countdownCellBorderWidthPlus', 'countdownCellBorderWidth');
    setupNumberControl('countdownCellSpacingMinus', 'countdownCellSpacingPlus', 'countdownCellSpacing');
    setupNumberControl('countdownNumberSizeMinus', 'countdownNumberSizePlus', 'countdownNumberFontSize');
    setupNumberControl('countdownLabelSizeMinus', 'countdownLabelSizePlus', 'countdownLabelFontSize');
    setupNumberControl('countdownCtaRadiusMinus', 'countdownCtaRadiusPlus', 'countdownCtaBorderRadius');
    setupNumberControl('countdownCtaFontSizeMinus', 'countdownCtaFontSizePlus', 'countdownCtaFontSize');

    const gatherCountdownJson = () => {
      const payload = {};

      // Booleans (always include)
      payload.display = $('countdownDisplay').checked;
      payload.showBadge = $('countdownShowBadge').checked;
      payload.showTitle = $('countdownShowTitle').checked;
      payload.showDescription = $('countdownShowDescription').checked;
      payload.showDays = $('countdownShowDays').checked;
      payload.showHours = $('countdownShowHours').checked;
      payload.showMinutes = $('countdownShowMinutes').checked;
      payload.showSeconds = $('countdownShowSeconds').checked;

      // Strings / Enums
      const imagePlacement = $('countdownImagePlacement').value;
      if (imagePlacement) payload.imagePlacement = imagePlacement;

      const imageFit = $('countdownImageFit').value;
      if (imageFit) payload.imageFit = imageFit;

      const headerPosition = $('countdownHeaderPosition').value;
      if (headerPosition) payload.headerPosition = headerPosition;

      const cellStyle = $('countdownCellStyle').value;
      if (cellStyle) payload.cellStyle = cellStyle;

      const labelPosition = $('countdownLabelPosition').value;
      if (labelPosition) payload.labelPosition = labelPosition;

      const separatorStyle = $('countdownSeparatorStyle').value;
      if (separatorStyle) payload.separatorStyle = separatorStyle;

      const ctaPosition = $('countdownCtaPosition').value;
      if (ctaPosition) payload.ctaPosition = ctaPosition;

      // Colors
      if ($('countdownEnableContainerColor').checked) {
        payload.containerColor = $('countdownContainerColor').value;
      }
      if ($('countdownEnableCellBgColor').checked) {
        payload.cellBgColor = $('countdownCellBgColor').value;
      }
      if ($('countdownEnableCellBorderColor').checked) {
        payload.cellBorderColor = $('countdownCellBorderColor').value;
      }
      if ($('countdownEnableNumberColor').checked) {
        payload.numberColor = $('countdownNumberColor').value;
      }
      if ($('countdownEnableLabelColor').checked) {
        payload.labelColor = $('countdownLabelColor').value;
      }
      if ($('countdownEnableSeparatorColor').checked) {
        payload.separatorColor = $('countdownSeparatorColor').value;
      }

      // Numbers
      const imageHeight = parseFloat($('countdownImageHeight').value);
      if (!isNaN(imageHeight) && imageHeight > 0) payload.imageHeight = imageHeight;

      const imageRadius = parseFloat($('countdownImageBorderRadius').value);
      if (!isNaN(imageRadius)) payload.imageBorderRadius = imageRadius;

      const overlayOpacity = parseFloat($('countdownOverlayOpacity').value);
      if (!isNaN(overlayOpacity)) payload.overlayOpacity = overlayOpacity;

      const titleSize = parseFloat($('countdownTitleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;

      const descSize = parseFloat($('countdownDescFontSize').value);
      if (!isNaN(descSize)) payload.descFontSize = descSize;

      const cellSize = parseFloat($('countdownCellSize').value);
      if (!isNaN(cellSize)) payload.cellSize = cellSize;

      const cellRadius = parseFloat($('countdownCellRadius').value);
      if (!isNaN(cellRadius)) payload.cellRadius = cellRadius;

      const cellBorderWidth = parseFloat($('countdownCellBorderWidth').value);
      if (!isNaN(cellBorderWidth)) payload.cellBorderWidth = cellBorderWidth;

      const cellSpacing = parseFloat($('countdownCellSpacing').value);
      if (!isNaN(cellSpacing)) payload.cellSpacing = cellSpacing;

      const numberSize = parseFloat($('countdownNumberFontSize').value);
      if (!isNaN(numberSize)) payload.numberFontSize = numberSize;

      const labelSize = parseFloat($('countdownLabelFontSize').value);
      if (!isNaN(labelSize)) payload.labelFontSize = labelSize;

      const ctaRadius = parseFloat($('countdownCtaBorderRadius').value);
      if (!isNaN(ctaRadius)) payload.ctaBorderRadius = ctaRadius;

      const ctaFontSize = parseFloat($('countdownCtaFontSize').value);
      if (!isNaN(ctaFontSize)) payload.ctaFontSize = ctaFontSize;

      return payload;
    };

    saveCountdownBtn.addEventListener('click', () => {
      const payload = gatherCountdownJson();
      const targetOrderVal = $('countdownTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'COUNTDOWN_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      countdownJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Testimonials Playground Logic ----
  const testimonialsForm = $('testimonials-form');
  if (testimonialsForm) {
    const saveTestimonialsBtn = $('save-testimonials-btn');
    const testimonialsJsonPreview = $('testimonialsJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('testimonialsTitleSizeMinus', 'testimonialsTitleSizePlus', 'testimonialsTitleFontSize');
    setupNumberControl('testimonialsDescSizeMinus', 'testimonialsDescSizePlus', 'testimonialsDescFontSize');
    setupNumberControl('testimonialsAutoplayIntervalMinus', 'testimonialsAutoplayIntervalPlus', 'testimonialsAutoplayInterval');
    setupNumberControl('testimonialsItemsPerPageMinus', 'testimonialsItemsPerPagePlus', 'testimonialsItemsPerPage');
    setupNumberControl('testimonialsDividerThicknessMinus', 'testimonialsDividerThicknessPlus', 'testimonialsDividerThickness');
    setupNumberControl('testimonialsSpacerHeightMinus', 'testimonialsSpacerHeightPlus', 'testimonialsSpacerHeight');
    setupNumberControl('testimonialsArrowSizeMinus', 'testimonialsArrowSizePlus', 'testimonialsArrowSize');
    setupNumberControl('testimonialsCardRadiusMinus', 'testimonialsCardRadiusPlus', 'testimonialsCardBorderRadius');
    setupNumberControl('testimonialsCardBorderWidthMinus', 'testimonialsCardBorderWidthPlus', 'testimonialsCardBorderWidth');
    setupNumberControl('testimonialsWidthDeltaMinus', 'testimonialsWidthDeltaPlus', 'testimonialsWidthDelta');
    setupNumberControl('testimonialsHeightCapMinus', 'testimonialsHeightCapPlus', 'testimonialsHeightCap');
    setupNumberControl('testimonialsAvatarSizeMinus', 'testimonialsAvatarSizePlus', 'testimonialsAvatarSize');
    setupNumberControl('testimonialsRatingIconSizeMinus', 'testimonialsRatingIconSizePlus', 'testimonialsRatingIconSize');
    setupNumberControl('testimonialsQuoteSizeMinus', 'testimonialsQuoteSizePlus', 'testimonialsQuoteFontSize');
    setupNumberControl('testimonialsAuthorSizeMinus', 'testimonialsAuthorSizePlus', 'testimonialsAuthorFontSize');
    setupNumberControl('testimonialsDateSizeMinus', 'testimonialsDateSizePlus', 'testimonialsDateFontSize');

    const gatherTestimonialsJson = () => {
      const payload = {};

      // Booleans
      payload.display = $('testimonialsDisplay').checked;
      payload.showTitle = $('testimonialsShowTitle').checked;
      payload.showDescription = $('testimonialsShowDescription').checked;
      payload.headerDividers = $('testimonialsHeaderDividers').checked;
      payload.bottomDivider = $('testimonialsBottomDivider').checked;
      payload.autoplay = $('testimonialsAutoplay').checked;
      payload.authorOutsideCard = $('testimonialsAuthorOutsideCard').checked;
      payload.showRating = $('testimonialsShowRating').checked;
      payload.showQuoteIcon = $('testimonialsShowQuoteIcon').checked;

      // Strings / Enums
      const headerCross = $('testimonialsHeaderCrossAxisAlignment').value;
      if (headerCross) payload.headerCrossAxisAlignment = headerCross;

      const nav = $('testimonialsNav').value;
      if (nav) payload.nav = nav;

      const dotsAlign = $('testimonialsDotsAlignment').value;
      if (dotsAlign) payload.dotsAlignment = dotsAlign;

      const cardStyle = $('testimonialsCardStyle').value;
      if (cardStyle) payload.cardStyle = cardStyle;

      const avatarPos = $('testimonialsAvatarPosition').value;
      if (avatarPos) payload.avatarPosition = avatarPos;

      const avatarShape = $('testimonialsAvatarShape').value;
      if (avatarShape) payload.avatarShape = avatarShape;

      const quoteAlign = $('testimonialsQuoteAlign').value;
      if (quoteAlign) payload.quoteAlign = quoteAlign;

      const contentOrder = $('testimonialsContentOrder').value;
      if (contentOrder) payload.contentOrder = contentOrder.split(',');

      // Colors
      if ($('testimonialsEnableContainerColor').checked) {
        payload.containerColor = $('testimonialsContainerColor').value;
      }
      if ($('testimonialsEnableCardBgColor').checked) {
        payload.cardBgColor = $('testimonialsCardBgColor').value;
      }
      if ($('testimonialsEnableCardBorderColor').checked) {
        payload.cardBorderColor = $('testimonialsCardBorderColor').value;
      }
      if ($('testimonialsEnableArrowBgColor').checked) {
        payload.arrowBgColor = $('testimonialsArrowBgColor').value;
      }
      if ($('testimonialsEnableArrowIconColor').checked) {
        payload.arrowIconColor = $('testimonialsArrowIconColor').value;
      }
      if ($('testimonialsEnableQuoteColor').checked) {
        payload.quoteColor = $('testimonialsQuoteColor').value;
      }
      if ($('testimonialsEnableAuthorColor').checked) {
        payload.authorColor = $('testimonialsAuthorColor').value;
      }
      if ($('testimonialsEnableDividerColor').checked) {
        payload.dividerColor = $('testimonialsDividerColor').value;
      }

      // Numbers
      const itemsPerPage = parseInt($('testimonialsItemsPerPage').value, 10);
      if (!isNaN(itemsPerPage) && itemsPerPage > 0) payload.itemsPerPage = itemsPerPage;

      const dividerThickness = parseFloat($('testimonialsDividerThickness').value);
      if (!isNaN(dividerThickness) && dividerThickness > 0) payload.dividerThickness = dividerThickness;

      const spacerHeight = parseFloat($('testimonialsSpacerHeight').value);
      if (!isNaN(spacerHeight)) payload.spacerHeight = spacerHeight;
      const titleSize = parseFloat($('testimonialsTitleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;

      const descSize = parseFloat($('testimonialsDescFontSize').value);
      if (!isNaN(descSize)) payload.descFontSize = descSize;

      const interval = parseFloat($('testimonialsAutoplayInterval').value);
      if (!isNaN(interval)) payload.autoplayIntervalSeconds = interval;

      const arrowSize = parseFloat($('testimonialsArrowSize').value);
      if (!isNaN(arrowSize)) payload.arrowSize = arrowSize;

      const cardRadius = parseFloat($('testimonialsCardBorderRadius').value);
      if (!isNaN(cardRadius)) payload.cardBorderRadius = cardRadius;

      const cardBorderWidth = parseFloat($('testimonialsCardBorderWidth').value);
      if (!isNaN(cardBorderWidth)) payload.cardBorderWidth = cardBorderWidth;

      const widthDelta = parseFloat($('testimonialsWidthDelta').value);
      if (!isNaN(widthDelta)) payload.cardWidthDelta = widthDelta;

      const heightCap = parseFloat($('testimonialsHeightCap').value);
      if (!isNaN(heightCap) && heightCap > 0) payload.cardHeightCap = heightCap;

      const avatarSize = parseFloat($('testimonialsAvatarSize').value);
      if (!isNaN(avatarSize)) payload.avatarSize = avatarSize;

      const ratingIconSize = parseFloat($('testimonialsRatingIconSize').value);
      if (!isNaN(ratingIconSize)) payload.ratingIconSize = ratingIconSize;

      const quoteSize = parseFloat($('testimonialsQuoteFontSize').value);
      if (!isNaN(quoteSize)) payload.quoteFontSize = quoteSize;

      const authorSize = parseFloat($('testimonialsAuthorFontSize').value);
      if (!isNaN(authorSize)) payload.authorFontSize = authorSize;

      const dateSize = parseFloat($('testimonialsDateFontSize').value);
      if (!isNaN(dateSize)) payload.dateFontSize = dateSize;

      return payload;
    };

    saveTestimonialsBtn.addEventListener('click', () => {
      const payload = gatherTestimonialsJson();
      const targetOrderVal = $('testimonialsTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'TESTIMONIALS_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      testimonialsJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Video Playground Logic ----
  const videoForm = $('video-form');
  if (videoForm) {
    const saveVideoBtn = $('save-video-btn');
    const videoJsonPreview = $('videoJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('videoContainerRadiusMinus', 'videoContainerRadiusPlus', 'videoContainerBorderRadius');
    setupNumberControl('videoFixedHeightFractionMinus', 'videoFixedHeightFractionPlus', 'videoFixedHeightFraction');
    setupNumberControl('videoTitleSizeMinus', 'videoTitleSizePlus', 'videoTitleFontSize');
    setupNumberControl('videoDescSizeMinus', 'videoDescSizePlus', 'videoDescFontSize');
    setupNumberControl('videoVisibilityThresholdMinus', 'videoVisibilityThresholdPlus', 'videoVisibilityThreshold');
    setupNumberControl('videoAspectRatioMinus', 'videoAspectRatioPlus', 'videoAspectRatio');
    setupNumberControl('videoYoutubeStartMinus', 'videoYoutubeStartPlus', 'videoYoutubeStartSeconds');
    setupNumberControl('videoPlayButtonSizeMinus', 'videoPlayButtonSizePlus', 'videoPlayButtonSize');

    const gatherVideoJson = () => {
      const payload = {};

      // Booleans
      payload.display = $('videoDisplay').checked;
      payload.showTitle = $('videoShowTitle').checked;
      payload.showDescription = $('videoShowDescription').checked;
      payload.autoplay = $('videoAutoplay').checked;
      payload.loop = $('videoLoop').checked;
      payload.muted = $('videoMuted').checked;
      payload.showControls = $('videoShowControls').checked;
      payload.playOnVisible = $('videoPlayOnVisible').checked;
      payload.showMuteButton = $('videoShowMuteButton').checked;
      payload.showPlayButton = $('videoShowPlayButton').checked;

      // Enums
      const posterMode = $('videoPosterMode').value;
      if (posterMode) payload.posterMode = posterMode;
      const posterFit = $('videoPosterFit').value;
      if (posterFit) payload.posterFit = posterFit;

      // Colors
      if ($('videoEnableContainerColor').checked) {
        payload.containerColor = $('videoContainerColor').value;
      }

      // Numbers
      const containerRadius = parseFloat($('videoContainerBorderRadius').value);
      if (!isNaN(containerRadius)) payload.containerBorderRadius = containerRadius;

      const heightFraction = parseFloat($('videoFixedHeightFraction').value);
      if (!isNaN(heightFraction) && heightFraction > 0) payload.fixedHeightFraction = heightFraction;

      const titleSize = parseFloat($('videoTitleFontSize').value);
      if (!isNaN(titleSize)) payload.titleFontSize = titleSize;

      const descSize = parseFloat($('videoDescFontSize').value);
      if (!isNaN(descSize)) payload.descFontSize = descSize;

      const visibility = parseFloat($('videoVisibilityThreshold').value);
      if (!isNaN(visibility)) payload.visibilityThreshold = visibility;

      const aspect = parseFloat($('videoAspectRatio').value);
      if (!isNaN(aspect) && aspect > 0) payload.aspectRatio = aspect;

      const youtubeStart = parseInt($('videoYoutubeStartSeconds').value, 10);
      if (!isNaN(youtubeStart)) payload.youtubeStartSeconds = youtubeStart;

      const playButtonSize = parseFloat($('videoPlayButtonSize').value);
      if (!isNaN(playButtonSize)) payload.playButtonSize = playButtonSize;

      return payload;
    };

    saveVideoBtn.addEventListener('click', () => {
      const payload = gatherVideoJson();
      const targetOrderVal = $('videoTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'VIDEO_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      videoJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Description Playground Logic ----
  const descriptionForm = $('description-form');
  if (descriptionForm) {
    const saveDescriptionBtn = $('save-description-btn');
    const descriptionJsonPreview = $('descriptionJsonPreview');

    const setupNumberControl = (minusId, plusId, inputId) => {
      const minus = $(minusId);
      const plus = $(plusId);
      const input = $(inputId);
      if (!minus || !plus || !input) return;
      const step = parseFloat(input.step) || 1;
      minus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.max(parseFloat(input.min) || 0, val - step);
      });
      plus.addEventListener('click', () => {
        let val = parseFloat(input.value) || 0;
        input.value = Math.min(parseFloat(input.max) || 100, val + step);
      });
    };

    setupNumberControl('descriptionPaddingMinus', 'descriptionPaddingPlus', 'descriptionPadding');
    setupNumberControl('descriptionMarginMinus', 'descriptionMarginPlus', 'descriptionMargin');
    setupNumberControl('descriptionBorderRadiusMinus', 'descriptionBorderRadiusPlus', 'descriptionBorderRadius');
    setupNumberControl('descriptionTitleSizeMinus', 'descriptionTitleSizePlus', 'descriptionTitleFontSize');
    setupNumberControl('descriptionDescSizeMinus', 'descriptionDescSizePlus', 'descriptionDescFontSize');
    setupNumberControl('descriptionSpacingBetweenMinus', 'descriptionSpacingBetweenPlus', 'descriptionSpacingBetween');
    setupNumberControl('descriptionLogoHeightMinus', 'descriptionLogoHeightPlus', 'descriptionLogoHeight');
    setupNumberControl('descriptionIconHeightMinus', 'descriptionIconHeightPlus', 'descriptionIconHeight');
    setupNumberControl('descriptionIconPaddingMinus', 'descriptionIconPaddingPlus', 'descriptionIconPadding');

    const gatherDescriptionJson = () => {
      const payload = {};

      // Top-level
      payload.display = $('descriptionDisplay').checked;

      // Container
      const padding = parseFloat($('descriptionPadding').value);
      if (!isNaN(padding)) payload.padding = padding;

      const margin = parseFloat($('descriptionMargin').value);
      if (!isNaN(margin)) payload.margin = margin;

      const borderRadius = parseFloat($('descriptionBorderRadius').value);
      if (!isNaN(borderRadius)) payload.border_radius = borderRadius;

      if ($('descriptionEnableBgColor').checked) {
        payload.bg_color = $('descriptionBgColor').value;
      }
      payload.use_image_as_background = $('descriptionUseImageAsBackground').checked;
      payload.use_component_bg_color = $('descriptionUseComponentBgColor').checked;

      const crossAxis = $('descriptionCrossAxisAlignment').value;
      if (crossAxis) payload.cross_axis_alignment = crossAxis;

      // Header
      payload.show_title = $('descriptionShowTitle').checked;
      payload.show_description = $('descriptionShowDescription').checked;

      const titleFontSize = parseFloat($('descriptionTitleFontSize').value);
      if (!isNaN(titleFontSize)) payload.title_font_size = titleFontSize;

      const titleFontWeight = $('descriptionTitleFontWeight').value;
      if (titleFontWeight) payload.title_font_weight = titleFontWeight;

      const titleTextAlign = $('descriptionTitleTextAlign').value;
      if (titleTextAlign) payload.title_text_align = titleTextAlign;

      if ($('descriptionEnableTitleColor').checked) {
        payload.title_color = $('descriptionTitleColor').value;
      }

      const descFontSize = parseFloat($('descriptionDescFontSize').value);
      if (!isNaN(descFontSize)) payload.desc_font_size = descFontSize;

      if ($('descriptionEnableDescColor').checked) {
        payload.desc_color = $('descriptionDescColor').value;
      }

      const spacingBetween = parseFloat($('descriptionSpacingBetween').value);
      if (!isNaN(spacingBetween)) payload.spacing_between = spacingBetween;

      // Logo
      payload.show_logo = $('descriptionShowLogo').checked;
      const logoHeight = parseFloat($('descriptionLogoHeight').value);
      if (!isNaN(logoHeight) && logoHeight > 0) payload.logo_height = logoHeight;
      payload.show_follow_us_text = $('descriptionShowFollowUsText').checked;

      // Social
      payload.show_social = $('descriptionShowSocial').checked;
      payload.only_social = $('descriptionOnlySocial').checked;

      const iconSet = $('descriptionIconSet').value;
      if (iconSet) payload.icon_set = iconSet;

      const socialMainAxis = $('descriptionSocialMainAxis').value;
      if (socialMainAxis) payload.social_main_axis = socialMainAxis;

      const iconHeight = parseFloat($('descriptionIconHeight').value);
      if (!isNaN(iconHeight)) payload.icon_height = iconHeight;

      const iconPadding = parseFloat($('descriptionIconPadding').value);
      if (!isNaN(iconPadding)) payload.icon_padding = iconPadding;

      if ($('descriptionEnableIconColor').checked) {
        payload.icon_color = $('descriptionIconColor').value;
      }

      payload.show_tiktok = $('descriptionShowTiktok').checked;
      payload.show_twitter = $('descriptionShowTwitter').checked;
      payload.show_snapchat = $('descriptionShowSnapchat').checked;
      payload.show_instagram = $('descriptionShowInstagram').checked;
      payload.show_facebook = $('descriptionShowFacebook').checked;
      payload.show_phone = $('descriptionShowPhone').checked;
      payload.show_email = $('descriptionShowEmail').checked;

      return payload;
    };

    saveDescriptionBtn.addEventListener('click', () => {
      const payload = gatherDescriptionJson();
      const targetOrderVal = $('descriptionTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'DESCRIPTION_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      descriptionJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Shared num-control wiring ----
  const wireNumberControl = (minusId, plusId, inputId) => {
    const minus = $(minusId);
    const plus = $(plusId);
    const input = $(inputId);
    if (!minus || !plus || !input) return;
    const step = parseFloat(input.step) || 1;
    minus.addEventListener('click', () => {
      let val = parseFloat(input.value) || 0;
      input.value = Math.max(parseFloat(input.min) || 0, val - step);
    });
    plus.addEventListener('click', () => {
      let val = parseFloat(input.value) || 0;
      input.value = Math.min(parseFloat(input.max) || 100, val + step);
    });
  };

  // ---- Instagram Playground Logic ----
  const instagramForm = $('instagram-form');
  if (instagramForm) {
    const saveInstagramBtn = $('save-instagram-btn');
    const instagramJsonPreview = $('instagramJsonPreview');

    wireNumberControl('instagramTitleSizeMinus', 'instagramTitleSizePlus', 'instagramTitleFontSize');
    wireNumberControl('instagramAccountSizeMinus', 'instagramAccountSizePlus', 'instagramAccountFontSize');
    wireNumberControl('instagramAspectRatioMinus', 'instagramAspectRatioPlus', 'instagramAspectRatio');
    wireNumberControl('instagramItemHPaddingMinus', 'instagramItemHPaddingPlus', 'instagramItemHorizontalPadding');
    wireNumberControl('instagramItemBorderRadiusMinus', 'instagramItemBorderRadiusPlus', 'instagramItemBorderRadius');

    const gatherInstagramJson = () => {
      const payload = {};
      payload.display = $('instagramDisplay').checked;
      payload.show_title = $('instagramShowTitle').checked;
      payload.show_account = $('instagramShowAccount').checked;
      payload.show_overlay = $('instagramShowOverlay').checked;
      payload.show_instagram_icon = $('instagramShowInstagramIcon').checked;

      if ($('instagramEnableBgColor').checked) payload.bg_color = $('instagramBgColor').value;
      if ($('instagramEnableTitleColor').checked) payload.title_color = $('instagramTitleColor').value;
      if ($('instagramEnableAccountColor').checked) payload.account_color = $('instagramAccountColor').value;
      if ($('instagramEnableInstagramIconColor').checked) payload.instagram_icon_color = $('instagramInstagramIconColor').value;

      const titleSize = parseFloat($('instagramTitleFontSize').value);
      if (!isNaN(titleSize)) payload.title_font_size = titleSize;

      const accountSize = parseFloat($('instagramAccountFontSize').value);
      if (!isNaN(accountSize)) payload.account_font_size = accountSize;

      const aspectRatio = parseFloat($('instagramAspectRatio').value);
      if (!isNaN(aspectRatio) && aspectRatio > 0) payload.aspect_ratio = aspectRatio;

      const itemHPadding = parseFloat($('instagramItemHorizontalPadding').value);
      if (!isNaN(itemHPadding)) payload.item_horizontal_padding = itemHPadding;

      const itemBorderRadius = parseFloat($('instagramItemBorderRadius').value);
      if (!isNaN(itemBorderRadius)) payload.item_border_radius = itemBorderRadius;

      const imageFit = $('instagramImageFit').value;
      if (imageFit) payload.image_fit = imageFit;

      return payload;
    };

    saveInstagramBtn.addEventListener('click', () => {
      const payload = gatherInstagramJson();
      const targetOrderVal = $('instagramTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'INSTAGRAM_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      instagramJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Icon Box Playground Logic ----
  const iconBoxForm = $('icon-box-form');
  if (iconBoxForm) {
    const saveIconBoxBtn = $('save-icon-box-btn');
    const iconBoxJsonPreview = $('iconBoxJsonPreview');

    wireNumberControl('iconBoxPaddingMinus', 'iconBoxPaddingPlus', 'iconBoxPadding');
    wireNumberControl('iconBoxMarginMinus', 'iconBoxMarginPlus', 'iconBoxMargin');
    wireNumberControl('iconBoxBorderRadiusMinus', 'iconBoxBorderRadiusPlus', 'iconBoxBorderRadius');
    wireNumberControl('iconBoxIconHeightMinus', 'iconBoxIconHeightPlus', 'iconBoxIconHeight');
    wireNumberControl('iconBoxIconSpacingMinus', 'iconBoxIconSpacingPlus', 'iconBoxIconSpacingAfter');
    wireNumberControl('iconBoxTitleSizeMinus', 'iconBoxTitleSizePlus', 'iconBoxTitleFontSize');
    wireNumberControl('iconBoxDescSizeMinus', 'iconBoxDescSizePlus', 'iconBoxDescFontSize');

    const gatherIconBoxJson = () => {
      const payload = {};
      payload.display = $('iconBoxDisplay').checked;
      payload.show_icon = $('iconBoxShowIcon').checked;
      payload.show_title = $('iconBoxShowTitle').checked;
      payload.show_description = $('iconBoxShowDescription').checked;

      const padding = parseFloat($('iconBoxPadding').value);
      if (!isNaN(padding)) payload.padding = padding;

      const margin = parseFloat($('iconBoxMargin').value);
      if (!isNaN(margin)) payload.margin = margin;

      const borderRadius = parseFloat($('iconBoxBorderRadius').value);
      if (!isNaN(borderRadius)) payload.border_radius = borderRadius;

      if ($('iconBoxEnableBgColor').checked) payload.bg_color = $('iconBoxBgColor').value;
      if ($('iconBoxEnableIconColor').checked) payload.icon_color = $('iconBoxIconColor').value;
      if ($('iconBoxEnableTitleColor').checked) payload.title_color = $('iconBoxTitleColor').value;
      if ($('iconBoxEnableDescColor').checked) payload.desc_color = $('iconBoxDescColor').value;

      const iconHeight = parseFloat($('iconBoxIconHeight').value);
      if (!isNaN(iconHeight)) payload.icon_height = iconHeight;

      const iconFit = $('iconBoxIconFit').value;
      if (iconFit) payload.icon_fit = iconFit;

      const iconSpacingAfter = parseFloat($('iconBoxIconSpacingAfter').value);
      if (!isNaN(iconSpacingAfter)) payload.icon_spacing_after = iconSpacingAfter;

      const titleSize = parseFloat($('iconBoxTitleFontSize').value);
      if (!isNaN(titleSize)) payload.title_font_size = titleSize;

      const descSize = parseFloat($('iconBoxDescFontSize').value);
      if (!isNaN(descSize)) payload.desc_font_size = descSize;

      return payload;
    };

    saveIconBoxBtn.addEventListener('click', () => {
      const payload = gatherIconBoxJson();
      const targetOrderVal = $('iconBoxTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'ICON_BOX_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      iconBoxJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Brand Playground Logic ----
  const brandForm = $('brand-form');
  if (brandForm) {
    const saveBrandBtn = $('save-brand-btn');
    const brandJsonPreview = $('brandJsonPreview');

    wireNumberControl('brandTitleSizeMinus', 'brandTitleSizePlus', 'brandTitleFontSize');
    wireNumberControl('brandSpacingAfterMinus', 'brandSpacingAfterPlus', 'brandSpacingAfter');
    wireNumberControl('brandListHeightMinus', 'brandListHeightPlus', 'brandListHeight');
    wireNumberControl('brandItemWidthMinus', 'brandItemWidthPlus', 'brandItemWidth');
    wireNumberControl('brandItemHeightMinus', 'brandItemHeightPlus', 'brandItemHeight');
    wireNumberControl('brandSingleItemHPaddingMinus', 'brandSingleItemHPaddingPlus', 'brandSingleItemHorizontalPadding');
    wireNumberControl('brandSingleItemBorderRadiusMinus', 'brandSingleItemBorderRadiusPlus', 'brandSingleItemBorderRadius');
    wireNumberControl('brandItemTitleSizeMinus', 'brandItemTitleSizePlus', 'brandItemTitleFontSize');

    const gatherBrandJson = () => {
      const payload = {};
      payload.display = $('brandDisplay').checked;
      payload.show_title = $('brandShowTitle').checked;
      payload.single_item_as_banner = $('brandSingleItemAsBanner').checked;
      payload.show_item_title = $('brandShowItemTitle').checked;

      if ($('brandEnableBgColor').checked) payload.bg_color = $('brandBgColor').value;
      if ($('brandEnableTitleColor').checked) payload.title_color = $('brandTitleColor').value;
      if ($('brandEnableItemTitleColor').checked) payload.item_title_color = $('brandItemTitleColor').value;

      const titleSize = parseFloat($('brandTitleFontSize').value);
      if (!isNaN(titleSize)) payload.title_font_size = titleSize;

      const titleWeight = $('brandTitleFontWeight').value;
      if (titleWeight) payload.title_font_weight = titleWeight;

      const titleAlign = $('brandTitleTextAlign').value;
      if (titleAlign) payload.title_text_align = titleAlign;

      const spacingAfter = parseFloat($('brandSpacingAfter').value);
      if (!isNaN(spacingAfter)) payload.spacing_after = spacingAfter;

      const listHeight = parseFloat($('brandListHeight').value);
      if (!isNaN(listHeight)) payload.list_height = listHeight;

      const itemWidth = parseFloat($('brandItemWidth').value);
      if (!isNaN(itemWidth)) payload.item_width = itemWidth;

      const itemHeight = parseFloat($('brandItemHeight').value);
      if (!isNaN(itemHeight)) payload.item_height = itemHeight;

      const imageFit = $('brandImageFit').value;
      if (imageFit) payload.image_fit = imageFit;

      const singleItemHPadding = parseFloat($('brandSingleItemHorizontalPadding').value);
      if (!isNaN(singleItemHPadding)) payload.single_item_horizontal_padding = singleItemHPadding;

      const singleItemBorderRadius = parseFloat($('brandSingleItemBorderRadius').value);
      if (!isNaN(singleItemBorderRadius)) payload.single_item_border_radius = singleItemBorderRadius;

      const itemTitleSize = parseFloat($('brandItemTitleFontSize').value);
      if (!isNaN(itemTitleSize)) payload.item_title_font_size = itemTitleSize;

      return payload;
    };

    saveBrandBtn.addEventListener('click', () => {
      const payload = gatherBrandJson();
      const targetOrderVal = $('brandTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'BRAND_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      brandJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Trust Payment Playground Logic ----
  const trustPaymentForm = $('trust-payment-form');
  if (trustPaymentForm) {
    const saveTrustPaymentBtn = $('save-trust-payment-btn');
    const trustPaymentJsonPreview = $('trustPaymentJsonPreview');

    wireNumberControl('trustPaymentPaddingMinus', 'trustPaymentPaddingPlus', 'trustPaymentPadding');
    wireNumberControl('trustPaymentMarginMinus', 'trustPaymentMarginPlus', 'trustPaymentMargin');
    wireNumberControl('trustPaymentBorderRadiusMinus', 'trustPaymentBorderRadiusPlus', 'trustPaymentBorderRadius');
    wireNumberControl('trustPaymentBorderWidthMinus', 'trustPaymentBorderWidthPlus', 'trustPaymentBorderWidth');
    wireNumberControl('trustPaymentIconHeightMinus', 'trustPaymentIconHeightPlus', 'trustPaymentIconHeight');
    wireNumberControl('trustPaymentIconOpacityMinus', 'trustPaymentIconOpacityPlus', 'trustPaymentIconOpacity');
    wireNumberControl('trustPaymentLabelSizeMinus', 'trustPaymentLabelSizePlus', 'trustPaymentLabelFontSize');
    wireNumberControl('trustPaymentCrossAxisMinus', 'trustPaymentCrossAxisPlus', 'trustPaymentCrossAxisCount');
    wireNumberControl('trustPaymentAspectRatioMinus', 'trustPaymentAspectRatioPlus', 'trustPaymentChildAspectRatio');
    wireNumberControl('trustPaymentFlexMinus', 'trustPaymentFlexPlus', 'trustPaymentExpandedFlex');
    wireNumberControl('trustPaymentItemSizeMinus', 'trustPaymentItemSizePlus', 'trustPaymentItemSize');
    wireNumberControl('trustPaymentItemBorderRadiusMinus', 'trustPaymentItemBorderRadiusPlus', 'trustPaymentItemBorderRadius');

    const gatherTrustPaymentJson = () => {
      const payload = {};

      payload.display = $('trustPaymentDisplay').checked;
      payload.wrap_in_safe_area = $('trustPaymentWrapInSafeArea').checked;
      payload.show_badge = $('trustPaymentShowBadge').checked;
      payload.show_grid = $('trustPaymentShowGrid').checked;
      payload.tap_navigates_to_delivery = $('trustPaymentTapNavigatesToDelivery').checked;
      payload.set_white_status_bar_on_init = $('trustPaymentSetWhiteStatusBarOnInit').checked;

      // Container numbers
      const padding = parseFloat($('trustPaymentPadding').value);
      if (!isNaN(padding)) payload.padding = padding;

      const margin = parseFloat($('trustPaymentMargin').value);
      if (!isNaN(margin)) payload.margin = margin;

      const borderRadius = parseFloat($('trustPaymentBorderRadius').value);
      if (!isNaN(borderRadius)) payload.border_radius = borderRadius;

      const borderWidth = parseFloat($('trustPaymentBorderWidth').value);
      if (!isNaN(borderWidth)) payload.border_width = borderWidth;

      // Container colors
      if ($('trustPaymentEnableBorderColor').checked) payload.border_color = $('trustPaymentBorderColor').value;
      if ($('trustPaymentEnableBgColor').checked) payload.bg_color = $('trustPaymentBgColor').value;

      // Badge
      const iconHeight = parseFloat($('trustPaymentIconHeight').value);
      if (!isNaN(iconHeight)) payload.icon_height = iconHeight;

      const iconOpacity = parseFloat($('trustPaymentIconOpacity').value);
      if (!isNaN(iconOpacity)) payload.icon_opacity = iconOpacity;

      if ($('trustPaymentEnableIconColor').checked) payload.icon_color = $('trustPaymentIconColor').value;

      const labelText = $('trustPaymentLabelText').value;
      if (labelText) payload.label_text = labelText;

      const labelSize = parseFloat($('trustPaymentLabelFontSize').value);
      if (!isNaN(labelSize)) payload.label_font_size = labelSize;

      const labelWeight = $('trustPaymentLabelFontWeight').value;
      if (labelWeight) payload.label_font_weight = labelWeight;

      const labelAlign = $('trustPaymentLabelTextAlign').value;
      if (labelAlign) payload.label_text_align = labelAlign;

      if ($('trustPaymentEnableLabelColor').checked) payload.label_color = $('trustPaymentLabelColor').value;

      // Grid
      const crossAxisCount = parseInt($('trustPaymentCrossAxisCount').value, 10);
      if (!isNaN(crossAxisCount)) payload.cross_axis_count = crossAxisCount;

      const childAspectRatio = parseFloat($('trustPaymentChildAspectRatio').value);
      if (!isNaN(childAspectRatio) && childAspectRatio > 0) payload.child_aspect_ratio = childAspectRatio;

      const expandedFlex = parseInt($('trustPaymentExpandedFlex').value, 10);
      if (!isNaN(expandedFlex)) payload.expanded_flex = expandedFlex;

      const itemSize = parseFloat($('trustPaymentItemSize').value);
      if (!isNaN(itemSize)) payload.item_size = itemSize;

      const itemBorderRadius = parseFloat($('trustPaymentItemBorderRadius').value);
      if (!isNaN(itemBorderRadius)) payload.item_border_radius = itemBorderRadius;

      if ($('trustPaymentEnableItemBgColor').checked) payload.item_bg_color = $('trustPaymentItemBgColor').value;

      const imageFit = $('trustPaymentImageFit').value;
      if (imageFit) payload.image_fit = imageFit;

      return payload;
    };

    saveTrustPaymentBtn.addEventListener('click', () => {
      const payload = gatherTrustPaymentJson();
      const targetOrderVal = $('trustPaymentTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'TRUST_PAYMENT_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      trustPaymentJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Announcement Bar Playground Logic ----
  const announcementBarForm = $('announcement-bar-form');
  if (announcementBarForm) {
    const saveAnnouncementBarBtn = $('save-announcement-bar-btn');
    const announcementBarJsonPreview = $('announcementBarJsonPreview');

    wireNumberControl('announcementBarPaddingMinus', 'announcementBarPaddingPlus', 'announcementBarPadding');
    wireNumberControl('announcementBarHeightMinus', 'announcementBarHeightPlus', 'announcementBarHeight');
    wireNumberControl('announcementBarFontSizeMinus', 'announcementBarFontSizePlus', 'announcementBarFontSize');
    wireNumberControl('announcementBarCloseIconSizeMinus', 'announcementBarCloseIconSizePlus', 'announcementBarCloseIconSize');
    wireNumberControl('announcementBarMarqueerPpsMinus', 'announcementBarMarqueerPpsPlus', 'announcementBarMarqueerPps');
    wireNumberControl('announcementBarMarqueeVelocityMinus', 'announcementBarMarqueeVelocityPlus', 'announcementBarMarqueeVelocity');
    wireNumberControl('announcementBarMarqueeBlankSpaceMinus', 'announcementBarMarqueeBlankSpacePlus', 'announcementBarMarqueeBlankSpace');
    wireNumberControl('announcementBarVerticalIntervalMinus', 'announcementBarVerticalIntervalPlus', 'announcementBarVerticalScrollIntervalMs');
    wireNumberControl('announcementBarVerticalStepMinus', 'announcementBarVerticalStepPlus', 'announcementBarVerticalScrollStep');
    wireNumberControl('announcementBarVerticalDurationMinus', 'announcementBarVerticalDurationPlus', 'announcementBarVerticalScrollDurationMs');
    wireNumberControl('announcementBarPagerIntervalMinus', 'announcementBarPagerIntervalPlus', 'announcementBarPagerIntervalMs');
    wireNumberControl('announcementBarPagerAnimationDurationMinus', 'announcementBarPagerAnimationDurationPlus', 'announcementBarPagerAnimationDurationMs');

    const gatherAnnouncementBarJson = () => {
      const payload = {};

      payload.display = $('announcementBarDisplay').checked;
      payload.show_close = $('announcementBarShowClose').checked;
      payload.replace_newlines_with_space = $('announcementBarReplaceNewlinesWithSpace').checked;
      payload.hide_on_tap_close = $('announcementBarHideOnTapClose').checked;

      // Container
      const padding = parseFloat($('announcementBarPadding').value);
      if (!isNaN(padding)) payload.padding = padding;

      const height = parseFloat($('announcementBarHeight').value);
      if (!isNaN(height)) payload.height = height;

      if ($('announcementBarEnableBgColor').checked) payload.bg_color = $('announcementBarBgColor').value;

      // Text
      const fontSize = parseFloat($('announcementBarFontSize').value);
      if (!isNaN(fontSize)) payload.font_size = fontSize;

      const fontWeight = $('announcementBarFontWeight').value;
      if (fontWeight) payload.font_weight = fontWeight;

      const textAlign = $('announcementBarTextAlign').value;
      if (textAlign) payload.text_align = textAlign;

      if ($('announcementBarEnableTextColor').checked) payload.text_color = $('announcementBarTextColor').value;

      // Close
      const closePosition = $('announcementBarClosePosition').value;
      if (closePosition) payload.close_position = closePosition;

      const closeIconSize = parseFloat($('announcementBarCloseIconSize').value);
      if (!isNaN(closeIconSize)) payload.close_icon_size = closeIconSize;

      if ($('announcementBarEnableCloseIconColor').checked) payload.close_icon_color = $('announcementBarCloseIconColor').value;

      // Behavior
      const layout = $('announcementBarLayout').value;
      if (layout) payload.layout = layout;

      const marqueerPps = parseFloat($('announcementBarMarqueerPps').value);
      if (!isNaN(marqueerPps)) payload.marqueer_pps = marqueerPps;

      const marqueeVelocity = parseFloat($('announcementBarMarqueeVelocity').value);
      if (!isNaN(marqueeVelocity)) payload.marquee_velocity = marqueeVelocity;

      const marqueeBlankSpace = parseFloat($('announcementBarMarqueeBlankSpace').value);
      if (!isNaN(marqueeBlankSpace)) payload.marquee_blank_space = marqueeBlankSpace;

      const verticalScrollIntervalMs = parseInt($('announcementBarVerticalScrollIntervalMs').value, 10);
      if (!isNaN(verticalScrollIntervalMs)) payload.vertical_scroll_interval_ms = verticalScrollIntervalMs;

      const verticalScrollStep = parseFloat($('announcementBarVerticalScrollStep').value);
      if (!isNaN(verticalScrollStep)) payload.vertical_scroll_step = verticalScrollStep;

      const verticalScrollDurationMs = parseInt($('announcementBarVerticalScrollDurationMs').value, 10);
      if (!isNaN(verticalScrollDurationMs)) payload.vertical_scroll_duration_ms = verticalScrollDurationMs;

      const pagerIntervalMs = parseInt($('announcementBarPagerIntervalMs').value, 10);
      if (!isNaN(pagerIntervalMs)) payload.pager_interval_ms = pagerIntervalMs;

      const pagerAnimationDurationMs = parseInt($('announcementBarPagerAnimationDurationMs').value, 10);
      if (!isNaN(pagerAnimationDurationMs)) payload.pager_animation_duration_ms = pagerAnimationDurationMs;

      return payload;
    };

    saveAnnouncementBarBtn.addEventListener('click', () => {
      const payload = gatherAnnouncementBarJson();

      // Announcement bar is store-wide — no targetOrder.
      const message = {
        type: 'ANNOUNCEMENT_BAR_PROPERTIES_OVERRIDE',
        targetOrder: null,
        payload: payload,
      };

      announcementBarJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- FAQs Playground Logic ----
  const faqsForm = $('faqs-form');
  if (faqsForm) {
    const saveFaqsBtn = $('save-faqs-btn');
    const faqsJsonPreview = $('faqsJsonPreview');

    wireNumberControl('faqsPaddingMinus', 'faqsPaddingPlus', 'faqsPadding');
    wireNumberControl('faqsTitleSizeMinus', 'faqsTitleSizePlus', 'faqsTitleFontSize');
    wireNumberControl('faqsDescSizeMinus', 'faqsDescSizePlus', 'faqsDescFontSize');
    wireNumberControl('faqsVideoFrameHeightMinus', 'faqsVideoFrameHeightPlus', 'faqsVideoFrameHeight');
    wireNumberControl('faqsVideoThumbHeightMinus', 'faqsVideoThumbHeightPlus', 'faqsVideoThumbnailHeight');
    wireNumberControl('faqsItemBorderRadiusMinus', 'faqsItemBorderRadiusPlus', 'faqsItemBorderRadius');
    wireNumberControl('faqsItemTitleSizeMinus', 'faqsItemTitleSizePlus', 'faqsItemTitleFontSize');
    wireNumberControl('faqsItemAnswerSizeMinus', 'faqsItemAnswerSizePlus', 'faqsItemAnswerFontSize');

    const gatherFaqsJson = () => {
      const payload = {};

      payload.display = $('faqsDisplay').checked;
      payload.show_header = $('faqsShowHeader').checked;
      payload.show_divider = $('faqsShowDivider').checked;
      payload.show_description = $('faqsShowDescription').checked;
      payload.show_video = $('faqsShowVideo').checked;
      payload.use_bg_color_from_component = $('faqsUseBgColorFromComponent').checked;
      payload.item_divider_before_answer = $('faqsItemDividerBeforeAnswer').checked;
      payload.list_item_divider = $('faqsListItemDivider').checked;

      // Container
      const padding = parseFloat($('faqsPadding').value);
      if (!isNaN(padding)) payload.padding = padding;

      if ($('faqsEnableBgColor').checked) payload.bg_color = $('faqsBgColor').value;

      // Header
      const titleSource = $('faqsTitleSource').value;
      if (titleSource) payload.title_source = titleSource;

      const titleFontSize = parseFloat($('faqsTitleFontSize').value);
      if (!isNaN(titleFontSize)) payload.title_font_size = titleFontSize;

      const titleFontWeight = $('faqsTitleFontWeight').value;
      if (titleFontWeight) payload.title_font_weight = titleFontWeight;

      const titleTextAlign = $('faqsTitleTextAlign').value;
      if (titleTextAlign) payload.title_text_align = titleTextAlign;

      if ($('faqsEnableTitleColor').checked) payload.title_color = $('faqsTitleColor').value;

      // Description
      const descFontSize = parseFloat($('faqsDescFontSize').value);
      if (!isNaN(descFontSize)) payload.desc_font_size = descFontSize;

      if ($('faqsEnableDescColor').checked) payload.desc_color = $('faqsDescColor').value;

      // Video
      const videoFrameHeight = parseFloat($('faqsVideoFrameHeight').value);
      if (!isNaN(videoFrameHeight)) payload.video_frame_height = videoFrameHeight;

      const videoThumbnailHeight = parseFloat($('faqsVideoThumbnailHeight').value);
      if (!isNaN(videoThumbnailHeight)) payload.video_thumbnail_height = videoThumbnailHeight;

      // Item
      if ($('faqsEnableItemBgColor').checked) payload.item_bg_color = $('faqsItemBgColor').value;

      const itemBorderRadius = parseFloat($('faqsItemBorderRadius').value);
      if (!isNaN(itemBorderRadius)) payload.item_border_radius = itemBorderRadius;

      const itemIndexStyle = $('faqsItemIndexStyle').value;
      if (itemIndexStyle) payload.item_index_style = itemIndexStyle;

      const itemTitleFontSize = parseFloat($('faqsItemTitleFontSize').value);
      if (!isNaN(itemTitleFontSize)) payload.item_title_font_size = itemTitleFontSize;

      const itemTitleFontWeight = $('faqsItemTitleFontWeight').value;
      if (itemTitleFontWeight) payload.item_title_font_weight = itemTitleFontWeight;

      const itemAnswerFontSize = parseFloat($('faqsItemAnswerFontSize').value);
      if (!isNaN(itemAnswerFontSize)) payload.item_answer_font_size = itemAnswerFontSize;

      if ($('faqsEnableItemAnswerColor').checked) payload.item_answer_color = $('faqsItemAnswerColor').value;

      const trailingStyle = $('faqsItemTrailingIconStyle').value;
      if (trailingStyle) payload.item_trailing_icon_style = trailingStyle;

      if ($('faqsEnableItemTrailingIconColor').checked) {
        payload.item_trailing_icon_color = $('faqsItemTrailingIconColor').value;
      }

      // List
      if ($('faqsEnableListDividerColor').checked) {
        payload.list_item_divider_color = $('faqsListItemDividerColor').value;
      }

      return payload;
    };

    saveFaqsBtn.addEventListener('click', () => {
      const payload = gatherFaqsJson();
      const targetOrderVal = $('faqsTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'FAQS_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      faqsJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

  // ---- Products Tab Playground Logic ----
  const productsTabForm = $('products-tab-form');
  if (productsTabForm) {
    const saveProductsTabBtn = $('save-products-tab-btn');
    const productsTabJsonPreview = $('productsTabJsonPreview');

    wireNumberControl('productsTabPaddingMinus', 'productsTabPaddingPlus', 'productsTabPadding');
    wireNumberControl('productsTabTitleSizeMinus', 'productsTabTitleSizePlus', 'productsTabTitleFontSize');
    wireNumberControl('productsTabTabFontSizeMinus', 'productsTabTabFontSizePlus', 'productsTabTabFontSize');
    wireNumberControl('productsTabTabBorderRadiusMinus', 'productsTabTabBorderRadiusPlus', 'productsTabTabBorderRadius');
    wireNumberControl('productsTabUnderlineHeightMinus', 'productsTabUnderlineHeightPlus', 'productsTabUnderlineHeight');
    wireNumberControl('productsTabSpacingAfterMinus', 'productsTabSpacingAfterPlus', 'productsTabSpacingAfter');
    wireNumberControl('productsTabItemWidthMinus', 'productsTabItemWidthPlus', 'productsTabItemWidthDefault');
    wireNumberControl('productsTabGridColsMinus', 'productsTabGridColsPlus', 'productsTabGridCrossAxisCount');
    wireNumberControl('productsTabGridAspectMinus', 'productsTabGridAspectPlus', 'productsTabGridChildAspectRatio');
    wireNumberControl('productsTabDefaultMaxMinus', 'productsTabDefaultMaxPlus', 'productsTabDefaultMaxItems');
    wireNumberControl('productsTabCtaBorderRadiusMinus', 'productsTabCtaBorderRadiusPlus', 'productsTabCtaBorderRadius');

    const gatherProductsTabJson = () => {
      const payload = {};

      payload.display = $('productsTabDisplay').checked;
      payload.show_header = $('productsTabShowHeader').checked;
      payload.tabs_scrollable = $('productsTabTabsScrollable').checked;
      payload.fetch_on_select = $('productsTabFetchOnSelect').checked;

      // Container
      const padding = parseFloat($('productsTabPadding').value);
      if (!isNaN(padding)) payload.padding = padding;

      if ($('productsTabEnableBgColor').checked) payload.bg_color = $('productsTabBgColor').value;

      // Header
      const headerLayout = $('productsTabHeaderLayout').value;
      if (headerLayout) payload.header_layout = headerLayout;

      const titleFontSize = parseFloat($('productsTabTitleFontSize').value);
      if (!isNaN(titleFontSize)) payload.title_font_size = titleFontSize;

      const titleFontWeight = $('productsTabTitleFontWeight').value;
      if (titleFontWeight) payload.title_font_weight = titleFontWeight;

      if ($('productsTabEnableTitleColor').checked) payload.title_color = $('productsTabTitleColor').value;

      // Tabs
      const tabsStyle = $('productsTabTabsStyle').value;
      if (tabsStyle) payload.tabs_style = tabsStyle;

      const tabFontSize = parseFloat($('productsTabTabFontSize').value);
      if (!isNaN(tabFontSize)) payload.tab_font_size = tabFontSize;

      const tabBorderRadius = parseFloat($('productsTabTabBorderRadius').value);
      if (!isNaN(tabBorderRadius)) payload.tab_border_radius = tabBorderRadius;

      if ($('productsTabEnableActiveColor').checked) payload.tab_active_color = $('productsTabActiveColor').value;

      const underlineHeight = parseFloat($('productsTabUnderlineHeight').value);
      if (!isNaN(underlineHeight)) payload.underline_height = underlineHeight;

      const spacingAfter = parseFloat($('productsTabSpacingAfter').value);
      if (!isNaN(spacingAfter)) payload.tabs_spacing_after = spacingAfter;

      // List
      const listMode = $('productsTabListMode').value;
      if (listMode) payload.list_mode = listMode;

      const itemWidthDefault = parseFloat($('productsTabItemWidthDefault').value);
      if (!isNaN(itemWidthDefault)) payload.item_width_default = itemWidthDefault;

      const gridCols = parseInt($('productsTabGridCrossAxisCount').value, 10);
      if (!isNaN(gridCols)) payload.grid_cross_axis_count = gridCols;

      const gridAspect = parseFloat($('productsTabGridChildAspectRatio').value);
      if (!isNaN(gridAspect) && gridAspect > 0) payload.grid_child_aspect_ratio = gridAspect;

      const defaultMax = parseInt($('productsTabDefaultMaxItems').value, 10);
      if (!isNaN(defaultMax)) payload.default_max_items = defaultMax;

      // CTA
      const ctaPosition = $('productsTabCtaPosition').value;
      if (ctaPosition) payload.cta_position = ctaPosition;

      if ($('productsTabEnableCtaBgColor').checked) payload.cta_bg_color = $('productsTabCtaBgColor').value;
      if ($('productsTabEnableCtaTextColor').checked) payload.cta_text_color = $('productsTabCtaTextColor').value;

      const ctaBorderRadius = parseFloat($('productsTabCtaBorderRadius').value);
      if (!isNaN(ctaBorderRadius)) payload.cta_border_radius = ctaBorderRadius;

      return payload;
    };

    saveProductsTabBtn.addEventListener('click', () => {
      const payload = gatherProductsTabJson();
      const targetOrderVal = $('productsTabTargetOrder').value;
      const targetOrder = targetOrderVal === '' ? null : parseInt(targetOrderVal, 10);

      const message = {
        type: 'PRODUCTS_TAB_PROPERTIES_OVERRIDE',
        targetOrder: targetOrder,
        payload: payload,
      };

      productsTabJsonPreview.textContent = JSON.stringify(message, null, 2);
      sendUpdate(message);
    });
  }

})();
