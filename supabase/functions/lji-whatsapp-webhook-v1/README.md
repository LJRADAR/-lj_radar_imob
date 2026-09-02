# lji-whatsapp-webhook-v1 — v22.47

Webhook oficial do WhatsApp Cloud API.

- Valida `X-Hub-Signature-256` com `META_APP_SECRET`.
- Deduplica por `message_id`.
- Resolve vínculo persistido ou telefone com correspondência única.
- Registra mensagem + memória comercial.
- Pode avançar objetivamente Novo/Validado/Contatado -> Respondeu.
- Executa análise de intenção/objeção.
- Executa extração automática de requisitos para `sales_match_profile`.
- Se o lead for `buyer`, atualiza `lji_buyers` somente nos critérios explicitamente confirmados pelo cliente.

Secrets: `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `LJI_WORKSPACE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (opcional para fallback), `ANTHROPIC_MODEL` (opcional).
