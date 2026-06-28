'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'

interface PointEntry {
  id: string
  displayName: string
  pictureUrl: string | null
  points: number
  pointsLastUpdated: string | null
}

const ccPrompts = [
  {
    title: 'ポイント付与',
    prompt: `ポイントを付与してください。
1. manage_points ツールを使って特定の友だちにポイントを付与
2. 付与理由と金額を指定
3. LINE通知オプションを確認
手順を示してください。`,
  },
  {
    title: 'チャーン分析',
    prompt: `audit_churn ツールを使ってチャーンリスク分析を実行してください。
1. 全友だちのlastActiveDateを確認
2. リスク別にタグ付け（churn:low/medium/high/critical）
3. high/criticalな友だちへの再エンゲージメントメッセージを提案
結果をレポートしてください。`,
  },
]

export default function PointsPage() {
  const [leaderboard, setLeaderboard] = useState<PointEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Adjust form
  const [adjustFriendId, setAdjustFriendId] = useState('')
  const [adjustChange, setAdjustChange] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustNotify, setAdjustNotify] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [adjustResult, setAdjustResult] = useState<string | null>(null)
  const [adjustError, setAdjustError] = useState('')

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.points.leaderboard(50)
      if (res.success) setLeaderboard(res.data)
      else setError('データの取得に失敗しました')
    } catch {
      setError('接続エラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadLeaderboard() }, [loadLeaderboard])

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault()
    setAdjusting(true)
    setAdjustResult(null)
    setAdjustError('')
    try {
      const change = Number(adjustChange)
      if (isNaN(change) || change === 0) throw new Error('変動値は0以外の数値を入力してください')
      const res = await api.points.adjust({
        friendId: adjustFriendId,
        change,
        reason: adjustReason || undefined,
        notify: adjustNotify,
      })
      if (!res.success) throw new Error('調整に失敗しました')
      setAdjustResult(`調整完了: ${res.data.previousBalance} pt → ${res.data.newBalance} pt`)
      setAdjustFriendId('')
      setAdjustChange('')
      setAdjustReason('')
      await loadLeaderboard()
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'エラー')
    } finally {
      setAdjusting(false)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="ポイント管理" />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        <CcPromptButton prompts={ccPrompts} />

        {/* Leaderboard */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-800">ポイントランキング</h2>
            <button
              onClick={loadLeaderboard}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              更新
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : error ? (
            <div className="py-12 text-center text-red-500 text-sm">{error}</div>
          ) : leaderboard.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              ポイント保有者がいません
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {leaderboard.map((entry, i) => (
                <div key={entry.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="w-6 text-center text-sm font-bold text-gray-400">
                    {i + 1}
                  </span>
                  {entry.pictureUrl ? (
                    <img src={entry.pictureUrl} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {entry.displayName || '名前なし'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {entry.id} · 更新 {formatDate(entry.pointsLastUpdated)}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-green-600 tabular-nums">
                    {entry.points.toLocaleString()} pt
                  </span>
                  <button
                    className="text-xs text-blue-500 hover:underline"
                    onClick={() => setAdjustFriendId(entry.id)}
                  >
                    調整
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Adjust form */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">ポイント調整</h2>
          <form onSubmit={handleAdjust} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                友だちID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={adjustFriendId}
                onChange={(e) => setAdjustFriendId(e.target.value)}
                placeholder="friend_xxxxxxxx"
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                変動値 <span className="text-red-500">*</span>
                <span className="text-gray-400 ml-1 font-normal">（付与: +100、消費: -100）</span>
              </label>
              <input
                type="number"
                value={adjustChange}
                onChange={(e) => setAdjustChange(e.target.value)}
                placeholder="100"
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">理由</label>
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="購入特典、キャンペーン付与..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={adjustNotify}
                onChange={(e) => setAdjustNotify(e.target.checked)}
                className="rounded"
              />
              LINEで通知する
            </label>
            {adjustResult && (
              <p className="text-sm text-green-600">{adjustResult}</p>
            )}
            {adjustError && (
              <p className="text-sm text-red-500">{adjustError}</p>
            )}
            <button
              type="submit"
              disabled={adjusting}
              className="bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              {adjusting ? '処理中...' : 'ポイント調整'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
