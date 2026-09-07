create or replace function public.lji_geo_target_evidenced(p_city text, p_source_text text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  with x as (
    select public.lji_norm_text(coalesce(p_city,'')) as c,
           public.lji_norm_text(coalesce(p_source_text,'')) as t
  )
  select case
    when c='diadema' then t ~ '(^| )diadema( |$)'
    when c='santo andre' then t ~ '(^| )santo andre( |$)'
    when c='sao bernardo do campo' then t ~ '(^| )(sao bernardo( do campo)?|sbc)( |$)'
    when c='sao caetano do sul' then t ~ '(^| )(sao caetano( do sul)?|scs)( |$)'
    when c='sao paulo' then t ~ '(^| )sao paulo( |$)'
    when c='sao paulo zona norte' then t ~ '(^| )(zona norte|santana|tucuruvi|vila guilherme|casa verde|mandaqui|parada inglesa|jardim sao paulo|jacana|tremembe|limao|imirim|vila maria)( |$)'
    when c='sao paulo zona sul' then t ~ '(^| )(zona sul|moema|vila mariana|saude|jabaquara|campo belo|santo amaro|brooklin|interlagos|ipiranga|sacoma|morumbi|chacara santo antonio|vila clementino|campo limpo|jardim patente|vila andrade)( |$)'
    when c='sao paulo zona leste' then t ~ '(^| )(zona leste|tatuape|mooca|vila prudente|penha|carrao|itaquera|vila formosa|sao mateus|vila matilde|analia franco|belem)( |$)'
    when c='sao paulo zona oeste' then t ~ '(^| )(zona oeste|pinheiros|perdizes|lapa|pompeia|vila madalena|alto de pinheiros|butanta|vila romana|barra funda|jardins|sumare)( |$)'
    when c='sao paulo centro expandido' then t ~ '(^| )(centro expandido|republica|bela vista|consolacao|liberdade|cambuci|santa cecilia|bom retiro|bras|pari|aclimacao|higienopolis|cerqueira cesar|paraiso)( |$)'
    else false
  end
  from x;
$function$;

create or replace function public.lji_set_opportunity_geo_verification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_discovery_id uuid;
  v_title text;
  v_snippet text;
  v_metadata jsonb;
  v_verified boolean := false;
  v_evidence text := 'not_verified';
begin
  if coalesce(new.raw_snapshot->'geo_correction'->>'geo_verified','false')='true' then
    v_verified := true;
    v_evidence := 'explicit_geo_correction';
  else
    begin
      v_discovery_id := nullif(new.raw_snapshot->>'radar_discovery_id','')::uuid;
    exception when invalid_text_representation then
      v_discovery_id := null;
    end;

    if v_discovery_id is not null then
      select r.title,r.snippet,r.metadata into v_title,v_snippet,v_metadata
      from public.lj_v2_raw_discoveries r
      where r.id=v_discovery_id
      limit 1;

      if coalesce((v_metadata->'source_router'->>'exact_city_or_zone')::boolean,false) then
        v_verified := true;
        v_evidence := 'source_router_exact_city_or_zone';
      elsif coalesce(v_metadata->'geo_correction'->>'city','')=coalesce(new.city,'') then
        v_verified := true;
        v_evidence := 'discovery_geo_correction';
      elsif public.lji_geo_target_evidenced(new.city,concat_ws(' ',v_title,v_snippet)) then
        v_verified := true;
        v_evidence := 'source_text_city_or_zone';
      end if;
    end if;
  end if;

  new.raw_snapshot := coalesce(new.raw_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'geo_verified',v_verified,
      'geo_evidence',v_evidence,
      'geo_checked_at',now()
    );
  return new;
end;
$function$;

drop trigger if exists trg_lji_set_opportunity_geo_verification on public.lji_opportunity_index;
create trigger trg_lji_set_opportunity_geo_verification
before insert or update of city,title,raw_snapshot on public.lji_opportunity_index
for each row execute function public.lji_set_opportunity_geo_verification();

create or replace function public.lji_auto_promote_opportunities()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count integer;
begin
  update public.lji_opportunity_index
  set radar_status='approved', updated_at=now()
  where radar_status='review'
    and transaction_type in ('sale','rent')
    and coalesce(city,'')<>''
    and public.lji_is_core_operational_city(city)
    and coalesce(raw_snapshot->>'geo_verified','false')='true'
    and (
      (transaction_type='sale' and coalesce(price,0)>=200000)
      or (transaction_type='rent' and coalesce(price,0)>=1000)
    )
    and not public.lji_is_operationally_excluded(concat_ws(' ', title, city, source, source_url, coalesce(raw_snapshot::text,'')))
    and not public.lji_is_low_quality_opportunity(title,source_url,source)
    and not public.lji_is_professional_advertiser_classification(
      coalesce(raw_snapshot->>'advertiser_classification', raw_snapshot->'enrichment'->>'advertiser_classification')
    )
    and not public.lji_opportunity_city_conflicts(city,title)
    and (
      lower(coalesce(property_type,'')) in ('apartamento','apartment','apto','casa','house','home','sobrado','studio','kitnet','cobertura','penthouse')
      or public.lji_norm_text(coalesce(title,'')) ~ '(apartamento|apto|casa|sobrado|studio|kitnet|cobertura)'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
