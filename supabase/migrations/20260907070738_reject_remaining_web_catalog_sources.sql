create or replace function public.lji_is_low_quality_opportunity(p_title text, p_source_url text, p_source text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select
    coalesce(p_source_url,'') ~* '(rentola\.com|waa2\.com|achoumudou\.com|mgfimoveis\.com|proprietariodireto\.com\.br|vivareal\.com|zapimoveis\.com|imovelweb\.com|chavesnamao\.com|wimoveis\.com|quintoandar\.com|lista\.mercadolivre\.com\.br|imoveis\.mercadolivre\.com\.br|booking\.com)'
    or public.lji_norm_text(coalesce(p_title,'')) ~ '(imobiliaria|negocios imobiliarios|corretor|corretora|creci|consultor imobiliario|consultoria imobiliaria|assessoria imobiliaria|construtora|incorporadora|incorporador)'
    or public.lji_norm_text(coalesce(p_title,'')) ~ '(sala comercial|galpao|loja|escritorio|imovel comercial|casa comercial)'
    or public.lji_norm_text(concat_ws(' ',p_source,p_title)) ~ '(leilao|leiloes|portal zuk)'
    or public.lji_norm_text(coalesce(p_title,'')) ~ '(cobertura de bolo|cobertura para bolo|cobertura de chocolate|chocolate x cobertura|chocolate ou cobertura|confeitaria|masterchef|receita.{0,40}cobertura|cobertura jornalistica|cobertura de evento|cobertura do evento)'
    or public.lji_norm_text(coalesce(p_title,'')) ~ '(guia passo a passo.{0,80}(airbnb|alugar|apartamento)|como alugar meu apartamento no airbnb)'
    or (
      public.lji_norm_text(coalesce(p_source,'')) = 'web aberta com contato'
      and (
        public.lji_norm_text(coalesce(p_title,'')) ~ '^(apartamentos|aptos|kitnets|lofts|imoveis|casas)( |/).*(venda|aluguel|alugar|minha casa|minha vida)'
        or public.lji_norm_text(coalesce(p_title,'')) ~ '^(venda|aluguel) de (apartamentos|aptos|kitnets|lofts|imoveis|casas)'
      )
    )
    or (
      public.lji_norm_text(coalesce(p_source,'')) = 'instagram publico'
      and public.lji_norm_text(split_part(lower(coalesce(p_title,'')), ' no instagram:', 1)) ~ '(imoveis|empreendimentos|incorporacoes|real estate|properties|gestao de imoveis|investimentos imobiliarios|ltda)'
    )
    or (
      public.lji_norm_text(coalesce(p_source,'')) = 'instagram publico'
      and not public.lji_has_strong_instagram_offer(p_title)
    );
$function$;
