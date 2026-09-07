create or replace function public.lji_sync_manual_capture_opportunity(
  p_workspace_id uuid,
  p_discovery_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lji_opportunity_index%rowtype;
  v_reason text;
begin
  if p_workspace_id is null or p_discovery_id is null then
    return jsonb_build_object('ok',false,'status','invalid_input');
  end if;

  if not exists (
    select 1
    from public.lji_workspaces w
    where w.id = p_workspace_id
  ) then
    return jsonb_build_object('ok',false,'status','workspace_not_found');
  end if;

  with candidate as (
    select
      r.id as discovery_id,
      li.id as listing_id,
      li.property_id,
      li.title,
      li.description,
      li.transaction_type,
      li.price,
      li.original_url,
      li.published_at,
      li.listing_status,
      p.state_code,
      p.city,
      p.neighborhood,
      p.property_type,
      p.bedrooms,
      p.parking_spaces,
      p.area_m2,
      p.canonical_address,
      p.street,
      p.street_number,
      p.postal_code,
      p.main_image_url,
      s.name as source_name,
      r.metadata,
      r.raw_payload,
      c.display_name as contact_name,
      c.phone_normalized as contact_phone,
      c.whatsapp_status,
      r.metadata->'enrichment'->>'advertiser_classification' as advertiser_classification
    from public.lj_v2_raw_discoveries r
    join public.lj_v2_listings li
      on li.id = nullif(r.metadata->'enrichment'->>'listing_id','')::uuid
    join public.lj_v2_properties p on p.id = li.property_id
    left join public.lj_v2_sources s on s.id = li.source_id
    left join lateral (
      select cc.*
      from public.lj_v2_listing_contacts lc
      join public.lj_v2_contacts cc on cc.id = lc.contact_id
      where lc.listing_id = li.id
        and lc.relationship_type = 'advertiser'
        and lc.is_primary = true
      order by lc.confidence_score desc nulls last, lc.created_at asc
      limit 1
    ) c on true
    where r.id = p_discovery_id
      and r.metadata->'enrichment'->>'pipeline_outcome' = 'promoted'
  ), eligible as (
    select c.*
    from candidate c
    where lower(coalesce(c.source_name,'')) not in ('proprietário direto','proprietario direto')
      and not public.lji_is_professional_advertiser_classification(c.advertiser_classification)
      and c.listing_status = 'active'
      and c.original_url is not null
      and public.lji_is_core_operational_city(c.city)
      and (c.published_at is null or (c.published_at >= now() - interval '365 days' and c.published_at <= now() + interval '1 day'))
      and not public.lji_is_operationally_excluded(concat_ws(' ',c.title,c.description,c.city,c.neighborhood,c.original_url,coalesce(c.metadata::text,'')))
      and not public.lji_is_low_quality_opportunity(c.title,c.original_url,coalesce(c.source_name,''))
      and lower(coalesce(c.title,'')) !~ '(comercial|sala comercial|galp[aã]o|loja|escrit[oó]rio)'
      and (
        lower(coalesce(c.property_type,'')) in ('apartamento','apartment','apto','casa','house','home','sobrado','studio','kitnet','cobertura','penthouse')
        or lower(coalesce(c.title,'')) ~ '(apartamento|apto|casa|sobrado|studio|kitnet|cobertura)'
      )
  )
  insert into public.lji_opportunity_index (
    workspace_id,radar_opportunity_id,title,city,state_code,property_type,transaction_type,price,
    bedrooms,parking,area,source,source_url,published_at,radar_status,owner_confidence,quinto_status,
    raw_snapshot,fingerprint,contact_name,contact_phone,whatsapp_url,contact_method,neighborhood,address,cep,image_url
  )
  select
    p_workspace_id,
    e.discovery_id::text,
    e.title,
    e.city,
    coalesce(e.state_code,'SP'),
    e.property_type,
    e.transaction_type,
    e.price,
    e.bedrooms,
    e.parking_spaces,
    e.area_m2,
    coalesce(e.source_name,'Captura manual'),
    e.original_url,
    e.published_at,
    'review',
    case when e.advertiser_classification='confirmed_owner' then 95
         when e.advertiser_classification='probable_owner' then 80
         else 60 end,
    'inconclusive',
    jsonb_build_object(
      'radar_discovery_id',e.discovery_id,
      'property_id',e.property_id,
      'listing_id',e.listing_id,
      'enrichment',e.metadata->'enrichment',
      'advertiser_classification',e.advertiser_classification,
      'price_confidence',e.metadata->'enrichment'->>'price_confidence',
      'manual_capture',true,
      'manual_workspace_id',p_workspace_id,
      'capture_source',coalesce(e.raw_payload->>'source','manual_paste')
    ),
    md5(coalesce(e.original_url,e.discovery_id::text)),
    e.contact_name,
    e.contact_phone,
    case when e.whatsapp_status in ('confirmed','probable') and e.contact_phone is not null
      then 'https://wa.me/'||regexp_replace(e.contact_phone,'\D','','g') else null end,
    case when e.contact_phone is not null then 'Contato público do anúncio' else null end,
    e.neighborhood,
    coalesce(e.canonical_address,concat_ws(' ',e.street,e.street_number)),
    e.postal_code,
    e.main_image_url
  from eligible e
  on conflict (workspace_id,fingerprint) where fingerprint is not null do update set
    title=excluded.title,
    city=excluded.city,
    state_code=excluded.state_code,
    property_type=excluded.property_type,
    transaction_type=excluded.transaction_type,
    price=excluded.price,
    bedrooms=excluded.bedrooms,
    parking=excluded.parking,
    area=excluded.area,
    source=excluded.source,
    source_url=excluded.source_url,
    published_at=coalesce(excluded.published_at,lji_opportunity_index.published_at),
    radar_status=case when lji_opportunity_index.radar_status='rejected' then 'rejected' else 'review' end,
    owner_confidence=excluded.owner_confidence,
    raw_snapshot=coalesce(lji_opportunity_index.raw_snapshot,'{}'::jsonb)||excluded.raw_snapshot,
    contact_name=coalesce(excluded.contact_name,lji_opportunity_index.contact_name),
    contact_phone=coalesce(excluded.contact_phone,lji_opportunity_index.contact_phone),
    whatsapp_url=coalesce(excluded.whatsapp_url,lji_opportunity_index.whatsapp_url),
    contact_method=coalesce(excluded.contact_method,lji_opportunity_index.contact_method),
    neighborhood=coalesce(excluded.neighborhood,lji_opportunity_index.neighborhood),
    address=coalesce(excluded.address,lji_opportunity_index.address),
    cep=coalesce(excluded.cep,lji_opportunity_index.cep),
    image_url=coalesce(excluded.image_url,lji_opportunity_index.image_url),
    updated_at=now()
  returning * into v_row;

  if v_row.id is not null then
    return jsonb_build_object(
      'ok',true,
      'status','review_indexed',
      'opportunity_id',v_row.id,
      'radar_status',v_row.radar_status,
      'geo_verified',coalesce((v_row.raw_snapshot->>'geo_verified')::boolean,false)
    );
  end if;

  select case
    when not exists (
      select 1 from public.lj_v2_raw_discoveries r
      where r.id=p_discovery_id and r.metadata->'enrichment'->>'pipeline_outcome'='promoted'
    ) then 'discovery_not_promoted'
    when exists (
      select 1
      from public.lj_v2_raw_discoveries r
      join public.lj_v2_listings li on li.id=nullif(r.metadata->'enrichment'->>'listing_id','')::uuid
      join public.lj_v2_properties p on p.id=li.property_id
      where r.id=p_discovery_id and not public.lji_is_core_operational_city(p.city)
    ) then 'outside_core_scope'
    else 'quality_gate_rejected'
  end into v_reason;

  return jsonb_build_object('ok',false,'status',v_reason);
end;
$$;

revoke all on function public.lji_sync_manual_capture_opportunity(uuid,uuid) from public, anon, authenticated;
grant execute on function public.lji_sync_manual_capture_opportunity(uuid,uuid) to service_role;
