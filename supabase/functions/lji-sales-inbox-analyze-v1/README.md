# lji-sales-inbox-analyze-v1

Analisa uma conversa real do Inbox Comercial vinculada a um lead real.

- Exige sessão autenticada e vínculo ativo no workspace.
- Busca mensagens em `lji_activity_log`.
- Usa `ANTHROPIC_API_KEY` server-side quando configurada.
- Se Claude estiver indisponível, usa classificação heurística explícita como fallback.
- Persiste `sales_inbox_analysis` e `whatsapp_lead_linked`.
- Nunca envia mensagem automaticamente.
