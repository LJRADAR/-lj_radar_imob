create or replace function private.lji_stage_raw_discovery_to_capture()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_workspace uuid;
  v_source text;
  v_payload jsonb := coalesce(new.raw_payload, '{}'::jsonb);
  v_phone text;
  v_whatsapp text;
  v_owner_direct boolean := false;
  v_transaction text;
  v_text text := lower(coalesce(new.title,'') || ' ' || coalesce(new.snippet,''));
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
  v_owner_direct := coalesce((new.metadata->'source_router'->>'owner_signal')::boolean, false)
    or v_text ~ '(proprietari|direto com o dono|sou o dono|minha casa|meu apartamento)';

  if lower(v_source) like '%facebook%' then
    if v_text ~ '(aluguel|alugo|aluga|loca[cç][aã]o|locar)' then v_transaction := 'rent';
    elsif v_text ~ '(vendo|vende|venda|à venda|a venda)' then v_transaction := 'sale';
    else v_transaction := null;
    end if;
  else
    v_transaction := new.detected_transaction;
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
$$;
