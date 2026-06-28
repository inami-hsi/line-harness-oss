# Stripe Checkout Metadata Design

`line-harness-oss` でエバーグリーンローンチを回すときは、Stripe Checkout Session 作成時の `metadata` を固定しておくと、Webhook 側の自動化がかなり安定します。

このドキュメントでは、最小で必要な項目と推奨項目を定義します。

## 目的

- Stripe 決済イベントから LINE Harness の友だちを確実に特定する
- どのオファー / 商品 / 流入経路で売れたかを残す
- 決済完了後のタグ付け、スコアリング、シナリオ分岐をしやすくする

## 必須 metadata

最低限、次のどちらかは必須です。

1. `lineHarnessFriendId`
2. `stripeCustomerId`

おすすめは両方入れることです。

### 必須キー

- `lineHarnessFriendId`
  LINE Harness 上の友だち ID
- `stripeCustomerId`
  Stripe Customer ID

## 推奨 metadata

- `productId`
  どの商品が売れたか
- `offerId`
  どのオファー / 申込導線か
- `refCode`
  広告 / LP / アフィリエイト流入識別子
- `campaignId`
  広告キャンペーン単位の識別子
- `entryScenarioId`
  どのシナリオ経由の販売か
- `entryFormId`
  どのフォーム経由の申込か
- `utmSource`
- `utmMedium`
- `utmCampaign`
- `utmContent`

## 推奨 metadata 例

```json
{
  "lineHarnessFriendId": "friend_123",
  "stripeCustomerId": "cus_123",
  "productId": "prod_evergreen_basic",
  "offerId": "offer_tripwire_v1",
  "refCode": "meta_lp_a",
  "campaignId": "campaign_2026_spring",
  "entryScenarioId": "scenario_welcome_01",
  "entryFormId": "form_diagnosis_01",
  "utmSource": "meta",
  "utmMedium": "cpc",
  "utmCampaign": "spring_launch",
  "utmContent": "video_a"
}
```

## 優先順位

Webhook 側では、次の順で友だち解決するのがおすすめです。

1. `metadata.lineHarnessFriendId`
2. `object.customer` または `metadata.stripeCustomerId`
3. 補助的にメールアドレスや独自 ID

## Checkout Session 作成時の方針

- `metadata` は Session に必ず付与する
- 可能なら Customer にも同じ意味の情報を持たせる
- `client_reference_id` にも `lineHarnessFriendId` か `refCode` を入れると追跡しやすい

## 実装例

```ts
const metadata = {
  lineHarnessFriendId: friend.id,
  stripeCustomerId,
  productId: offer.productId,
  offerId: offer.id,
  refCode: friend.refCode ?? 'direct',
  campaignId: campaign.id,
  entryScenarioId: scenario.id,
  entryFormId: form.id,
  utmSource: utm.source ?? '',
  utmMedium: utm.medium ?? '',
  utmCampaign: utm.campaign ?? '',
  utmContent: utm.content ?? '',
}
```

## Session 作成サンプル

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  customer: stripeCustomerId,
  client_reference_id: friend.id,
  line_items: [
    {
      price: priceId,
      quantity: 1,
    },
  ],
  success_url: `${appUrl}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${appUrl}/offer`,
  metadata,
})
```

## Subscription の場合

サブスク申込では、Session だけでなく Subscription 側でも追えるようにしておくと安全です。

- Checkout Session metadata
- Subscription metadata
- Customer metadata

の 3 層で必要項目を引き回すのが理想です。

## LINE Harness での活用例

- `productId` ごとの購入タグ付け
- `offerId` ごとの CV 比較
- `refCode` ごとの売上分析
- `campaignId` ごとの ROAS 集計
- `entryScenarioId` ごとのシナリオ成約率比較

## まず固定すべき最小セット

迷うなら最初はこれだけで十分です。

- `lineHarnessFriendId`
- `stripeCustomerId`
- `productId`
- `offerId`
- `refCode`

この 5 つがあれば、購入者特定、商品別タグ付け、導線別分析、購入後フォローまで回しやすくなります。
