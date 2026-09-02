# lji-sales-match-profile-v1

Extrai requisitos imobiliários explícitos de uma conversa real do WhatsApp e grava `sales_match_profile` em `lji_activity_log`.

- Exige usuário autenticado e membro ativo do workspace.
- Claude roda somente no servidor (`ANTHROPIC_API_KEY`).
- Sem chave ou falha do modelo: fallback conservador.
- Campos ausentes ficam `null`.
- Se o lead vinculado for `buyer`, atualiza `lji_buyers` somente nos campos presentes em `explicit_fields`.
- Não envia mensagens e não cria imóveis ou leads fictícios.
