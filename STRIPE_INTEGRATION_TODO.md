# Integração Stripe — o que falta

A criação do checkout fica em `POST /api/assinatura/checkout` ([server.mjs](server.mjs)). Não há valores de exemplo (placeholders) no código: o preço vem do produto na Stripe e as URLs usam o domínio real.

## Valores para conferir

| Campo | Valor atual | O que fazer |
|-------|-------------|-------------|
| line_items[].price | preço mensal ativo do produto `STRIPE_PRODUCT_ID` (ou `STRIPE_PRICE_MENSAL`) | Crie o preço de R$ 14,90/mês no produto. Para subir para R$ 19,90, crie o novo e arquive o antigo. |
| success_url / cancel_url | `https://www.diretoaposse.com.br/?assinatura=ok` e `?assinatura=cancelada` | Em teste local, defina `APP_URL`. |

## Parâmetros configurados no Checkout Studio (já aplicados)

Arquivo: [server.mjs](server.mjs)

| Parâmetro | Valor |
|-----------|-------|
| ui_mode | hosted_page (SDK 22.x) |
| billing_address_collection | auto |
| phone_number_collection | { enabled: false } |
| automatic_tax | { enabled: false } |
| allow_promotion_codes | false |
| payment_method_collection | always |
| integration_identifier | hosted_web_0001 |
| origin_context | web |
| submit_type | auto (não enviado: só vale em mode "payment") |

Parâmetros próprios do app (mantidos): `mode: subscription`, `customer`, `client_reference_id`, `subscription_data` (trial de 7 dias + metadata.userId), `locale: pt-BR`.

## Variáveis de ambiente (Railway)

- `STRIPE_SECRET`: chave secreta (`sk_test_...` em teste).
- `STRIPE_PUBLIC`: não usada (checkout hospedado).
- `STRIPE_WEBHOOK_SECRET`: `whsec_...` do endpoint do webhook.
- `STRIPE_PRODUCT_ID` (ou `STRIPE_PRICE_MENSAL`).
- `COBRANCA_INICIO`: data ISO que liga a cobrança (sem ela, nada muda no app).
- `APP_URL` (opcional).

## Como funciona

1. Aluno clica em assinar → `/api/assinatura/checkout` cria a sessão e devolve a URL.
2. Stripe cobra o cartão só após o trial; o app libera o acesso pelo **webhook** (`/api/stripe/webhook`), nunca pela página de sucesso.
3. Cancelar/atualizar cartão: Customer Portal (`/api/assinatura/portal`).

## Testes

Cartão de teste: `4242 4242 4242 4242`, qualquer validade futura e CVC. Falha de pagamento: `4000 0000 0000 0341`.

## Recursos

https://support.stripe.com · https://docs.stripe.com/mcp
