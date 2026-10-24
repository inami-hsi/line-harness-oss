import { describe, expect, it } from 'vitest'
import type { WebinarLandingPage } from '@/lib/api'
import { mergeGeneratedLandingPage } from './webinar-landing-page-generation'

const page = (overrides: Partial<WebinarLandingPage> = {}): WebinarLandingPage => ({
  enabled: true, template: 'dark', heroImageUrl: '/hero.jpg', eyebrow: '', headline: '', description: '',
  problems: [], solutionTitle: '', solutionBody: '', benefits: [], instructorName: '', instructorBio: '',
  testimonials: [], eventDetails: '', faqs: [], notice: '', ctaLabel: '', accentColor: '#123456',
  sectionOrder: ['problems', 'solution'], hiddenSections: ['instructor'], ...overrides,
})

describe('mergeGeneratedLandingPage', () => {
  const generated = page({
    template: 'light', heroImageUrl: null, headline: '生成見出し', problems: ['生成した課題'],
    accentColor: '#abcdef', hiddenSections: [], sectionOrder: ['solution', 'problems'],
  })

  it('空欄だけ生成内容で補い、入力済みの内容を残す', () => {
    const result = mergeGeneratedLandingPage(page({ headline: '既存見出し' }), generated, 'empty')
    expect(result.headline).toBe('既存見出し')
    expect(result.problems).toEqual(['生成した課題'])
  })

  it('全置換でも運用設定と画像・色・非表示設定を残す', () => {
    const current = page({ enabled: false })
    const result = mergeGeneratedLandingPage(current, generated, 'all')
    expect(result).toMatchObject({ enabled: false, template: 'light', heroImageUrl: '/hero.jpg', accentColor: '#123456', hiddenSections: ['instructor'] })
    expect(result.sectionOrder).toEqual(['solution', 'problems'])
  })
})
