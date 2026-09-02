# LJ Sales Agent v1

Supabase Edge Function para geração server-side de abordagem comercial com Claude.

## Secrets obrigatórios
- ANTHROPIC_API_KEY
- ANTHROPIC_MODEL (opcional; default no código)

As variáveis SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são fornecidas pelo ambiente Supabase.

## Deploy
supabase secrets set ANTHROPIC_API_KEY=SEU_SEGREDO
supabase functions deploy lji-sales-agent-v1

A função valida a sessão e confirma que o usuário pertence ao workspace antes de chamar a Anthropic. A chave nunca é enviada ao navegador.
