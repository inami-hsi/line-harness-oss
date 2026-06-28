# Stripe Plugin Template

`@line-harness/plugin-stripe` は、Stripe を起点にエバーグリーンローンチを回すための LINE Harness 用テンプレートです。

このテンプレートでは次の 3 本柱を最初から用意しています。

- Stripe Webhook 受信
- Stripe 顧客 / サブスク状態の定期同期
- 支払い失敗 / トライアル終了前の LINE フォロー

## 想定する導線

- LP / 広告 → LINE 追加
- LINE 内で案内 / オファー
- Stripe Checkout で申込
- 決済完了 / 失敗 / 継続 / 解約予兆を LINE で自動フォロー

## 実装済みイベント

[src/index.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/index.ts) で次の Stripe イベントを処理します。

- `checkout.session.completed`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

処理内容の例:

- タグ付け
- 友だち metadata 更新
- 支払い完了メッセージ
- 支払い失敗フォロー
- サブスク状態反映

## ファイル構成

- [src/index.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/index.ts)
  Stripe Webhook、署名検証、イベント処理
- [src/external-api.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/external-api.ts)
  Stripe API クライアント
- [src/sync.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/sync.ts)
  Stripe 顧客 / サブスク情報の同期
- [src/notify.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/notify.ts)
  トライアル終了前 / 支払い失敗の通知
- [wrangler.toml](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/wrangler.toml)
  Worker 設定
- [.dev.vars.example](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/.dev.vars.example)
  ローカル開発用シークレット例

## 前提

このテンプレートは、LINE Harness 側の友だち metadata に `stripeCustomerId` を保存してある前提で友だちを解決します。

つまり最低限、次のどちらかが必要です。

- 初回購入前に `stripeCustomerId` を metadata へ保存する導線
- Stripe metadata に `lineHarnessFriendId` を載せて Checkout / Invoice / Subscription へ引き回す導線

おすすめは、Checkout Session 作成時に次を metadata へ入れることです。

- `lineHarnessFriendId`
- `stripeCustomerId`
- `productId`
- `offerId`
- `refCode`

詳細設計は [STRIPE_CHECKOUT_METADATA.md](/d:/Antigravity用脳みそ/line-harness-oss/docs/STRIPE_CHECKOUT_METADATA.md) を参照してください。

型付きヘルパーは [stripe-checkout-metadata.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/stripe-checkout-metadata.ts) に用意しています。

## 環境変数

公開変数:

- `LINE_HARNESS_API_URL`
- `LINE_ACCOUNT_ID` 任意

秘密情報:

- `LINE_HARNESS_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

ローカル開発では `.dev.vars.example` をコピーして `.dev.vars` を作成します。

```powershell
Copy-Item .dev.vars.example .dev.vars
```

## ローカル開発

```bash
pnpm --filter @line-harness/plugin-stripe build
pnpm --filter @line-harness/plugin-stripe dev
```

ヘルスチェック:

```bash
curl http://localhost:8787/health
```

Webhook テスト例:

```bash
curl -X POST http://localhost:8787/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test_123",
    "type": "checkout.session.completed",
    "data": {
      "object": {
        "id": "cs_test_123",
        "customer": "cus_123",
        "mode": "payment",
        "metadata": {
          "lineHarnessFriendId": "friend_123",
          "productId": "prod_abc"
        }
      }
    }
  }'
```

## 何を同期するか

[src/sync.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/sync.ts) では次を LINE Harness に反映します。

- `stripeCustomerId`
- `stripeEmail`
- `stripeCustomerName`
- `stripeSubscriptionId`
- `stripeSubscriptionStatus`
- `stripeCurrentPeriodEnd`
- `stripeTrialEnd`
- `stripeCancelAtPeriodEnd`
- `stripePriceIds`
- `stripeProductIds`

タグ例:

- `stripe:subscription:active`
- `stripe:subscription:trialing`
- `stripe:subscription:canceled`
- `stripe:product:prod_xxx`

## 何を通知するか

[src/notify.ts](/d:/Antigravity用脳みそ/line-harness-oss/packages/plugin-template/src/notify.ts) では次を送ります。

- トライアル終了 3 日前以内の通知
- 未払い請求のフォロー通知

タグ例:

- `stripe:trial-ending-reminded`
- `stripe:payment-followup`

## デプロイ

```bash
pnpm --filter @line-harness/plugin-stripe deploy
```

事前に secret を設定します。

```bash
wrangler secret put LINE_HARNESS_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

## 次にやると良いこと

- Stripe Checkout Session 作成側で metadata 設計を固定する
- `priceId` / `productId` ごとのオファー別タグ付けを強化する
- `invoice.paid` や `charge.refunded` も処理する
- 売上金額ごとのスコアリングやアップセル判定を追加する
- Webhook payload を Zod で厳密に検証する

## LIFF 側の offer 設定

LIFF から決済へ進める場合は、[apps/liff/.env.example](/d:/Antigravity用脳みそ/line-harness-oss/apps/liff/.env.example) の `VITE_OFFER_*` を本番値へ置き換えて使います。

そのまま入力しやすい雛形として [apps/liff/.env.local.example](/d:/Antigravity用脳みそ/line-harness-oss/apps/liff/.env.local.example) も追加しています。

- `VITE_OFFER_EVERGREEN_*`
- `VITE_OFFER_SUBSCRIPTION_*`

[offers.ts](/d:/Antigravity用脳みそ/line-harness-oss/apps/liff/src/offers.ts) では、環境変数があればそちらを優先し、未設定ならダミー値へフォールバックします。
