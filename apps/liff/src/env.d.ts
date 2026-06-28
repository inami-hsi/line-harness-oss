/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_LIFF_ID: string
  readonly VITE_API_URL: string
  readonly VITE_CALENDAR_CONNECTION_ID: string
  readonly VITE_BOT_BASIC_ID?: string
  readonly VITE_OFFER_EVERGREEN_CORE_PRICE_ID?: string
  readonly VITE_OFFER_EVERGREEN_CORE_PRODUCT_ID?: string
  readonly VITE_OFFER_EVERGREEN_CORE_OFFER_ID?: string
  readonly VITE_OFFER_EVERGREEN_LITE_PRICE_ID?: string
  readonly VITE_OFFER_EVERGREEN_LITE_PRODUCT_ID?: string
  readonly VITE_OFFER_EVERGREEN_LITE_OFFER_ID?: string
  readonly VITE_OFFER_EVERGREEN_VIP_PRICE_ID?: string
  readonly VITE_OFFER_EVERGREEN_VIP_PRODUCT_ID?: string
  readonly VITE_OFFER_EVERGREEN_VIP_OFFER_ID?: string
  readonly VITE_OFFER_SUBSCRIPTION_MONTHLY_PRICE_ID?: string
  readonly VITE_OFFER_SUBSCRIPTION_MONTHLY_PRODUCT_ID?: string
  readonly VITE_OFFER_SUBSCRIPTION_MONTHLY_OFFER_ID?: string
  readonly VITE_OFFER_SUBSCRIPTION_ANNUAL_PRICE_ID?: string
  readonly VITE_OFFER_SUBSCRIPTION_ANNUAL_PRODUCT_ID?: string
  readonly VITE_OFFER_SUBSCRIPTION_ANNUAL_OFFER_ID?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
