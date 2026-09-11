-- LJ Radar v3 operational ingest hardening.
-- Keeps Facebook transaction inference aligned with Source Router OCR and
-- moves qualified discovery persistence into one database transaction.

create or replace function private.lji_stage_raw_discovery_to_capture()
returns trigger
language plpgsql
set search_path to 'public','private'
as $function$
declare
  v_workspace uuid;
  v_source text;
  v_payload jsonb := coalesce(new.raw_payload, '{}'::jsonb);
  v_phone text;
  v_whatsapp text;
  v_owner_direct boolean := false;
  v_transaction text;
  v_text text;
begin
  select r.workspace_id into v_workspace
  from public.lj_v2_collector_runs r
  where r.id = new.latest_run_id;

  if v_workspace is null then return new; end if;

  v_source := coalesce(
    nullif(new.metadata->'source_router'->>'source_name',''),
    (select s.name from public.lj_v2_sources s where s.id = new.source_id),
    'Web aberta com contato'
  );

  v_phone := coalesce(nullif(v_payload->'attributes'->>'phone',''), nullif(v_payload->>'contact_phone',''));
  v_whatsapp := coalesce(nullif(v_payload->'attributes'->>'whatsapp',''), nullif(v_payload->>'whatsapp_url',''));

  v_text := lower(
    coalesce(new.title,'') || ' ' ||
    coalesce(new.snippet,'') || ' ' ||
    coalesce(v_payload->>'description','') || ' ' ||
    coalesce(v_payload->'attributes'->>'attachment_ocr_text','')
  );

  v_owner_direct := coalesce((new.metadata->'source_router'->>'owner_signal')::boolean, false)
    or v_text ~ '(proprietari|direto com o dono|sou o dono|minha casa|meu apartamento)';

  if lower(v_source) like '%facebook%' then
    if v_text ~ '(aluguel|alugo|aluga|aluga-se|loca[cç][aã]o|locar)' then
      v_transaction := 'rent';
    elsif v_text ~ '(vendo|vende|venda|à venda|a venda)' then
      v_transaction := 'sale';
    else
      v_transaction := new.detected_transaction;
    end if;
  else
    v_transaction := new.detected_transaction;
  end if;

  if v_transaction is null or v_transaction not in ('sale','rent') then
    return new;
  end if;

  insert into public.lji_discovered_leads (
    workspace_id, source, source_url, title, city, neighborhood,
    property_type, transaction_type, price, area, bedrooms, parking,
    published_at, image_url, contact_name, contact_phone, whatsapp_url,
    contact_method, contact_note, owner_direct, status, query_context,
    discovered_at, updated_at, address, cep
  ) values (
    v_workspace, v_source, new.original_url, new.title, new.detected_city,
    new.detected_neighborhood, new.detected_property_type, v_transaction,
    new.advertised_price, nullif(v_payload->>'area_m2','')::numeric,
    nullif(v_payload->>'bedrooms','')::integer, nullif(v_payload->>'parking_spaces','')::integer,
    new.published_at, nullif(v_payload->>'main_image_url',''),
    coalesce(nullif(v_payload->>'seller_nickname',''), nullif(new.advertiser_hint,'')),
    v_phone, v_whatsapp,
    case when v_whatsapp is not null then 'whatsapp' when v_phone is not null then 'phone' else null end,
    left(coalesce(new.snippet,''),1000), v_owner_direct, 'inbox',
    left(coalesce(new.snippet,''),3000), coalesce(new.first_seen_at,new.created_at,now()), now(),
    nullif(v_payload->>'address',''),
    coalesce(nullif(v_payload->>'postal_code',''), nullif(v_payload->'attributes'->>'postal_code',''))
  )
  on conflict (workspace_id, source_url) do update set
    source=excluded.source,
    title=coalesce(excluded.title,public.lji_discovered_leads.title),
    city=coalesce(excluded.city,public.lji_discovered_leads.city),
    neighborhood=coalesce(excluded.neighborhood,public.lji_discovered_leads.neighborhood),
    property_type=coalesce(excluded.property_type,public.lji_discovered_leads.property_type),
    transaction_type=coalesce(excluded.transaction_type,public.lji_discovered_leads.transaction_type),
    price=coalesce(excluded.price,public.lji_discovered_leads.price),
    area=coalesce(excluded.area,public.lji_discovered_leads.area),
    bedrooms=coalesce(excluded.bedrooms,public.lji_discovered_leads.bedrooms),
    parking=coalesce(excluded.parking,public.lji_discovered_leads.parking),
    published_at=coalesce(excluded.published_at,public.lji_discovered_leads.published_at),
    image_url=coalesce(excluded.image_url,public.lji_discovered_leads.image_url),
    contact_name=coalesce(excluded.contact_name,public.lji_discovered_leads.contact_name),
    contact_phone=coalesce(excluded.contact_phone,public.lji_discovered_leads.contact_phone),
    whatsapp_url=coalesce(excluded.whatsapp_url,public.lji_discovered_leads.whatsapp_url),
    contact_method=coalesce(excluded.contact_method,public.lji_discovered_leads.contact_method),
    contact_note=coalesce(excluded.contact_note,public.lji_discovered_leads.contact_note),
    owner_direct=public.lji_discovered_leads.owner_direct or excluded.owner_direct,
    query_context=coalesce(excluded.query_context,public.lji_discovered_leads.query_context),
    updated_at=now(),
    address=coalesce(excluded.address,public.lji_discovered_leads.address),
    cep=coalesce(excluded.cep,public.lji_discovered_leads.cep);

  return new;
end;
$function$;

create or replace function public.lji_ingest_source_router_discovery(
  p_run_id uuid,
  p_item jsonb,
  p_position integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_run record;
  v_source_id uuid;
  v_source_name text;
  v_original_url text;
  v_existing record;
  v_discovery_id uuid;
  v_was_new boolean := false;
  v_now timestamptz := now();
  v_published_at timestamptz;
  v_price numeric;
  v_metadata jsonb;
  v_is_facebook boolean := false;
  v_city text;
  v_state text;
begin
  if p_run_id is null or p_item is null then raise exception 'ingest_missing_run_or_item'; end if;

  select * into v_run from public.lj_v2_collector_runs where id=p_run_id;
  if v_run.id is null then raise exception 'collector_run_not_found'; end if;

  v_original_url := nullif(trim(p_item->>'source_url'),'');
  if v_original_url is null or not public.lji_is_safe_external_url(v_original_url) then
    raise exception 'invalid_or_unsafe_source_url';
  end if;

  v_source_name := coalesce(nullif(p_item->>'source_name',''),'Web aberta com contato');
  v_is_facebook := lower(v_source_name) like '%facebook%';

  select id into v_source_id
  from public.lj_v2_sources
  where name=v_source_name and is_active=true
  limit 1;

  if v_source_id is null then
    select id into v_source_id
    from public.lj_v2_sources
    where name='Web aberta com contato' and is_active=true
    limit 1;
  end if;

  if v_is_facebook then
    -- Never inherit the requested run target when Facebook supplied no city.
    v_city := nullif(p_item->>'city','');
    v_state := case when v_city is not null then coalesce(nullif(p_item->>'state_code',''),'SP') else null end;
  else
    v_city := coalesce(nullif(p_item->>'city',''),v_run.city);
    v_state := coalesce(nullif(p_item->>'state_code',''),v_run.state_code);
  end if;

  begin v_published_at := nullif(p_item->>'published_at','')::timestamptz;
  exception when others then v_published_at := null; end;
  begin v_price := nullif(p_item->>'price','')::numeric;
  exception when others then v_price := null; end;

  select id,occurrence_count,metadata into v_existing
  from public.lj_v2_raw_discoveries
  where original_url=v_original_url
  limit 1
  for update;

  v_metadata := coalesce(v_existing.metadata,'{}'::jsonb) || jsonb_build_object(
    'source_router',jsonb_build_object(
      'source_name',v_source_name,
      'source_item_id',nullif(p_item->>'source_item_id',''),
      'provider',case when coalesce((p_item->'raw_quality'->>'apify')::boolean,false) then 'apify'
                      when coalesce((p_item->'raw_quality'->>'official_api')::boolean,false) then 'official_api'
                      else 'source_router' end,
      'official_api',coalesce((p_item->'raw_quality'->>'official_api')::boolean,false),
      'apify',coalesce((p_item->'raw_quality'->>'apify')::boolean,false),
      'exact_city_or_zone',coalesce((p_item->'raw_quality'->>'exact_city_or_zone')::boolean,false),
      'owner_signal',coalesce((p_item->'raw_quality'->>'owner_signal')::boolean,false),
      'collected_at',v_now::text,
      'collector_version','6.5.1-db-ingest',
      'router_auth','hmac-sha256-v1'
    )
  );

  if v_existing.id is null then
    insert into public.lj_v2_raw_discoveries(
      source_id,original_url,normalized_url,url_hash,title,snippet,advertised_price,
      detected_state_code,detected_city,detected_neighborhood,detected_transaction,
      detected_property_type,advertiser_hint,published_at,discovery_status,last_seen_at,
      latest_run_id,raw_payload,metadata
    ) values (
      v_source_id,v_original_url,v_original_url,md5(v_original_url),
      nullif(p_item->>'title',''),coalesce(nullif(p_item->>'description',''),nullif(p_item->>'title','')),v_price,
      v_state,v_city,nullif(p_item->>'neighborhood',''),
      coalesce(nullif(p_item->>'transaction_type',''),v_run.transaction_type),
      coalesce(nullif(p_item->>'property_type',''),v_run.property_type_code),
      nullif(p_item->>'seller_nickname',''),v_published_at,'raw',v_now,p_run_id,p_item,v_metadata
    ) returning id into v_discovery_id;
    v_was_new := true;
  else
    v_discovery_id := v_existing.id;
    update public.lj_v2_raw_discoveries set
      source_id=coalesce(v_source_id,source_id),
      title=coalesce(nullif(p_item->>'title',''),title),
      snippet=coalesce(nullif(p_item->>'description',''),snippet),
      advertised_price=coalesce(v_price,advertised_price),
      detected_state_code=case when v_is_facebook then v_state else coalesce(v_state,detected_state_code,v_run.state_code) end,
      detected_city=case when v_is_facebook then v_city else coalesce(v_city,detected_city,v_run.city) end,
      detected_neighborhood=coalesce(nullif(p_item->>'neighborhood',''),detected_neighborhood),
      detected_transaction=coalesce(nullif(p_item->>'transaction_type',''),detected_transaction,v_run.transaction_type),
      detected_property_type=coalesce(nullif(p_item->>'property_type',''),detected_property_type,v_run.property_type_code),
      advertiser_hint=coalesce(nullif(p_item->>'seller_nickname',''),advertiser_hint),
      published_at=coalesce(v_published_at,published_at),
      last_seen_at=v_now,
      latest_run_id=p_run_id,
      raw_payload=p_item,
      metadata=v_metadata,
      occurrence_count=greatest(1,coalesce(v_existing.occurrence_count,1))+1
    where id=v_discovery_id;
  end if;

  insert into public.lj_v2_collector_run_discoveries(
    run_id,discovery_id,query_text,result_position,relevance_score,was_new
  ) values (
    p_run_id,v_discovery_id,'source_router:'||v_source_name,greatest(1,coalesce(p_position,1)),null,v_was_new
  )
  on conflict (run_id,discovery_id) do update set
    result_position=excluded.result_position,
    was_new=excluded.was_new;

  return jsonb_build_object(
    'saved',true,
    'was_new',v_was_new,
    'discovery_id',v_discovery_id,
    'source',v_source_name
  );
end;
$function$;

revoke all on function public.lji_ingest_source_router_discovery(uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.lji_ingest_source_router_discovery(uuid,jsonb,integer) to service_role;
