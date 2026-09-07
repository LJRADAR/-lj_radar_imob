create or replace function public.lji_is_professional_advertiser_classification(p_classification text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select public.lji_norm_text(coalesce(p_classification,'')) in ('broker','real estate agency','developer');
$function$;

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

create or replace function public.lji_sync_promoted_opportunities()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count integer;
begin
  insert into public.lji_opportunity_index (
    workspace_id,radar_opportunity_id,title,city,state_code,property_type,transaction_type,price,bedrooms,parking,area,source,source_url,published_at,
    radar_status,owner_confidence,quinto_status,raw_snapshot,fingerprint,contact_name,contact_phone,whatsapp_url,contact_method,neighborhood,address,cep
  )
  select
    cr.workspace_id,r.id::text,coalesce(li.title,r.title),p.city,p.state_code,p.property_type,li.transaction_type,li.price,
    p.bedrooms,p.parking_spaces,p.area_m2,coalesce(s.name,'Radar LJ V2'),li.original_url,li.published_at,
    case when r.metadata->'enrichment'->>'advertiser_classification'='confirmed_owner' then 'owner_confirmed' else 'review' end,
    case when r.metadata->'enrichment'->>'advertiser_classification'='confirmed_owner' then 95
         when r.metadata->'enrichment'->>'advertiser_classification'='probable_owner' then 80
         else 60 end,'pending_verification',
    jsonb_build_object(
      'radar_discovery_id',r.id,
      'collector_run_id',cr.id,
      'property_id',p.id,
      'listing_id',li.id,
      'enrichment',r.metadata->'enrichment',
      'advertiser_classification',r.metadata->'enrichment'->>'advertiser_classification',
      'price_confidence',r.metadata->'enrichment'->>'price_confidence',
      'neighborhood',p.neighborhood,
      'address',coalesce(p.canonical_address,concat_ws(' ',p.street,p.street_number)),
      'cep',p.postal_code
    ),
    md5(coalesce(li.original_url,r.normalized_url,r.id::text)),c.display_name,c.phone_normalized,
    case when c.whatsapp_status in ('confirmed','probable') and c.phone_normalized is not null
      then 'https://wa.me/'||regexp_replace(c.phone_normalized,'\D','','g') else null end,
    case when c.phone_normalized is not null then 'Contato público do anúncio' else null end,
    p.neighborhood,coalesce(p.canonical_address,concat_ws(' ',p.street,p.street_number)),p.postal_code
  from public.lj_v2_raw_discoveries r
  join public.lj_v2_collector_runs cr on cr.id=r.latest_run_id and cr.workspace_id is not null
  join public.lj_v2_listings li on li.id=nullif(r.metadata->'enrichment'->>'listing_id','')::uuid
  join public.lj_v2_properties p on p.id=li.property_id
  left join public.lj_v2_sources s on s.id=li.source_id
  left join lateral (
    select cc.*
    from public.lj_v2_listing_contacts lc
    join public.lj_v2_contacts cc on cc.id=lc.contact_id
    where lc.listing_id=li.id and lc.relationship_type='advertiser' and lc.is_primary=true
    order by lc.confidence_score desc nulls last,lc.created_at asc
    limit 1
  ) c on true
  where r.metadata->'enrichment'->>'pipeline_outcome'='promoted'
    and lower(coalesce(s.name,'')) not in ('proprietário direto','proprietario direto')
    and not public.lji_is_professional_advertiser_classification(r.metadata->'enrichment'->>'advertiser_classification')
    and li.listing_status='active'
    and li.original_url is not null
    and public.lji_is_core_operational_city(p.city)
    and (li.published_at is null or li.published_at>=now()-interval '365 days')
    and not public.lji_is_operationally_excluded(concat_ws(' ',li.title,li.description,p.city,p.neighborhood,li.original_url,coalesce(r.metadata::text,'')))
    and not public.lji_is_low_quality_opportunity(li.title,li.original_url,coalesce(s.name,''))
    and lower(coalesce(li.title,'')) !~ '(comercial|sala comercial|galp[aã]o|loja|escrit[oó]rio)'
    and (
      lower(coalesce(p.property_type,'')) in ('apartamento','apartment','apto','casa','house','home','sobrado','studio','kitnet','cobertura','penthouse')
      or lower(coalesce(li.title,'')) ~ '(apartamento|apto|casa|sobrado|studio|kitnet|cobertura)'
    )
  on conflict (workspace_id,fingerprint) where fingerprint is not null do update set
    title=excluded.title,city=excluded.city,state_code=excluded.state_code,property_type=excluded.property_type,transaction_type=excluded.transaction_type,
    price=excluded.price,bedrooms=excluded.bedrooms,parking=excluded.parking,area=excluded.area,source=excluded.source,source_url=excluded.source_url,
    published_at=coalesce(excluded.published_at,lji_opportunity_index.published_at),owner_confidence=excluded.owner_confidence,
    raw_snapshot=coalesce(lji_opportunity_index.raw_snapshot,'{}'::jsonb)||excluded.raw_snapshot,
    contact_name=coalesce(excluded.contact_name,lji_opportunity_index.contact_name),contact_phone=coalesce(excluded.contact_phone,lji_opportunity_index.contact_phone),
    whatsapp_url=coalesce(excluded.whatsapp_url,lji_opportunity_index.whatsapp_url),contact_method=coalesce(excluded.contact_method,lji_opportunity_index.contact_method),
    neighborhood=coalesce(excluded.neighborhood,lji_opportunity_index.neighborhood),address=coalesce(excluded.address,lji_opportunity_index.address),
    cep=coalesce(excluded.cep,lji_opportunity_index.cep),updated_at=now();
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;
