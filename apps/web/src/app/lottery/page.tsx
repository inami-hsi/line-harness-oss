'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'

interface LotteryResult {
  entrantCount: number
  winnerCount: number
  winners: Array<{ id: string; displayName: string }>
}

const ccPrompts = [
  {
    title: '抽選設計',
    prompt: `LINE Harness の抽選機能について教えてください。
1. エントリータグの設計（どのタグを使うか）
2. 当選確率の調整方法
3. 落選者への対応メッセージのベストプラクティス
提案してください。`,
  },
  {
    title: 'キャンペーン設計',
    prompt: `抽選を活用したキャンペーンを設計してください。
1. エントリー方法（友だち追加、フォーム回答、購入後など）
2. 当選通知のLINEメッセージ文案
3. 非当選者への特典（参加賞）提案
シナリオをまとめてください。`,
  },
]

export default function LotteryPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)

  // Form state
  const [entryTagId, setEntryTagId] = useState('')
  const [prizeCount, setPrizeCount] = useState('1')
  const [winnerTagName, setWinnerTagName] = useState('lottery:winner')
  const [winnerMessage, setWinnerMessage] = useState('')
  const [loserMessage, setLoserMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<LotteryResult | null>(null)
  const [runError, setRunError] = useState('')

  const loadTags = useCallback(async () => {
    setTagsLoading(true)
    try {
      const res = await api.tags.list()
      if (res.success) setTags(res.data)
    } catch {
      // Non-blocking
    } finally {
      setTagsLoading(false)
    }
  }, [])

  useEffect(() => { loadTags() }, [loadTags])

  async function handleRun(e: React.FormEvent) {
    e.preventDefault()
    setRunning(true)
    setResult(null)
    setRunError('')
    try {
      const count = Number(prizeCount)
      if (isNaN(count) || count < 1) throw new Error('当選数は1以上を指定してください')
      if (!entryTagId) throw new Error('エントリータグを選択してください')

      const res = await api.lottery.run({
        entryTagId,
        prizeCount: count,
        winnerTagName: winnerTagName || undefined,
        winnerMessage: winnerMessage || undefined,
        loserMessage: loserMessage || undefined,
      })
      if (!res.success) throw new Error('抽選に失敗しました')
      setResult(res.data)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'エラー')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="抽選管理" />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        <CcPromptButton prompts={ccPrompts} />

        {/* Run form */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">抽選実行</h2>
          <form onSubmit={handleRun} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                エントリータグ <span className="text-red-500">*</span>
              </label>
              {tagsLoading ? (
                <p className="text-sm text-gray-400">読み込み中...</p>
              ) : (
                <select
                  value={entryTagId}
                  onChange={(e) => setEntryTagId(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">— タグを選択 —</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-gray-400">
                このタグが付いている友だちが抽選対象になります
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                当選数 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={prizeCount}
                onChange={(e) => setPrizeCount(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                当選者タグ名
              </label>
              <input
                type="text"
                value={winnerTagName}
                onChange={(e) => setWinnerTagName(e.target.value)}
                placeholder="lottery:winner"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="mt-1 text-xs text-gray-400">当選者に自動でこのタグが付与されます</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                当選メッセージ
              </label>
              <textarea
                value={winnerMessage}
                onChange={(e) => setWinnerMessage(e.target.value)}
                rows={3}
                placeholder="おめでとうございます！抽選の結果、当選されました。..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="mt-1 text-xs text-gray-400">空の場合はデフォルトメッセージが送信されます</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                落選メッセージ <span className="text-gray-400 font-normal">（任意）</span>
              </label>
              <textarea
                value={loserMessage}
                onChange={(e) => setLoserMessage(e.target.value)}
                rows={2}
                placeholder="今回は惜しくも落選となりました。また次回の機会にご参加ください。"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="mt-1 text-xs text-gray-400">空の場合は落選者へのメッセージは送信されません</p>
            </div>

            {runError && (
              <p className="text-sm text-red-500">{runError}</p>
            )}

            <button
              type="submit"
              disabled={running}
              className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-3 rounded-md transition-colors"
            >
              {running ? '抽選中...' : '抽選を実行する'}
            </button>
          </form>
        </div>

        {/* Result */}
        {result && (
          <div className="bg-white rounded-lg border border-green-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-3">抽選結果</h2>
            <div className="flex gap-6 mb-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-800">{result.entrantCount}</p>
                <p className="text-xs text-gray-400">エントリー数</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{result.winnerCount}</p>
                <p className="text-xs text-gray-400">当選数</p>
              </div>
            </div>
            {result.winners.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">当選者一覧</p>
                <div className="space-y-1">
                  {result.winners.map((w, i) => (
                    <div key={w.id} className="flex items-center gap-3 py-1">
                      <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                      <span className="text-sm text-gray-800">{w.displayName || '名前なし'}</span>
                      <span className="text-xs text-gray-400 font-mono">{w.id}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
