export interface StripeCheckoutMetadata {
  lineHarnessFriendId: string
  stripeCustomerId: string
  productId: string
  offerId: string
  refCode: string
  campaignId?: string
  entryScenarioId?: string
  entryFormId?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
}

export function buildStripeCheckoutMetadata(
  input: StripeCheckoutMetadata,
): Record<string, string> {
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  )

  return Object.fromEntries(entries)
}
