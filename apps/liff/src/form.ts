/**
 * LIFF Form Page — Dynamic form renderer for LINE surveys / questionnaires
 *
 * Flow:
 * 1. Fetch form definition from API using form ID from query params
 * 2. Render form fields dynamically (text, email, select, radio, etc.)
 * 3. On submit: POST to /api/forms/:id/submit with user's lineUserId
 * 4. Show success message (auto-close in LINE app)
 *
 * URL format: https://liff.line.me/{LIFF_ID}?page=form&id={FORM_ID}
 */

import { resolveOfferPreset } from './offers.js';

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';
const UUID_STORAGE_KEY = 'lh_uuid';

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
}

interface FormState {
  formDef: FormDef | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  submitting: boolean;
  checkoutUrl: string | null;
  checkoutError: string | null;
}

const state: FormState = {
  formDef: null,
  profile: null,
  friendId: null,
  submitting: false,
  checkoutUrl: null,
  checkoutError: null,
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

interface CheckoutConfig {
  priceId: string;
  productId: string;
  offerId: string;
  refCode: string;
  successUrl: string;
  cancelUrl: string;
  stripeCustomerId?: string;
  mode?: 'payment' | 'subscription';
  campaignId?: string;
  entryScenarioId?: string;
  entryFormId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

function getCheckoutConfig(formId: string): CheckoutConfig | null {
  const params = new URLSearchParams(window.location.search);
  const priceId = params.get('priceId');
  const productId = params.get('productId');
  const offerId = params.get('offerId');
  const explicitConfig = priceId && productId && offerId
    ? {
        priceId,
        productId,
        offerId,
        mode: (params.get('mode') === 'subscription' ? 'subscription' : 'payment') as 'payment' | 'subscription',
      }
    : null;

  const presetName = params.get('offerPreset');
  const presetVariant = params.get('offerVariant');
  const presetConfig = resolveOfferPreset(presetName, presetVariant);
  const offerConfig = explicitConfig ?? presetConfig;

  if (!offerConfig) {
    return null;
  }

  const refCode = params.get('ref') || 'direct';
  const successUrl = params.get('successUrl') || `${window.location.origin}/thank-you`;
  const cancelUrl = params.get('cancelUrl') || window.location.href;

  return {
    priceId: offerConfig.priceId,
    productId: offerConfig.productId,
    offerId: offerConfig.offerId,
    refCode,
    successUrl,
    cancelUrl,
    stripeCustomerId: params.get('stripeCustomerId') || undefined,
    mode: offerConfig.mode ?? 'payment',
    campaignId: params.get('campaignId') || undefined,
    entryScenarioId: params.get('entryScenarioId') || undefined,
    entryFormId: params.get('entryFormId') || formId,
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
    utmContent: params.get('utm_content') || undefined,
  };
}

function extractEmailFromFormData(data: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue;
    if (key.toLowerCase().includes('mail') || key.toLowerCase().includes('email')) {
      if (value.trim()) return value.trim();
    }
  }
  return undefined;
}

function resolveVariantFromFormData(data: Record<string, unknown>): string | null {
  const params = new URLSearchParams(window.location.search);
  const variantField = params.get('offerVariantField');
  if (!variantField) return params.get('offerVariant');

  const rawValue = data[variantField];
  if (typeof rawValue === 'string' && rawValue.trim()) {
    return rawValue.trim();
  }
  if (Array.isArray(rawValue) && rawValue.length > 0 && typeof rawValue[0] === 'string') {
    return rawValue[0];
  }
  return params.get('offerVariant');
}

// ========== Field Rendering ==========

function renderField(field: FormField): string {
  const required = field.required ? ' required' : '';
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const requiredMark = field.required ? '<span class="required-mark">*</span>' : '';

  let inputHtml = '';

  switch (field.type) {
    case 'textarea':
      inputHtml = `<textarea
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-textarea"
        rows="4"
        ${placeholder}${required}></textarea>`;
      break;

    case 'select': {
      const opts = (field.options ?? [])
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join('');
      inputHtml = `<select
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-select"${required}>
        <option value="">選択してください</option>
        ${opts}
      </select>`;
      break;
    }

    case 'radio': {
      const radios = (field.options ?? [])
        .map(
          (o) =>
            `<label class="radio-label">
              <input type="radio" name="${escapeHtml(field.name)}" value="${escapeHtml(o)}"${required} />
              ${escapeHtml(o)}
            </label>`,
        )
        .join('');
      inputHtml = `<div class="radio-group">${radios}</div>`;
      break;
    }

    case 'checkbox': {
      const boxes = (field.options ?? [])
        .map(
          (o) =>
            `<label class="checkbox-label">
              <input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(o)}" />
              ${escapeHtml(o)}
            </label>`,
        )
        .join('');
      inputHtml = `<div class="checkbox-group">${boxes}</div>`;
      break;
    }

    default:
      inputHtml = `<input
        type="${escapeHtml(field.type)}"
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-input"
        ${placeholder}${required} />`;
      break;
  }

  return `
    <div class="form-field">
      <label class="form-label" for="field-${escapeHtml(field.name)}">
        ${escapeHtml(field.label)}${requiredMark}
      </label>
      ${inputHtml}
    </div>
  `;
}

// ========== Styles ==========

function injectStyles(): void {
  if (document.getElementById('form-styles')) return;
  const style = document.createElement('style');
  style.id = 'form-styles';
  style.textContent = `
    .form-page { max-width: 480px; margin: 0 auto; padding: 16px; }
    .form-header { text-align: center; margin-bottom: 24px; }
    .form-header h1 { font-size: 20px; color: #333; margin-bottom: 8px; }
    .form-description { font-size: 14px; color: #999; }
    .form-profile { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; }
    .form-profile img { width: 36px; height: 36px; border-radius: 50%; }
    .form-profile span { font-size: 14px; font-weight: 600; }
    .form-body { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .form-field { margin-bottom: 20px; }
    .form-label { display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 6px; }
    .required-mark { color: #e53e3e; margin-left: 2px; }
    .form-input, .form-textarea, .form-select {
      width: 100%; padding: 12px; border: 1.5px solid #e0e0e0; border-radius: 8px;
      font-size: 16px; font-family: inherit; background: #fafafa;
      transition: border-color 0.15s; box-sizing: border-box;
      -webkit-appearance: none;
    }
    .form-input:focus, .form-textarea:focus, .form-select:focus {
      outline: none; border-color: #06C755; background: #fff;
    }
    .form-textarea { resize: vertical; min-height: 80px; }
    .form-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
    .radio-group, .checkbox-group { display: flex; flex-direction: column; gap: 10px; }
    .radio-label, .checkbox-label {
      display: flex; align-items: center; gap: 8px; font-size: 15px; color: #333;
      padding: 10px 12px; background: #fafafa; border-radius: 8px; border: 1.5px solid #e0e0e0;
      cursor: pointer; transition: border-color 0.15s;
    }
    .radio-label:has(input:checked), .checkbox-label:has(input:checked) {
      border-color: #06C755; background: #e8faf0;
    }
    .radio-label input, .checkbox-label input { accent-color: #06C755; width: 18px; height: 18px; }
    .radio-label input[type="radio"] { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; border: 2px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
    .radio-label input[type="radio"]:checked { background: #06C755; border-color: #06C755; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3E%3C/svg%3E"); background-size: 14px; background-position: center; background-repeat: no-repeat; }
    .submit-btn {
      width: 100%; padding: 14px; border: none; border-radius: 8px;
      background: #06C755; color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; font-family: inherit; margin-top: 8px; transition: opacity 0.15s;
    }
    .submit-btn:active { opacity: 0.85; }
    .submit-btn:disabled { background: #bbb; cursor: not-allowed; }
    .form-error { color: #e53e3e; font-size: 12px; margin-top: 4px; }
     .form-success { text-align: center; padding: 40px 20px; }
     .form-success .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
     .form-success h2 { font-size: 20px; color: #06C755; margin-bottom: 12px; }
     .form-success p { font-size: 14px; color: #666; line-height: 1.6; }
     .success-card { background: #fff; border-radius: 16px; padding: 28px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }
     .success-icon { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
     .success-message { font-size: 14px; color: #666; line-height: 1.6; margin-bottom: 16px; }
     .checkout-message { font-size: 13px; color: #4b5563; line-height: 1.6; margin: 12px 0 16px; }
     .checkout-btn, .close-btn {
       display: block; width: 100%; padding: 14px; border: none; border-radius: 8px;
       background: #06C755; color: #fff; font-size: 16px; font-weight: 700; text-decoration: none;
       cursor: pointer; font-family: inherit; margin-top: 10px; transition: opacity 0.15s;
     }
     .checkout-btn.secondary, .close-btn.secondary { background: #e5e7eb; color: #111827; }
     .checkout-btn:active, .close-btn:active { opacity: 0.85; }
   `;
  document.head.appendChild(style);
}

// ========== Main Render ==========

function render(): void {
  const { formDef, profile } = state;
  if (!formDef) return;

  injectStyles();
  const app = getApp();
  const profileHtml = profile?.pictureUrl
    ? `<div class="form-profile">
        <img src="${profile.pictureUrl}" alt="" />
        <span>${escapeHtml(profile.displayName)} さん</span>
      </div>`
    : '';

  const fieldsHtml = formDef.fields.map(renderField).join('');

  app.innerHTML = `
    <div class="form-page">
      <div class="form-header">
        <h1>${escapeHtml(formDef.name)}</h1>
        ${formDef.description ? `<p class="form-description">${escapeHtml(formDef.description)}</p>` : ''}
        ${profileHtml}
      </div>
      <form id="liff-form" class="form-body" novalidate>
        ${fieldsHtml}
        <button type="submit" class="submit-btn" id="submitBtn">送信する</button>
      </form>
    </div>
  `;

  attachFormEvents();
}

function renderSuccess(): void {
  const app = getApp();
  const checkoutBlock = state.checkoutUrl
    ? `
      <p class="checkout-message">このままお申し込み手続きへ進めます。</p>
      <a class="checkout-btn" id="checkoutBtn" href="${escapeHtml(state.checkoutUrl)}">決済へ進む</a>
      <button class="close-btn secondary" id="closeBtn" type="button">あとで閉じる</button>
    `
    : `
      <button class="close-btn" id="closeBtn" type="button">閉じる</button>
    `;
  const checkoutErrorHtml = state.checkoutError
    ? `<p class="checkout-message" style="color:#b45309;">${escapeHtml(state.checkoutError)}</p>`
    : '';
  app.innerHTML = `
    <div class="form-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>送信完了！</h2>
        <p class="success-message">ご回答ありがとうございました。</p>
        ${checkoutErrorHtml}
        ${checkoutBlock}
      </div>
    </div>
  `;

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });

  // Auto-close after 3s inside LINE
  if (liff.isInClient()) {
    if (!state.checkoutUrl) {
      setTimeout(() => {
        try { liff.closeWindow(); } catch { /* ignore */ }
      }, 3000);
    }
  }
}

async function createCheckoutSession(data: Record<string, unknown>): Promise<string | null> {
  if (!state.formDef || !state.profile) return null;

  const params = new URLSearchParams(window.location.search);
  const presetName = params.get('offerPreset');
  const variantFromData = resolveVariantFromFormData(data);
  const fallbackConfig = getCheckoutConfig(state.formDef.id);
  const presetConfig = presetName ? resolveOfferPreset(presetName, variantFromData) : null;
  const config = presetConfig && fallbackConfig
    ? { ...fallbackConfig, ...presetConfig }
    : presetConfig
      ? {
          ...fallbackConfig,
          ...presetConfig,
          refCode: fallbackConfig?.refCode ?? (params.get('ref') || 'direct'),
          successUrl: fallbackConfig?.successUrl ?? (params.get('successUrl') || `${window.location.origin}/thank-you`),
          cancelUrl: fallbackConfig?.cancelUrl ?? (params.get('cancelUrl') || window.location.href),
          stripeCustomerId: fallbackConfig?.stripeCustomerId,
          campaignId: fallbackConfig?.campaignId,
          entryScenarioId: fallbackConfig?.entryScenarioId,
          entryFormId: fallbackConfig?.entryFormId ?? state.formDef.id,
          utmSource: fallbackConfig?.utmSource,
          utmMedium: fallbackConfig?.utmMedium,
          utmCampaign: fallbackConfig?.utmCampaign,
          utmContent: fallbackConfig?.utmContent,
        }
      : fallbackConfig;

  if (!config) return null;

  const response = await apiCall('/api/integrations/stripe/checkout-sessions', {
    method: 'POST',
    body: JSON.stringify({
      ...config,
      lineUserId: state.profile.userId,
      stripeCustomerId: config.stripeCustomerId,
      customerEmail: extractEmailFromFormData(data),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || '決済URLの作成に失敗しました');
  }

  const json = await response.json() as {
    success: boolean;
    data?: { url?: string };
    error?: string;
  };

  if (!json.success || !json.data?.url) {
    throw new Error(json.error || '決済URLの作成に失敗しました');
  }

  return json.data.url;
}

function renderFormError(message: string): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card">
        <h2 style="color: #e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function renderLoading(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card" style="text-align:center;padding:40px 20px;">
        <div class="loading-spinner"></div>
        <p style="margin-top:12px;color:#718096;">読み込み中...</p>
      </div>
    </div>
  `;
}

// ========== Form Submission ==========

function collectFormData(): Record<string, unknown> {
  const { formDef } = state;
  if (!formDef) return {};

  const result: Record<string, unknown> = {};

  for (const field of formDef.fields) {
    if (field.type === 'checkbox') {
      const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `input[name="${field.name}"]:checked`,
        ),
      ).map((el) => el.value);
      result[field.name] = checked;
    } else if (field.type === 'radio') {
      const checked = document.querySelector<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      result[field.name] = checked?.value ?? '';
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${field.name}"]`,
      );
      result[field.name] = el?.value ?? '';
    }
  }

  return result;
}

function validateForm(): string | null {
  const { formDef } = state;
  if (!formDef) return null;

  for (const field of formDef.fields) {
    if (!field.required) continue;

    if (field.type === 'checkbox') {
      const checked = document.querySelectorAll<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      if (checked.length === 0) return `${field.label} は必須項目です`;
    } else if (field.type === 'radio') {
      const checked = document.querySelector<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      if (!checked) return `${field.label} は必須項目です`;
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${field.name}"]`,
      );
      if (!el || !el.value.trim()) return `${field.label} は必須項目です`;
    }
  }

  return null;
}

async function submitForm(): Promise<void> {
  if (state.submitting || !state.formDef) return;

  const validationError = validateForm();
  if (validationError) {
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
    errEl.textContent = validationError;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn?.parentElement?.insertBefore(errEl, submitBtn);
    return;
  }

  state.submitting = true;
  const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';
  }

  try {
    const data = collectFormData();
    state.checkoutUrl = null;
    state.checkoutError = null;
    console.log('Form data collected:', JSON.stringify(data));
    const body: Record<string, unknown> = { data };
    if (state.profile?.userId) body.lineUserId = state.profile.userId;
    // Note: state.friendId is users.id (UUID), not friends.id — don't send as friendId
    console.log('Submitting to:', `${API_URL}/api/forms/${state.formDef.id}/submit`);

    const res = await apiCall(`/api/forms/${state.formDef.id}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    console.log('Response status:', res.status);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = '送信に失敗しました';
      try { const errData = JSON.parse(errText); errMsg = errData.error || errMsg; } catch { errMsg = errText || errMsg; }
      throw new Error(`${res.status}: ${errMsg}`);
    }

    try {
      state.checkoutUrl = await createCheckoutSession(data);
    } catch (checkoutError) {
      state.checkoutUrl = null;
      state.checkoutError = checkoutError instanceof Error
        ? `決済URLの作成に失敗しました。あとでご案内します。 (${checkoutError.message})`
        : '決済URLの作成に失敗しました。あとでご案内します。';
    }
    renderSuccess();
  } catch (err) {
    state.submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '送信する';
    }
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
    errEl.textContent = err instanceof Error ? err.message : '送信に失敗しました';
    const btn = document.getElementById('submitBtn');
    btn?.parentElement?.insertBefore(errEl, btn);
  }
}

function attachFormEvents(): void {
  const form = document.getElementById('liff-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitForm();
  });
}

// ========== Init ==========

export async function initForm(formId: string | null): Promise<void> {
  if (!formId) {
    renderFormError('フォームIDが指定されていません');
    return;
  }

  renderLoading();

  try {
    // Fetch profile and form definition in parallel
    const [profile, res] = await Promise.all([
      liff.getProfile(),
      apiCall(`/api/forms/${formId}`),
    ]);

    state.profile = profile;

    // Try to get friendId from local storage (set by main UUID linking flow)
    try {
      state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
    } catch {
      // silent
    }

    // Silent UUID linking (best-effort, so friend metadata saves correctly)
    const rawIdToken = liff.getIDToken();
    if (rawIdToken) {
      apiCall('/api/liff/link', {
        method: 'POST',
        body: JSON.stringify({
          idToken: rawIdToken,
          displayName: profile.displayName,
          existingUuid: state.friendId,
        }),
      }).then(async (linkRes) => {
        if (linkRes.ok) {
          const data = await linkRes.json() as { success: boolean; data?: { userId?: string } };
          if (data?.data?.userId) {
            try {
              localStorage.setItem(UUID_STORAGE_KEY, data.data.userId);
              state.friendId = data.data.userId;
            } catch { /* silent */ }
          }
        }
      }).catch(() => { /* silent */ });
    }

    if (!res.ok) {
      if (res.status === 404) {
        renderFormError('フォームが見つかりません');
      } else {
        renderFormError('フォームの読み込みに失敗しました');
      }
      return;
    }

    const json = await res.json() as { success: boolean; data?: FormDef };
    if (!json.success || !json.data) {
      renderFormError('フォームの読み込みに失敗しました');
      return;
    }

    if (!json.data.isActive) {
      renderFormError('このフォームは現在受付を停止しています');
      return;
    }

    state.formDef = json.data;
    render();
  } catch (err) {
    renderFormError(err instanceof Error ? err.message : 'エラーが発生しました');
  }
}
