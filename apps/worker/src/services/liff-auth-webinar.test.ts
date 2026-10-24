import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@line-crm/db', () => ({ getLineAccounts: vi.fn() }));
const { verifyCallerLineUserId } = await import('./liff-auth.js');

afterEach(() => vi.unstubAllGlobals());

describe('LIFF login channel restriction', () => {
  test('指定チャネルだけで検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sub: 'U1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await verifyCallerLineUserId('Bearer token', { DB: {} as D1Database, LINE_LOGIN_CHANNEL_ID: 'other' }, 'expected')).toBe('U1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('client_id=expected');
  });

  test('指定チャネルで検証できない場合は拒否する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    expect(await verifyCallerLineUserId('Bearer token', { DB: {} as D1Database }, 'expected')).toBeNull();
  });
});
