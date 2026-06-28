/**
 * Stripe API client for evergreen launch operations.
 *
 * This wrapper keeps the template focused on a few high-value Stripe objects:
 * customers, subscriptions, invoices, and webhook events.
 */

export interface StripeCustomer {
  id: string
  email: string | null
  name: string | null
  metadata: Record<string, string>
}

export interface StripeSubscription {
  id: string
  customer: string
  status: string
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  priceIds: string[]
  productIds: string[]
  metadata: Record<string, string>
}

export interface StripeInvoice {
  id: string
  customer: string | null
  status: string | null
  amountDue: number
  amountPaid: number
  currency: string | null
  hostedInvoiceUrl: string | null
  dueDate: string | null
  metadata: Record<string, string>
}

interface StripeListResponse<T> {
  data: T[]
  has_more: boolean
}

interface StripeApiCustomer {
  id: string
  email: string | null
  name: string | null
  metadata?: Record<string, string>
}

interface StripeApiSubscriptionItem {
  price?: {
    id?: string
    product?: string
  }
}

interface StripeApiSubscription {
  id: string
  customer: string | { id: string }
  status: string
  current_period_end?: number | null
  trial_end?: number | null
  cancel_at_period_end?: boolean
  metadata?: Record<string, string>
  items?: {
    data?: StripeApiSubscriptionItem[]
  }
}

interface StripeApiInvoice {
  id: string
  customer: string | { id: string } | null
  status: string | null
  amount_due?: number
  amount_paid?: number
  currency?: string | null
  hosted_invoice_url?: string | null
  due_date?: number | null
  metadata?: Record<string, string>
}

function toIsoFromUnix(value?: number | null): string | null {
  if (!value) return null
  return new Date(value * 1000).toISOString()
}

function normalizeMetadata(metadata?: Record<string, string>): Record<string, string> {
  return metadata ?? {}
}

function normalizeCustomerId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

export class StripeClient {
  private readonly secretKey: string

  constructor(secretKey: string) {
    this.secretKey = secretKey
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...init?.headers,
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Stripe API error ${response.status}: ${text}`)
    }

    return response.json() as Promise<T>
  }

  async listCustomers(limit = 100): Promise<StripeCustomer[]> {
    const response = await this.request<StripeListResponse<StripeApiCustomer>>(
      `/customers?limit=${limit}`,
    )

    return response.data.map((customer) => ({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      metadata: normalizeMetadata(customer.metadata),
    }))
  }

  async getCustomer(id: string): Promise<StripeCustomer> {
    const customer = await this.request<StripeApiCustomer>(`/customers/${id}`)
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      metadata: normalizeMetadata(customer.metadata),
    }
  }

  async listSubscriptions(status = 'all', limit = 100): Promise<StripeSubscription[]> {
    const response = await this.request<StripeListResponse<StripeApiSubscription>>(
      `/subscriptions?status=${encodeURIComponent(status)}&limit=${limit}`,
    )

    return response.data.map((subscription) => ({
      id: subscription.id,
      customer: normalizeCustomerId(subscription.customer) ?? '',
      status: subscription.status,
      currentPeriodEnd: toIsoFromUnix(subscription.current_period_end),
      trialEnd: toIsoFromUnix(subscription.trial_end),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      priceIds: subscription.items?.data?.map((item) => item.price?.id).filter(Boolean) as string[] ?? [],
      productIds: subscription.items?.data?.map((item) => item.price?.product).filter(Boolean) as string[] ?? [],
      metadata: normalizeMetadata(subscription.metadata),
    }))
  }

  async listInvoices(status?: string, limit = 100): Promise<StripeInvoice[]> {
    const search = new URLSearchParams({ limit: String(limit) })
    if (status) {
      search.set('status', status)
    }

    const response = await this.request<StripeListResponse<StripeApiInvoice>>(
      `/invoices?${search.toString()}`,
    )

    return response.data.map((invoice) => ({
      id: invoice.id,
      customer: normalizeCustomerId(invoice.customer),
      status: invoice.status,
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      dueDate: toIsoFromUnix(invoice.due_date),
      metadata: normalizeMetadata(invoice.metadata),
    }))
  }
}
