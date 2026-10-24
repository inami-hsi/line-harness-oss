import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ウェビナー作成時のアカウント', () => {
  const source = readFileSync(new URL('./webinar-form.tsx', import.meta.url), 'utf8')

  it('新規作成時は選択されたアカウントを送信し、未選択なら保存しない', () => {
    expect(source).toContain('if (!initial && !selectedAccountId)')
    expect(source).toContain('webinarApi.create({ ...input, accountId: selectedAccountId })')
  })

  it('既存ウェビナーの編集時はアカウントを上書きしない', () => {
    expect(source).toContain('webinarApi.update(initial.id, input)')
  })
})
