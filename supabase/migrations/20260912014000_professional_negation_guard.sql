create or replace function public.lji_is_professional_advertiser_text(p_seller_type text, p_seller_name text, p_description text)
returns boolean language sql immutable set search_path to 'public' as $fn$
  select case
    when public.lji_norm_text(coalesce(p_seller_type,'')) in ('business','professional','company','loja','dealer') then true
    when public.lji_norm_text(coalesce(p_seller_name,'')) ~ '(imobiliaria|imoveis|corretor|corretora|creci|consultor imobiliario|incorporadora|construtora)' then true
    when public.lji_norm_text(coalesce(p_description,'')) ~ '(creci|imobiliaria|imoveis ltda|negocios imobiliarios|corretor|corretora|consultor imobiliario|incorporadora|construtora|empreendimentos imobiliarios)'
      and public.lji_norm_text(coalesce(p_description,'')) !~ '(sem( a)? (corretor|imobiliaria)|nao (aceito|aceita|aceitamos|quero|queremos|trabalho|trabalhamos)( com)? (corretor|imobiliaria)|direto com proprietario|proprietario direto|particular)' then true
    else false
  end
$fn$;
