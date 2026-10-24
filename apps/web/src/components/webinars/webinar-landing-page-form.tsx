'use client'

import { useMemo, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import { getApiBase } from '@/lib/api-base'
import { webinarApi, type Webinar, type WebinarLandingPage } from '@/lib/api'

export default function WebinarLandingPageForm({ webinar }: { webinar: Webinar }) {
  const [page, setPage] = useState<WebinarLandingPage>(webinar.landingPage ?? {
    enabled: true,
    heroImageUrl: null,
    eyebrow: 'ONLINE WEBINAR',
    headline: webinar.title,
    description: 'LINEから参加予約できます。',
    benefits: [],
    instructorName: '',
    instructorBio: '',
    notice: '',
    ctaLabel: 'LINEで参加予約する',
    accentColor: '#06c755',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const benefits = useMemo(() => [...page.benefits, '', '', ''].slice(0, 3), [page.benefits])
  const imageValue: ImageUploaderValue | null = page.heroImageUrl
    ? { mode: 'url', url: page.heroImageUrl }
    : null
  const publicUrl = `${getApiBase() ?? ''}/lp/webinar/${encodeURIComponent(webinar.slug)}`

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const landingPage = { ...page, benefits: benefits.map((item) => item.trim()).filter(Boolean) }
      await webinarApi.update(webinar.id, { landingPage })
      setPage(landingPage)
      setMessage('外部LPを保存しました')
    } catch (error) {
      setMessage(`保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
      <div className="space-y-5">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="font-bold text-slate-900">外部LPの内容</h2>
            <p className="mt-1 text-xs text-slate-500">外部ブラウザーで表示し、LINEの予約画面へ案内します。</p>
          </div>
          <Checkbox
            label="外部LPを公開する"
            checked={page.enabled}
            onCheckedChange={(enabled) => setPage((prev) => ({ ...prev, enabled }))}
          />
          <ImageUploader
            mode="url"
            label="メイン画像"
            value={imageValue}
            onChange={(value) => setPage((prev) => ({
              ...prev,
              heroImageUrl: value?.mode === 'url' ? value.url : null,
            }))}
          />
          <Input label="上部ラベル" value={page.eyebrow} maxLength={60} onChange={(e) => setPage((prev) => ({ ...prev, eyebrow: e.target.value }))} />
          <Input label="キャッチコピー" value={page.headline} maxLength={120} onChange={(e) => setPage((prev) => ({ ...prev, headline: e.target.value }))} />
          <InputArea label="説明文" value={page.description} maxLength={2000} rows={5} onChange={(e) => setPage((prev) => ({ ...prev, description: e.target.value }))} />
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-bold text-slate-900">参加メリット</h2>
          {benefits.map((benefit, index) => (
            <Input
              key={index}
              label={`メリット ${index + 1}`}
              value={benefit}
              maxLength={160}
              onChange={(e) => {
                const next = [...benefits]
                next[index] = e.target.value
                setPage((prev) => ({ ...prev, benefits: next }))
              }}
            />
          ))}
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-bold text-slate-900">講師・申込案内</h2>
          <Input label="講師名" value={page.instructorName} maxLength={80} onChange={(e) => setPage((prev) => ({ ...prev, instructorName: e.target.value }))} />
          <InputArea label="講師プロフィール" value={page.instructorBio} maxLength={1000} rows={4} onChange={(e) => setPage((prev) => ({ ...prev, instructorBio: e.target.value }))} />
          <InputArea label="注意事項" value={page.notice} maxLength={1000} rows={3} onChange={(e) => setPage((prev) => ({ ...prev, notice: e.target.value }))} />
          <Input label="申込ボタンの文言" value={page.ctaLabel} maxLength={40} onChange={(e) => setPage((prev) => ({ ...prev, ctaLabel: e.target.value }))} />
          <label className="block text-sm font-medium text-slate-700">
            アクセントカラー
            <input type="color" value={page.accentColor} onChange={(e) => setPage((prev) => ({ ...prev, accentColor: e.target.value }))} className="mt-2 block h-10 w-20 cursor-pointer rounded border border-slate-300" />
          </label>
        </section>

        <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <Button variant="primary" onClick={() => void save()} disabled={saving} loading={saving}>外部LPを保存</Button>
          {message && <span className="text-sm text-slate-600">{message}</span>}
        </div>
      </div>

      <aside className="xl:sticky xl:top-5 xl:self-start">
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#0f1b2d] text-white shadow-xl">
          <div className="border-b border-slate-700 px-5 py-3 text-xs font-bold text-slate-300">プレビュー</div>
          <div className="p-5 text-center">
            {page.heroImageUrl && <img src={page.heroImageUrl} alt="" className="mb-6 max-h-64 w-full rounded-2xl object-cover" />}
            <div className="text-xs font-bold tracking-widest" style={{ color: page.accentColor }}>{page.eyebrow}</div>
            <h1 className="my-4 text-3xl font-black leading-tight">{page.headline}</h1>
            <p className="whitespace-pre-line text-sm leading-7 text-slate-300">{page.description}</p>
            {benefits.some(Boolean) && (
              <ul className="mt-6 space-y-2 rounded-xl bg-slate-800 p-4 text-left text-sm">
                {benefits.filter(Boolean).map((benefit, index) => <li key={index}>✓ {benefit}</li>)}
              </ul>
            )}
            {(page.instructorName || page.instructorBio) && (
              <div className="mt-6 rounded-xl bg-slate-800 p-4 text-left">
                <div className="font-bold">{page.instructorName || '講師'}</div>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-300">{page.instructorBio}</p>
              </div>
            )}
            {page.notice && <p className="mt-5 whitespace-pre-line rounded-xl bg-slate-800 p-4 text-left text-xs text-slate-300">{page.notice}</p>}
            <div className="mt-7 rounded-full px-5 py-4 font-bold" style={{ backgroundColor: page.accentColor }}>{page.ctaLabel}</div>
          </div>
        </div>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-3 block text-center text-sm font-semibold text-emerald-700 underline">公開ページを別タブで確認</a>
      </aside>
    </div>
  )
}
