export interface OfferConfig {
  priceId: string
  productId: string
  offerId: string
  mode?: 'payment' | 'subscription'
}

export interface OfferPresetDefinition {
  defaultVariant: string
  variants: Record<string, OfferConfig>
}

function valueOrFallback(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback
}

function paymentOffer(
  priceId: string | undefined,
  productId: string | undefined,
  offerId: string | undefined,
  fallback: { priceId: string; productId: string; offerId: string },
): OfferConfig {
  return {
    priceId: valueOrFallback(priceId, fallback.priceId),
    productId: valueOrFallback(productId, fallback.productId),
    offerId: valueOrFallback(offerId, fallback.offerId),
    mode: 'payment',
  }
}

function subscriptionOffer(
  priceId: string | undefined,
  productId: string | undefined,
  offerId: string | undefined,
  fallback: { priceId: string; productId: string; offerId: string },
): OfferConfig {
  return {
    priceId: valueOrFallback(priceId, fallback.priceId),
    productId: valueOrFallback(productId, fallback.productId),
    offerId: valueOrFallback(offerId, fallback.offerId),
    mode: 'subscription',
  }
}

export const OFFER_PRESETS: Record<string, OfferPresetDefinition> = {
  evergreen_launch: {
    defaultVariant: 'core',
    variants: {
      core: paymentOffer(
        import.meta.env.VITE_OFFER_EVERGREEN_CORE_PRICE_ID,
        import.meta.env.VITE_OFFER_EVERGREEN_CORE_PRODUCT_ID,
        import.meta.env.VITE_OFFER_EVERGREEN_CORE_OFFER_ID,
        {
          priceId: 'price_evergreen_core',
          productId: 'prod_evergreen_core',
          offerId: 'offer_evergreen_core',
        },
      ),
      lite: paymentOffer(
        import.meta.env.VITE_OFFER_EVERGREEN_LITE_PRICE_ID,
        import.meta.env.VITE_OFFER_EVERGREEN_LITE_PRODUCT_ID,
        import.meta.env.VITE_OFFER_EVERGREEN_LITE_OFFER_ID,
        {
          priceId: 'price_evergreen_lite',
          productId: 'prod_evergreen_lite',
          offerId: 'offer_evergreen_lite',
        },
      ),
      vip: paymentOffer(
        import.meta.env.VITE_OFFER_EVERGREEN_VIP_PRICE_ID,
        import.meta.env.VITE_OFFER_EVERGREEN_VIP_PRODUCT_ID,
        import.meta.env.VITE_OFFER_EVERGREEN_VIP_OFFER_ID,
        {
          priceId: 'price_evergreen_vip',
          productId: 'prod_evergreen_vip',
          offerId: 'offer_evergreen_vip',
        },
      ),
    },
  },
  subscription_launch: {
    defaultVariant: 'monthly',
    variants: {
      monthly: subscriptionOffer(
        import.meta.env.VITE_OFFER_SUBSCRIPTION_MONTHLY_PRICE_ID,
        import.meta.env.VITE_OFFER_SUBSCRIPTION_MONTHLY_PRODUCT_ID,
        import.meta.env.VITE_OFFER_SUBSCRIPTION_MONTHLY_OFFER_ID,
        {
          priceId: 'price_subscription_monthly',
          productId: 'prod_subscription_monthly',
          offerId: 'offer_subscription_monthly',
        },
      ),
      annual: subscriptionOffer(
        import.meta.env.VITE_OFFER_SUBSCRIPTION_ANNUAL_PRICE_ID,
        import.meta.env.VITE_OFFER_SUBSCRIPTION_ANNUAL_PRODUCT_ID,
        import.meta.env.VITE_OFFER_SUBSCRIPTION_ANNUAL_OFFER_ID,
        {
          priceId: 'price_subscription_annual',
          productId: 'prod_subscription_annual',
          offerId: 'offer_subscription_annual',
        },
      ),
    },
  },
}

export function resolveOfferPreset(
  presetName: string | null,
  variantName?: string | null,
): OfferConfig | null {
  if (!presetName) return null

  const preset = OFFER_PRESETS[presetName]
  if (!preset) return null

  const resolvedVariant = variantName && preset.variants[variantName]
    ? variantName
    : preset.defaultVariant

  return preset.variants[resolvedVariant] ?? null
}
