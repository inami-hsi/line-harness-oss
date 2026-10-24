import type { WebinarLandingPage } from '@/lib/api'

export function mergeGeneratedLandingPage(
  current: WebinarLandingPage,
  generated: WebinarLandingPage,
  mode: 'empty' | 'all',
): WebinarLandingPage {
  if (mode === 'all') return { ...generated, enabled: current.enabled, heroImageUrl: current.heroImageUrl, accentColor: current.accentColor, hiddenSections: current.hiddenSections }
  const empty = (value: string) => !value.trim()
  return {
    ...current,
    eyebrow: empty(current.eyebrow) ? generated.eyebrow : current.eyebrow,
    headline: empty(current.headline) ? generated.headline : current.headline,
    description: empty(current.description) ? generated.description : current.description,
    problems: current.problems.some((item) => item.trim()) ? current.problems : generated.problems,
    solutionTitle: empty(current.solutionTitle) ? generated.solutionTitle : current.solutionTitle,
    solutionBody: empty(current.solutionBody) ? generated.solutionBody : current.solutionBody,
    benefits: current.benefits.some((item) => item.trim()) ? current.benefits : generated.benefits,
    instructorName: empty(current.instructorName) ? generated.instructorName : current.instructorName,
    instructorBio: empty(current.instructorBio) ? generated.instructorBio : current.instructorBio,
    testimonials: current.testimonials.some(({ quote, author }) => quote.trim() || author.trim()) ? current.testimonials : generated.testimonials,
    eventDetails: empty(current.eventDetails) ? generated.eventDetails : current.eventDetails,
    faqs: current.faqs.some(({ question, answer }) => question.trim() || answer.trim()) ? current.faqs : generated.faqs,
    notice: empty(current.notice) ? generated.notice : current.notice,
    ctaLabel: empty(current.ctaLabel) ? generated.ctaLabel : current.ctaLabel,
  }
}
