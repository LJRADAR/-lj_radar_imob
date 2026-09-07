-- Scope legacy SECURITY DEFINER data RPCs to workspaces available to the caller.
-- Preserve compatibility while preventing cross-workspace data exposure.

create or replace function public.lj_discarded_candidates(p_limit integer default 250)
returns table(discovery_id uuid, title text, url text, source text, city text, state_code text, transaction_type text, property_type text, price numeric, neighborhood text, advertiser_name text, rejection_reason text, last_seen_at timestamptz, published_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public','auth'
as $function$
begin
  if auth.uid() is null or not public.lj_is_manager_or_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  with allowed_workspaces as (
    select distinct m.workspace_id
    from public.lji_workspace_members m
    where m.user_id = auth.uid() and m.is_active = true
  )
  select
    d.id as discovery_id,
    d.title::text,
    d.original_url::text as url,
    s.name::text as source,
    d.detected_city::text as city,
    d.detected_state_code::text as state_code,
    d.detected_transaction::text as transaction_type,
    d.detected_property_type::text as property_type,
    d.advertised_price::numeric as price,
    d.detected_neighborhood::text as neighborhood,
    d.advertiser_hint::text as advertiser_name,
    coalesce(
      nullif(d.metadata #>> '{enrichment,rejection_reason}', ''),
      nullif(d.metadata #>> '{enrichment,error}', ''),
      'not_promoted'
    )::text as rejection_reason,
    d.last_seen_at::timestamptz,
    d.published_at::timestamptz
  from public.lj_v2_raw_discoveries d
  join public.lj_v2_collector_runs cr on cr.id = d.latest_run_id
  join allowed_workspaces aw on aw.workspace_id = cr.workspace_id
  left join public.lj_v2_sources s on s.id = d.source_id
  where d.metadata ? 'enrichment'
    and (
      d.metadata #>> '{enrichment,pipeline_outcome}' = 'not_promoted'
      or d.discovery_status = 'rejected'
    )
  order by d.last_seen_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 250), 500));
end;
$function$;

create or replace function public.lj_property_matches(p_limit integer default 100)
returns table(intention_id bigint, intent_type text, contact_name text, contact_phone text, source_name text, source_url text, raw_text text, urgency text, intention_confidence integer, opportunity_id bigint, opportunity_title text, opportunity_city text, opportunity_state_code text, opportunity_neighborhood text, opportunity_property_type text, opportunity_transaction text, opportunity_price numeric, opportunity_bedrooms integer, opportunity_area_m2 numeric, opportunity_image_url text, opportunity_link text, match_score integer, match_reason text)
language plpgsql
stable security definer
set search_path to 'public','auth'
as $function$
begin
  if auth.uid() is null or public.lj_current_role() is null or public.lj_current_role() = 'visitor'::public.lj_user_role then
    raise exception 'Not authorized';
  end if;

  return query
  with allowed_workspaces as (
    select distinct m.workspace_id
    from public.lji_workspace_members m
    where m.user_id = auth.uid() and m.is_active = true
  ), allowed_users as (
    select distinct m.user_id
    from public.lji_workspace_members m
    join allowed_workspaces aw on aw.workspace_id = m.workspace_id
    where m.is_active = true
  ), candidates as (
    select
      d.*,
      o.id as opp_id,
      o.title as opp_title,
      o.city as opp_city,
      o.state_code as opp_state,
      o.neighborhood as opp_neighborhood,
      o.property_type as opp_type,
      lower(coalesce(o.transaction,'')) as opp_transaction,
      o.price as opp_price,
      o.bedrooms as opp_bedrooms,
      o.area_m2 as opp_area,
      o.image_url as opp_image,
      o.link as opp_link,
      public.lj_text_array_contains_ci(d.target_cities,o.city) as city_ok,
      public.lj_text_array_contains_ci(
        case when nullif(btrim(coalesce(d.property_type,'')),'') is null then '{}'::text[] else array[d.property_type] end,
        o.property_type
      ) as type_ok,
      (d.min_price is null or o.price >= d.min_price) and (d.max_price is null or o.price <= d.max_price) as price_ok,
      (d.min_bedrooms is null or coalesce(o.bedrooms,0) >= d.min_bedrooms) as bedrooms_ok,
      (d.min_area_m2 is null or coalesce(o.area_m2,0) >= d.min_area_m2)
        and (d.max_area_m2 is null or coalesce(o.area_m2,0) <= d.max_area_m2) as area_ok,
      (d.min_parking is null or coalesce(o.parking_spaces,0) >= d.min_parking) as parking_ok
    from public.lj_match_intentions d
    join public.oportunidades_lj o
      on o.approved_for_pipeline = true
     and (
       (d.intent_type = 'buy' and lower(coalesce(o.transaction,'')) in ('sale','venda'))
       or (d.intent_type = 'rent' and lower(coalesce(o.transaction,'')) in ('rent','locacao','locação'))
     )
    where d.status in ('active','matched','contacted')
      and d.intent_type in ('buy','rent')
      and (
        d.created_by = auth.uid()
        or d.assigned_to = auth.uid()
        or (
          public.lj_is_manager_or_admin()
          and exists (
            select 1 from allowed_users au
            where au.user_id = d.created_by or au.user_id = d.assigned_to
          )
        )
      )
      and exists (
        select 1
        from public.lji_opportunity_index oi
        join allowed_workspaces aw on aw.workspace_id = oi.workspace_id
        where o.listing_id is not null
          and oi.raw_snapshot->>'listing_id' = o.listing_id::text
      )
  ), scored as (
    select c.*,
      (
        35
        + case when cardinality(c.target_cities) > 0 and c.city_ok then 20 when cardinality(c.target_cities)=0 then 6 else 0 end
        + case when nullif(btrim(coalesce(c.property_type,'')),'') is not null and c.type_ok then 15 when nullif(btrim(coalesce(c.property_type,'')),'') is null then 5 else 0 end
        + case when (c.min_price is not null or c.max_price is not null) and c.price_ok then 15 when c.min_price is null and c.max_price is null then 5 else 0 end
        + case when c.min_bedrooms is not null and c.bedrooms_ok then 5 when c.min_bedrooms is null then 2 else 0 end
        + case when (c.min_area_m2 is not null or c.max_area_m2 is not null) and c.area_ok then 5 when c.min_area_m2 is null and c.max_area_m2 is null then 2 else 0 end
        + case when c.min_parking is not null and c.parking_ok then 3 when c.min_parking is null then 1 else 0 end
        + case c.urgency when 'urgent' then 5 when 'high' then 3 else 0 end
      )::integer as computed_score
    from candidates c
    where c.city_ok and c.type_ok and c.price_ok and c.bedrooms_ok and c.area_ok and c.parking_ok
  )
  select
    s.id,
    s.intent_type,
    s.contact_name,
    s.contact_phone,
    s.source_name,
    s.source_url,
    s.raw_text,
    s.urgency,
    s.confidence_score,
    s.opp_id,
    s.opp_title::text,
    s.opp_city::text,
    s.opp_state::text,
    s.opp_neighborhood::text,
    s.opp_type::text,
    s.opp_transaction::text,
    s.opp_price::numeric,
    s.opp_bedrooms::integer,
    s.opp_area::numeric,
    s.opp_image::text,
    s.opp_link::text,
    least(100,s.computed_score),
    concat_ws(' · ',
      case when cardinality(s.target_cities)>0 then 'cidade compatível' else 'cidade aberta' end,
      case when nullif(btrim(coalesce(s.property_type,'')),'') is not null then 'tipo compatível' else 'tipo aberto' end,
      case when s.min_price is not null or s.max_price is not null then 'faixa de valor compatível' else 'faixa de valor aberta' end,
      case when s.min_bedrooms is not null then 'dormitórios compatíveis' end,
      case when s.min_area_m2 is not null or s.max_area_m2 is not null then 'área compatível' end,
      case when s.urgency in ('high','urgent') then 'intenção com alta urgência' end
    )::text
  from scored s
  order by least(100,s.computed_score) desc, s.created_at desc, coalesce(s.opp_price,0) desc
  limit greatest(1, least(coalesce(p_limit,100),500));
end;
$function$;

revoke all on function public.lj_discarded_candidates(integer) from public, anon;
revoke all on function public.lj_property_matches(integer) from public, anon;
grant execute on function public.lj_discarded_candidates(integer) to authenticated, service_role;
grant execute on function public.lj_property_matches(integer) to authenticated, service_role;
