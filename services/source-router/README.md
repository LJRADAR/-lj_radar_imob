# LJI Source Router

Backend de coleta por fonte para o LJ Radar Imob. O serviço não grava no Supabase e não recebe `service_role`; ele apenas consulta fontes autorizadas e devolve resultados normalizados para a Edge Function do Supabase persistir.

## Endpoints

- `GET /health` — saúde e fontes configuradas.
- `POST /collect` — coleta autenticada por `Authorization: Bearer <LJI_SOURCE_ROUTER_TOKEN>`.

## Primeira fonte: Mercado Livre Imóveis

Usa a API oficial. O adaptador descobre dinamicamente a árvore de categorias de Imóveis do Brasil, escolhe tipo de imóvel + operação e filtra estritamente a cidade/região operacional antes de devolver resultados.

Variáveis:
- `LJI_SOURCE_ROUTER_TOKEN`
- `MERCADOLIVRE_ACCESS_TOKEN`
- `SOURCE_REQUEST_TIMEOUT_MS` (opcional)
- `PORT` (Render define automaticamente)

Nenhuma credencial deve ser commitada no GitHub.
