'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import { getApiBase } from '@/lib/api-base'
import { webinarApi, type Webinar, type WebinarLandingPage, type WebinarLandingSection } from '@/lib/api'
import { mergeGeneratedLandingPage } from './webinar-landing-page-generation'

const SECTIONS: { id: WebinarLandingSection; label: string }[] = [
  { id: 'problems', label: '悩み・課題' }, { id: 'solution', label: '解決策' },
  { id: 'benefits', label: '参加メリット' }, { id: 'cta', label: '中間申込ボタン' },
  { id: 'instructor', label: '講師紹介' }, { id: 'testimonials', label: '参加者の声' },
  { id: 'details', label: '開催概要' }, { id: 'faq', label: 'よくある質問' },
  { id: 'notice', label: '注意事項' },
]

function initialPage(webinar: Webinar): WebinarLandingPage {
  return {
    enabled: true, template: 'dark', heroImageUrl: null, eyebrow: 'ONLINE WEBINAR',
    headline: webinar.title, description: 'LINEから参加予約できます。',
    problems: [], solutionTitle: '', solutionBody: '', benefits: [],
    instructorName: '', instructorBio: '', testimonials: [], eventDetails: '', faqs: [], notice: '',
    ctaLabel: 'LINEで参加予約する', accentColor: '#06c755',
    sectionOrder: SECTIONS.map(({ id }) => id), hiddenSections: [],
    ...webinar.landingPage,
  }
}

const pad = (items: string[], length: number) => [...items, ...Array(length).fill('')].slice(0, length)

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="font-bold text-slate-900">{title}</h2>{children}</section>
}

export default function WebinarLandingPageForm({ webinar }: { webinar: Webinar }) {
  const [page, setPage] = useState<WebinarLandingPage>(() => initialPage(webinar))
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [generationMessage, setGenerationMessage] = useState<string | null>(null)
  const [generationKeywords, setGenerationKeywords] = useState('')
  const [generationSource, setGenerationSource] = useState('')
  const [generationTone, setGenerationTone] = useState<'professional' | 'friendly' | 'premium'>('professional')
  const [generationMode, setGenerationMode] = useState<'empty' | 'all'>('empty')
  const [previewMobile, setPreviewMobile] = useState(true)
  const problems = useMemo(() => pad(page.problems, 3), [page.problems])
  const benefits = useMemo(() => pad(page.benefits, 3), [page.benefits])
  const testimonials = useMemo(() => [...page.testimonials, { quote: '', author: '' }, { quote: '', author: '' }].slice(0, 2), [page.testimonials])
  const faqs = useMemo(() => [...page.faqs, { question: '', answer: '' }, { question: '', answer: '' }, { question: '', answer: '' }].slice(0, 3), [page.faqs])
  const imageValue: ImageUploaderValue | null = page.heroImageUrl ? { mode: 'url', url: page.heroImageUrl } : null
  const publicUrl = `${getApiBase() ?? ''}/lp/webinar/${encodeURIComponent(webinar.slug)}`
  const visible = (id: WebinarLandingSection) => !page.hiddenSections.includes(id)
  const sectionLabel = (id: WebinarLandingSection) => SECTIONS.find((item) => item.id === id)?.label ?? id

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= page.sectionOrder.length) return
    const next = [...page.sectionOrder]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setPage((prev) => ({ ...prev, sectionOrder: next }))
  }

  const generate = async () => {
    if (!generationKeywords.trim() && !generationSource.trim()) {
      setGenerationMessage('キーワードまたは元になる文章を入力してください。'); return
    }
    setGenerating(true); setGenerationMessage(null)
    try {
      const { data } = await webinarApi.generateLandingPage(webinar.id, {
        keywords: generationKeywords.trim(), sourceText: generationSource.trim(), tone: generationTone,
      })
      setPage((current) => mergeGeneratedLandingPage(current, data, generationMode))
      setGenerationMessage('AIの下書きを反映しました。内容を確認してから保存してください。')
    } catch {
      setGenerationMessage('AI生成に失敗しました。時間をおいて、もう一度お試しください。')
    } finally { setGenerating(false) }
  }

  const save = async () => {
    setSaving(true); setMessage(null)
    try {
      const landingPage = {
        ...page,
        problems: problems.map((item) => item.trim()).filter(Boolean),
        benefits: benefits.map((item) => item.trim()).filter(Boolean),
        testimonials: testimonials.map(({ quote, author }) => ({ quote: quote.trim(), author: author.trim() })).filter(({ quote, author }) => quote || author),
        faqs: faqs.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() })).filter(({ question, answer }) => question || answer),
      }
      await webinarApi.update(webinar.id, { landingPage }); setPage(landingPage); setMessage('外部LPを保存しました')
    } catch {
      setMessage('保存に失敗しました。入力内容を確認して、もう一度お試しください。')
    } finally { setSaving(false) }
  }

  const updateList = (key: 'problems' | 'benefits', values: string[], index: number, value: string) => {
    const next = [...values]; next[index] = value
    setPage((prev) => ({ ...prev, [key]: next }))
  }

  const previewSections: Record<WebinarLandingSection, ReactNode> = {
    problems: problems.some(Boolean) && <PreviewBox title="こんなお悩みはありませんか？"><PreviewList items={problems} /></PreviewBox>,
    solution: (page.solutionTitle || page.solutionBody) && <PreviewBox title={page.solutionTitle || 'このウェビナーで解決します'}><p>{page.solutionBody}</p></PreviewBox>,
    benefits: benefits.some(Boolean) && <PreviewBox title="このウェビナーで得られること"><PreviewList items={benefits} /></PreviewBox>,
    cta: <PreviewCta label={page.ctaLabel} color={page.accentColor} />,
    instructor: (page.instructorName || page.instructorBio) && <PreviewBox title="講師"><b>{page.instructorName}</b><p>{page.instructorBio}</p></PreviewBox>,
    testimonials: testimonials.some(({ quote, author }) => quote || author) && <PreviewBox title="参加者の声">{testimonials.filter(({ quote, author }) => quote || author).map((item, index) => <blockquote key={index} className="mt-2 border-l-4 pl-3" style={{ borderColor: page.accentColor }}><p>{item.quote}</p><small>{item.author}</small></blockquote>)}</PreviewBox>,
    details: page.eventDetails && <PreviewBox title="開催概要"><p>{page.eventDetails}</p></PreviewBox>,
    faq: faqs.some(({ question, answer }) => question || answer) && <PreviewBox title="よくある質問">{faqs.filter(({ question, answer }) => question || answer).map((item, index) => <div key={index} className="mt-3"><b>Q. {item.question}</b><p>A. {item.answer}</p></div>)}</PreviewBox>,
    notice: page.notice && <div className="mt-4 rounded-xl border border-current/20 p-3 text-left text-xs opacity-80">{page.notice}</div>,
  }
  const previewTheme = page.template === 'light' ? 'bg-slate-50 text-slate-900' : page.template === 'gold' ? 'bg-[#0d0d0d] text-[#fffaf0]' : 'bg-[#0f1b2d] text-white'

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
      <div className="space-y-5">
        <Card title="AIで下書きを作成">
          <p className="text-sm text-slate-600">キーワードや元になる文章から各セクションを作成します。生成結果は自動保存されません。</p>
          <InputArea label="キーワード・要望" value={generationKeywords} maxLength={1000} rows={3} placeholder="例：中小企業向け、生成AI、業務効率化、初心者にも分かりやすく" onChange={(e) => setGenerationKeywords(e.target.value)} />
          <InputArea label="事実情報・元になる文章" value={generationSource} maxLength={6000} rows={6} placeholder="サービス説明、講師プロフィール、実際のお客様の声、開催条件など。記載のない事実はAIに作らせません。" onChange={(e) => setGenerationSource(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">文体
              <select value={generationTone} onChange={(e) => setGenerationTone(e.target.value as typeof generationTone)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="professional">信頼感・専門的</option><option value="friendly">親しみやすい</option><option value="premium">上質・プレミアム</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">反映範囲
              <select value={generationMode} onChange={(e) => setGenerationMode(e.target.value as typeof generationMode)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="empty">空欄だけ埋める</option><option value="all">入力済みの文章も置き換える</option>
              </select>
            </label>
          </div>
          <Button variant="primary" onClick={() => void generate()} disabled={generating} loading={generating}>AIで下書きを作成</Button>
          {generationMessage && <p className="text-sm text-slate-700" role="status">{generationMessage}</p>}
          <p className="text-xs text-amber-700">講師経歴・実績・参加者の声は、上の元文章に記載された事実だけを使用します。</p>
        </Card>
        <Card title="公開・デザイン">
          <Checkbox label="外部LPを公開する" checked={page.enabled} onCheckedChange={(enabled) => setPage((prev) => ({ ...prev, enabled }))} />
          <label className="block text-sm font-medium text-slate-700">テンプレート
            <select value={page.template} onChange={(e) => setPage((prev) => ({ ...prev, template: e.target.value as WebinarLandingPage['template'] }))} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="dark">ダーク</option><option value="light">ライト</option><option value="gold">ブラック＆ゴールド</option>
            </select>
          </label>
          <ImageUploader mode="url" label="メイン画像" value={imageValue} onChange={(value) => setPage((prev) => ({ ...prev, heroImageUrl: value?.mode === 'url' ? value.url : null }))} />
          <Input label="上部ラベル" value={page.eyebrow} maxLength={60} onChange={(e) => setPage((prev) => ({ ...prev, eyebrow: e.target.value }))} />
          <Input label="キャッチコピー" value={page.headline} maxLength={120} onChange={(e) => setPage((prev) => ({ ...prev, headline: e.target.value }))} />
          <InputArea label="説明文" value={page.description} maxLength={2000} rows={5} onChange={(e) => setPage((prev) => ({ ...prev, description: e.target.value }))} />
          <Input label="申込ボタンの文言" value={page.ctaLabel} maxLength={40} onChange={(e) => setPage((prev) => ({ ...prev, ctaLabel: e.target.value }))} />
          <label className="block text-sm font-medium text-slate-700">アクセントカラー<input type="color" value={page.accentColor} onChange={(e) => setPage((prev) => ({ ...prev, accentColor: e.target.value }))} className="mt-2 block h-10 w-20 cursor-pointer rounded border border-slate-300" /></label>
        </Card>
        <Card title="悩み・課題">{problems.map((item, index) => <Input key={index} label={`課題 ${index + 1}`} value={item} maxLength={160} onChange={(e) => updateList('problems', problems, index, e.target.value)} />)}</Card>
        <Card title="解決策・サービス紹介">
          <Input label="見出し" value={page.solutionTitle} maxLength={120} onChange={(e) => setPage((prev) => ({ ...prev, solutionTitle: e.target.value }))} />
          <InputArea label="本文" value={page.solutionBody} maxLength={2000} rows={5} onChange={(e) => setPage((prev) => ({ ...prev, solutionBody: e.target.value }))} />
        </Card>
        <Card title="参加メリット">{benefits.map((item, index) => <Input key={index} label={`メリット ${index + 1}`} value={item} maxLength={160} onChange={(e) => updateList('benefits', benefits, index, e.target.value)} />)}</Card>
        <Card title="講師紹介">
          <Input label="講師名" value={page.instructorName} maxLength={80} onChange={(e) => setPage((prev) => ({ ...prev, instructorName: e.target.value }))} />
          <InputArea label="プロフィール" value={page.instructorBio} maxLength={1000} rows={4} onChange={(e) => setPage((prev) => ({ ...prev, instructorBio: e.target.value }))} />
        </Card>
        <Card title="参加者の声">{testimonials.map((item, index) => <div key={index} className="space-y-2 rounded-xl bg-slate-50 p-3"><InputArea label={`コメント ${index + 1}`} value={item.quote} maxLength={1000} rows={3} onChange={(e) => { const next = [...testimonials]; next[index] = { ...item, quote: e.target.value }; setPage((prev) => ({ ...prev, testimonials: next })) }} /><Input label="お名前・属性" value={item.author} maxLength={160} onChange={(e) => { const next = [...testimonials]; next[index] = { ...item, author: e.target.value }; setPage((prev) => ({ ...prev, testimonials: next })) }} /></div>)}</Card>
        <Card title="開催概要・FAQ・注意事項">
          <InputArea label="開催概要" value={page.eventDetails} maxLength={1000} rows={4} onChange={(e) => setPage((prev) => ({ ...prev, eventDetails: e.target.value }))} />
          {faqs.map((item, index) => <div key={index} className="space-y-2 rounded-xl bg-slate-50 p-3"><Input label={`質問 ${index + 1}`} value={item.question} maxLength={1000} onChange={(e) => { const next = [...faqs]; next[index] = { ...item, question: e.target.value }; setPage((prev) => ({ ...prev, faqs: next })) }} /><InputArea label="回答" value={item.answer} maxLength={1000} rows={3} onChange={(e) => { const next = [...faqs]; next[index] = { ...item, answer: e.target.value }; setPage((prev) => ({ ...prev, faqs: next })) }} /></div>)}
          <InputArea label="注意事項" value={page.notice} maxLength={1000} rows={3} onChange={(e) => setPage((prev) => ({ ...prev, notice: e.target.value }))} />
        </Card>
        <Card title="セクションの順序・表示">
          <p className="text-xs text-slate-500">中間申込ボタンを表示すると、ページ末尾と合わせて2か所に申込ボタンが出ます。</p>
          {page.sectionOrder.map((id, index) => <div key={id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3"><Checkbox label={sectionLabel(id)} checked={visible(id)} onCheckedChange={(checked) => setPage((prev) => ({ ...prev, hiddenSections: checked ? prev.hiddenSections.filter((item) => item !== id) : [...prev.hiddenSections, id] }))} /><span className="ml-auto flex gap-1"><button type="button" aria-label={`${sectionLabel(id)}を上へ`} disabled={index === 0} onClick={() => moveSection(index, -1)} className="rounded border px-2 py-1 disabled:opacity-30">↑</button><button type="button" aria-label={`${sectionLabel(id)}を下へ`} disabled={index === page.sectionOrder.length - 1} onClick={() => moveSection(index, 1)} className="rounded border px-2 py-1 disabled:opacity-30">↓</button></span></div>)}
        </Card>
        <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <Button variant="primary" onClick={() => void save()} disabled={saving} loading={saving}>外部LPを保存</Button>
          {message && <span className="text-sm text-slate-600" role="status">{message}</span>}
        </div>
      </div>
      <aside className="xl:sticky xl:top-5 xl:self-start">
        <div className="mb-2 flex justify-end gap-2"><button type="button" onClick={() => setPreviewMobile(false)} className={`rounded px-3 py-1 text-xs ${!previewMobile ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>PC</button><button type="button" onClick={() => setPreviewMobile(true)} className={`rounded px-3 py-1 text-xs ${previewMobile ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>スマホ</button></div>
        <div className={`mx-auto overflow-hidden rounded-2xl border border-slate-700 shadow-xl transition-all ${previewTheme} ${previewMobile ? 'max-w-[390px]' : 'max-w-full'}`}>
          <div className="border-b border-current/20 px-5 py-3 text-xs font-bold opacity-70">プレビュー</div>
          <div className="p-5 text-center">
            {page.heroImageUrl && <img src={page.heroImageUrl} alt="" className="mb-6 max-h-64 w-full rounded-2xl object-cover" />}
            <div className="text-xs font-bold tracking-widest" style={{ color: page.accentColor }}>{page.eyebrow}</div>
            <h1 className="my-4 text-3xl font-black leading-tight">{page.headline}</h1>
            <p className="whitespace-pre-line text-sm leading-7 opacity-80">{page.description}</p>
            {page.sectionOrder.filter(visible).map((id) => <div key={id}>{previewSections[id]}</div>)}
            <PreviewCta label={page.ctaLabel} color={page.accentColor} />
          </div>
        </div>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-3 block text-center text-sm font-semibold text-emerald-700 underline">公開ページを別タブで確認</a>
      </aside>
    </div>
  )
}

function PreviewBox({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mt-5 rounded-xl border border-current/20 p-4 text-left"><h2 className="mb-3 font-bold">{title}</h2><div className="whitespace-pre-line text-sm leading-6 opacity-80">{children}</div></div>
}
function PreviewList({ items }: { items: string[] }) {
  return <ul className="space-y-2">{items.filter(Boolean).map((item, index) => <li key={index}>✓ {item}</li>)}</ul>
}
function PreviewCta({ label, color }: { label: string; color: string }) {
  return <div className="mt-7 rounded-full px-5 py-4 font-bold text-white" style={{ backgroundColor: color }}>{label}</div>
}
