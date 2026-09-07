create or replace function public.lji_norm_text(p_text text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select trim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(p_text,'')), U&'[\0300-\036f]', '', 'g'),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[^a-z0-9]+',' ','g'
  ));
$function$;
