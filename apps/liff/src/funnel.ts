/**
 * LIFF Funnel Page — Multi-step evergreen launch funnel
 *
 * Flow: intro → quiz steps → form → offer/payment → done
 *
 * URL: ?page=funnel[&preset=evergreen_launch][&ref=xxx]
 *
 * Customise steps via VITE_FUNNEL_* env vars or edit the preset directly.
 * Each step type maps to a renderer. Quiz answers are stored in friend metadata.
 */

import { resolveOfferPreset } from './offers.js'

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>
  getIDToken(): string | null
  isInClient(): boolean
  closeWindow(): void
}

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787'
const UUID_STORAGE_KEY = 'lh_uuid'

// ─── Step types ───────────────────────────────────────────

interface IntroStep {
  type: 'intro'
  title: string
  body: string
  cta: string
}

interface QuizOption {
  label: string
  value: string
  next?: number // jump to step index (default: +1)
}

interface QuizStep {
  type: 'quiz'
  question: string
  fieldName: string // key saved to metadata
  options: QuizOption[]
}

interface FormStep {
  type: 'form'
  formId: string // existing LINE Harness form ID
}

interface OfferStep {
  type: 'offer'
  offerPreset: string
  offerVariantField?: string // quiz answer key used to select variant
}

interface DoneStep {
  type: 'done'
  title: string
  body: string
}

type FunnelStep = IntroStep | QuizStep | FormStep | OfferStep | DoneStep

interface FunnelConfig {
  title: string
  steps: FunnelStep[]
}

// ─── Presets ─────────────────────────────────────────────

function buildEvergreenPreset(): FunnelConfig {
  const title = import.meta.env?.VITE_FUNNEL_TITLE || 'LINE特典を受け取る'

  const q1: QuizStep = {
    type: 'quiz',
    question: import.meta.env?.VITE_FUNNEL_Q1 || '現在の状況を教えてください',
    fieldName: 'funnelQ1',
    options: parseOptions(
      import.meta.env?.VITE_FUNNEL_Q1_OPTIONS,
      [
        { label: '初心者・これから始める', value: 'beginner' },
        { label: 'ある程度やっているが伸び悩んでいる', value: 'intermediate' },
        { label: '月10万以上の実績あり', value: 'advanced' },
      ],
    ),
  }

  const formId = import.meta.env?.VITE_FUNNEL_FORM_ID || ''
  const hasForm = !!formId

  const steps: FunnelStep[] = [
    {
      type: 'intro',
      title: import.meta.env?.VITE_FUNNEL_INTRO_TITLE || '特典をお受け取りください',
      body:
        import.meta.env?.VITE_FUNNEL_INTRO_BODY ||
        'いくつかの質問にお答えいただくと、あなたに最適な特典をご案内します。',
      cta: import.meta.env?.VITE_FUNNEL_INTRO_CTA || 'スタート',
    },
    q1,
    {
      type: 'quiz',
      question: import.meta.env?.VITE_FUNNEL_Q2 || '一番の悩みは何ですか？',
      fieldName: 'funnelQ2',
      options: parseOptions(
        import.meta.env?.VITE_FUNNEL_Q2_OPTIONS,
        [
          { label: '何から始めればいいか分からない', value: 'direction' },
          { label: '時間がなかなか取れない', value: 'time' },
          { label: '結果が出るか不安', value: 'confidence' },
          { label: '仲間・コミュニティがない', value: 'community' },
        ],
      ),
    },
    ...(hasForm
      ? [{ type: 'form' as const, formId }]
      : []),
    {
      type: 'offer',
      offerPreset: 'evergreen_launch',
      offerVariantField: 'funnelQ1',
    },
    {
      type: 'done',
      title: 'ありがとうございます！',
      body:
        import.meta.env?.VITE_FUNNEL_DONE_BODY ||
        'ご登録が完了しました。\nLINEからご案内をお送りします。',
    },
  ]

  return { title, steps }
}

function parseOptions(raw: string | undefined, fallback: QuizOption[]): QuizOption[] {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as QuizOption[]
  } catch {
    return fallback
  }
}

const PRESETS: Record<string, () => FunnelConfig> = {
  evergreen_launch: buildEvergreenPreset,
}

// ─── State ───────────────────────────────────────────────

interface FunnelState {
  config: FunnelConfig
  stepIndex: number
  quizAnswers: Record<string, string>
  profile: { userId: string; displayName: string; pictureUrl?: string } | null
  friendId: string | null
  checkoutUrl: string | null
}

let state: FunnelState

function escapeHtml(s: string): string {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function apiCall(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
}

// ─── Progress bar ─────────────────────────────────────────

function renderProgress(): string {
  const total = state.config.steps.length
  const pct = Math.round((state.stepIndex / total) * 100)
  return `
    <div class="funnel-progress">
      <div class="funnel-progress-bar" style="width:${pct}%"></div>
    </div>
    <p class="funnel-step-label">${state.stepIndex + 1} / ${total}</p>
  `
}

// ─── Step renderers ───────────────────────────────────────

function renderIntro(step: IntroStep): void {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="funnel-wrap">
      ${renderProgress()}
      <div class="funnel-card">
        <h1 class="funnel-title">${escapeHtml(step.title)}</h1>
        <p class="funnel-body">${escapeHtml(step.body)}</p>
        <button class="funnel-btn" id="funnelNext">${escapeHtml(step.cta)}</button>
      </div>
    </div>
  `
  document.getElementById('funnelNext')!.onclick = () => nextStep()
}

function renderQuiz(step: QuizStep): void {
  const app = document.getElementById('app')!
  const opts = step.options
    .map(
      (o, i) =>
        `<button class="funnel-option" data-value="${escapeHtml(o.value)}" data-next="${o.next ?? ''}" data-index="${i}">
          ${escapeHtml(o.label)}
        </button>`,
    )
    .join('')

  app.innerHTML = `
    <div class="funnel-wrap">
      ${renderProgress()}
      <div class="funnel-card">
        <p class="funnel-question">${escapeHtml(step.question)}</p>
        <div class="funnel-options">${opts}</div>
      </div>
    </div>
  `

  app.querySelectorAll('.funnel-option').forEach((btn) => {
    ;(btn as HTMLButtonElement).onclick = () => {
      const value = btn.getAttribute('data-value')!
      const nextStr = btn.getAttribute('data-next')
      state.quizAnswers[step.fieldName] = value

      if (nextStr) {
        state.stepIndex = parseInt(nextStr, 10)
        renderStep()
      } else {
        nextStep()
      }
    }
  })
}

async function renderForm(step: FormStep): Promise<void> {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="funnel-wrap">
      ${renderProgress()}
      <div class="funnel-card">
        <div class="loading-spinner"></div>
        <p class="message">読み込み中...</p>
      </div>
    </div>
  `

  try {
    const res = await apiCall(`/api/forms/${step.formId}`)
    if (!res.ok) throw new Error('フォームの取得に失敗しました')
    const json = await res.json() as {
      success: boolean
      data: { fields: Array<{ name: string; label: string; type: string; required?: boolean; options?: string[]; placeholder?: string }> }
    }
    const fields = json.data.fields

    const fieldHtml = fields
      .map((f) => {
        const label = `<label class="funnel-label">${escapeHtml(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`
        if (f.type === 'select') {
          const opts = (f.options ?? []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')
          return `<div class="funnel-field">${label}<select name="${escapeHtml(f.name)}" class="funnel-input"${f.required ? ' required' : ''}><option value="">選択してください</option>${opts}</select></div>`
        }
        if (f.type === 'textarea') {
          return `<div class="funnel-field">${label}<textarea name="${escapeHtml(f.name)}" class="funnel-input" rows="3" placeholder="${escapeHtml(f.placeholder ?? '')}"${f.required ? ' required' : ''}></textarea></div>`
        }
        if (f.type === 'radio' && f.options) {
          const radios = f.options.map((o) => `<label class="radio-label"><input type="radio" name="${escapeHtml(f.name)}" value="${escapeHtml(o)}"${f.required ? ' required' : ''}> ${escapeHtml(o)}</label>`).join('')
          return `<div class="funnel-field">${label}<div class="radio-group">${radios}</div></div>`
        }
        return `<div class="funnel-field">${label}<input type="${escapeHtml(f.type)}" name="${escapeHtml(f.name)}" class="funnel-input" placeholder="${escapeHtml(f.placeholder ?? '')}"${f.required ? ' required' : ''}></div>`
      })
      .join('')

    app.innerHTML = `
      <div class="funnel-wrap">
        ${renderProgress()}
        <div class="funnel-card">
          <form id="funnelForm">
            ${fieldHtml}
            <button type="submit" class="funnel-btn" id="funnelSubmit">送信して次へ</button>
            <p class="funnel-error" id="funnelFormError" style="display:none"></p>
          </form>
        </div>
      </div>
    `

    document.getElementById('funnelForm')!.onsubmit = async (e) => {
      e.preventDefault()
      const submitBtn = document.getElementById('funnelSubmit') as HTMLButtonElement
      submitBtn.disabled = true
      submitBtn.textContent = '送信中...'

      const formData = new FormData(e.target as HTMLFormElement)
      const answers: Record<string, string> = {}
      formData.forEach((v, k) => { answers[k] = v as string })

      // Merge quiz answers
      const allAnswers = { ...state.quizAnswers, ...answers }

      try {
        const submitRes = await apiCall(`/api/forms/${step.formId}/submit`, {
          method: 'POST',
          body: JSON.stringify({
            answers: allAnswers,
            lineUserId: state.profile?.userId,
            friendId: state.friendId,
            metadata: state.quizAnswers,
          }),
        })
        if (!submitRes.ok) throw new Error('送信に失敗しました')
        nextStep()
      } catch (err) {
        const errEl = document.getElementById('funnelFormError')!
        errEl.textContent = err instanceof Error ? err.message : '送信エラー'
        errEl.style.display = 'block'
        submitBtn.disabled = false
        submitBtn.textContent = '送信して次へ'
      }
    }
  } catch (err) {
    app.innerHTML = `<div class="funnel-wrap"><div class="funnel-card"><p class="funnel-error">${escapeHtml(err instanceof Error ? err.message : 'エラー')}</p></div></div>`
  }
}

async function renderOffer(step: OfferStep): Promise<void> {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="funnel-wrap">
      ${renderProgress()}
      <div class="funnel-card">
        <div class="loading-spinner"></div>
        <p class="message">最適なプランを準備中...</p>
      </div>
    </div>
  `

  try {
    const variantValue = step.offerVariantField
      ? state.quizAnswers[step.offerVariantField]
      : undefined

    const offer = resolveOfferPreset(step.offerPreset, variantValue)

    if (!offer) {
      nextStep()
      return
    }

    // Create Stripe Checkout Session
    const checkoutRes = await apiCall('/api/integrations/stripe/checkout-sessions', {
      method: 'POST',
      body: JSON.stringify({
        priceId: offer.priceId,
        productId: offer.productId,
        offerId: offer.offerId,
        lineHarnessFriendId: state.friendId,
        successUrl: window.location.href + '&stripe=success',
        cancelUrl: window.location.href,
        metadata: {
          ...state.quizAnswers,
          lineHarnessFriendId: state.friendId,
          offerPreset: step.offerPreset,
          offerVariant: variantValue ?? '',
        },
      }),
    })

    if (checkoutRes.ok) {
      const data = await checkoutRes.json() as { success: boolean; data?: { url: string } }
      if (data.data?.url) {
        state.checkoutUrl = data.data.url
      }
    }

    const offerName = import.meta.env?.VITE_FUNNEL_OFFER_NAME || '特別オファー'
    const offerDesc = import.meta.env?.VITE_FUNNEL_OFFER_DESC || ''
    const offerPrice = import.meta.env?.VITE_FUNNEL_OFFER_PRICE || ''
    const offerCta = import.meta.env?.VITE_FUNNEL_OFFER_CTA || '今すぐ申し込む'

    app.innerHTML = `
      <div class="funnel-wrap">
        ${renderProgress()}
        <div class="funnel-card">
          <div class="offer-badge">あなたへのご提案</div>
          <h2 class="offer-title">${escapeHtml(offerName)}</h2>
          ${offerDesc ? `<p class="offer-desc">${escapeHtml(offerDesc)}</p>` : ''}
          ${offerPrice ? `<p class="offer-price">${escapeHtml(offerPrice)}</p>` : ''}
          ${
            state.checkoutUrl
              ? `<a href="${state.checkoutUrl}" class="funnel-btn funnel-btn-cta">${escapeHtml(offerCta)}</a>
                 <button class="funnel-btn funnel-btn-skip" id="funnelSkip">後で検討する</button>`
              : `<button class="funnel-btn" id="funnelNext">次へ進む</button>`
          }
        </div>
      </div>
    `
    document.getElementById('funnelSkip')?.addEventListener('click', () => nextStep())
    document.getElementById('funnelNext')?.addEventListener('click', () => nextStep())

    // If returning from Stripe success
    const params = new URLSearchParams(window.location.search)
    if (params.get('stripe') === 'success') {
      nextStep()
    }
  } catch {
    nextStep()
  }
}

function renderDone(step: DoneStep): void {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="funnel-wrap">
      <div class="funnel-card" style="text-align:center">
        <div class="check-icon">✓</div>
        <h2 style="color:#06C755;margin-bottom:12px">${escapeHtml(step.title)}</h2>
        <p class="funnel-body">${escapeHtml(step.body)}</p>
        ${liff.isInClient() ? '<button class="funnel-btn" id="funnelClose">閉じる</button>' : ''}
      </div>
    </div>
  `
  document.getElementById('funnelClose')?.addEventListener('click', () => {
    try { liff.closeWindow() } catch { /* ignore */ }
  })

  // Save quiz answers to metadata
  if (state.friendId && Object.keys(state.quizAnswers).length > 0) {
    apiCall(`/api/friends/${state.friendId}/metadata`, {
      method: 'PUT',
      body: JSON.stringify(state.quizAnswers),
    }).catch(() => {})
  }
}

// ─── Step engine ──────────────────────────────────────────

async function renderStep(): Promise<void> {
  const step = state.config.steps[state.stepIndex]
  if (!step) return

  switch (step.type) {
    case 'intro':
      renderIntro(step)
      break
    case 'quiz':
      renderQuiz(step)
      break
    case 'form':
      await renderForm(step)
      break
    case 'offer':
      await renderOffer(step)
      break
    case 'done':
      renderDone(step)
      break
  }
}

function nextStep(): void {
  state.stepIndex++
  if (state.stepIndex >= state.config.steps.length) {
    // Past end — render last done step or close
    try { liff.closeWindow() } catch { /* ignore */ }
    return
  }
  renderStep()
}

// ─── Entry ────────────────────────────────────────────────

export async function initFunnel(): Promise<void> {
  const app = document.getElementById('app')!
  const params = new URLSearchParams(window.location.search)
  const presetName = params.get('preset') || 'evergreen_launch'
  const ref = params.get('ref')

  const buildPreset = PRESETS[presetName] ?? PRESETS['evergreen_launch']
  const config = buildPreset()

  try {
    const profile = await liff.getProfile()
    const idToken = liff.getIDToken()
    const existingUuid = (() => {
      try { return localStorage.getItem(UUID_STORAGE_KEY) } catch { return null }
    })()

    // Link user and get friendId
    let friendId: string | null = null
    try {
      const linkRes = await apiCall('/api/liff/link', {
        method: 'POST',
        body: JSON.stringify({ idToken, displayName: profile.displayName, existingUuid, ref }),
      })
      if (linkRes.ok) {
        const data = await linkRes.json() as { success: boolean; data?: { friendId?: string; userId?: string } }
        friendId = data.data?.friendId ?? null
        const uuid = data.data?.userId
        if (uuid) {
          try { localStorage.setItem(UUID_STORAGE_KEY, uuid) } catch { /* ignore */ }
        }
      }
    } catch { /* silent */ }

    // Attribution
    if (ref) {
      apiCall('/api/affiliates/click', {
        method: 'POST',
        body: JSON.stringify({ code: ref, url: window.location.href }),
      }).catch(() => {})
    }

    state = { config, stepIndex: 0, quizAnswers: {}, profile, friendId, checkoutUrl: null }
    await renderStep()
  } catch (err) {
    app.innerHTML = `<div class="funnel-wrap"><div class="funnel-card"><p class="funnel-error">${err instanceof Error ? escapeHtml(err.message) : 'エラーが発生しました'}</p></div></div>`
  }
}
