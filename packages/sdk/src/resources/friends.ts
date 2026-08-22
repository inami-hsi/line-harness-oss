import type { HttpClient } from '../http.js'
import type { ApiResponse, PaginatedData, Friend, FriendListParams, MessageType } from '../types.js'

export interface MileageSummary {
  programId: string
  programName: string
  available: number
  pending: number
  lifetimeEarned: number
  spent: number
}

export interface MileageHistoryItem {
  id: string
  amount: number
  reason: string
  entryType: string
  status: string
  occurredAt: string
  [key: string]: unknown
}

export interface FriendMileage {
  summary: MileageSummary
  history: MileageHistoryItem[]
}

export interface MileageAdjustResult {
  entry: MileageHistoryItem
  summary: MileageSummary
}

export class FriendsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  async list(params?: FriendListParams): Promise<PaginatedData<Friend>> {
    const query = new URLSearchParams()
    if (params?.limit !== undefined) query.set('limit', String(params.limit))
    if (params?.offset !== undefined) query.set('offset', String(params.offset))
    if (params?.tagId) query.set('tagId', params.tagId)
    if (params?.search) query.set('search', params.search)
    if (params?.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        query.set(`metadata.${key}`, String(value))
      }
    }
    const accountId = params?.accountId ?? this.defaultAccountId
    if (accountId) query.set('lineAccountId', accountId)
    const qs = query.toString()
    const path = qs ? `/api/friends?${qs}` : '/api/friends'
    const res = await this.http.get<ApiResponse<PaginatedData<Friend>>>(path)
    return res.data
  }

  async get(id: string): Promise<Friend> {
    const res = await this.http.get<ApiResponse<Friend>>(`/api/friends/${id}`)
    return res.data
  }

  async count(): Promise<number> {
    const res = await this.http.get<ApiResponse<{ count: number }>>('/api/friends/count')
    return res.data.count
  }

  async addTag(friendId: string, tagId: string): Promise<void> {
    await this.http.post(`/api/friends/${friendId}/tags`, { tagId })
  }

  async removeTag(friendId: string, tagId: string): Promise<void> {
    await this.http.delete(`/api/friends/${friendId}/tags/${tagId}`)
  }

  async sendMessage(
    friendId: string,
    content: string,
    messageType: MessageType = 'text',
    altText?: string,
    options?: { trackLinks?: boolean },
  ): Promise<{ messageId: string }> {
    const res = await this.http.post<ApiResponse<{ messageId: string }>>(`/api/friends/${friendId}/messages`, {
      messageType,
      content,
      ...(altText ? { altText } : {}),
      ...(options?.trackLinks !== undefined ? { trackLinks: options.trackLinks } : {}),
    })
    return res.data
  }

  async setMetadata(friendId: string, fields: Record<string, unknown>): Promise<Friend> {
    const res = await this.http.put<ApiResponse<Friend>>(`/api/friends/${friendId}/metadata`, fields)
    return res.data
  }

  async setRichMenu(friendId: string, richMenuId: string): Promise<void> {
    await this.http.post(`/api/friends/${friendId}/rich-menu`, { richMenuId })
  }

  async removeRichMenu(friendId: string): Promise<void> {
    await this.http.delete(`/api/friends/${friendId}/rich-menu`)
  }

  async getMileage(friendId: string, limit?: number): Promise<FriendMileage> {
    const path = limit
      ? `/api/friends/${friendId}/mileage?limit=${limit}`
      : `/api/friends/${friendId}/mileage`
    const res = await this.http.get<ApiResponse<FriendMileage>>(path)
    return res.data
  }

  async adjustMileage(friendId: string, amount: number, reason: string): Promise<MileageAdjustResult> {
    const res = await this.http.post<ApiResponse<MileageAdjustResult>>(`/api/friends/${friendId}/mileage/adjust`, {
      amount,
      reason,
    })
    return res.data
  }
}
