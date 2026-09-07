-- Quinto v4+ is positive-match-only. A confirmed Quinto match must never become an operational capture approval.
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
    and published_at is not null
    and published_at >= now()-interval '365 days'
    and published_at <= now()+interval '1 day'
    and coalesce(quinto_status,'inconclusive') <> 'found_on_quintoandar'
    and ((transaction_type='sale' and coalesce(price,0)>=200000) or (transaction_type='rent' and coalesce(price,0)>=1000))
    and not public.lji_is_operationally_excluded(concat_ws(' ', title, city, source, source_url, coalesce(raw_snapshot::text,'')))
    and not public.lji_is_low_quality_opportunity(title,source_url,source)
    and not public.lji_is_professional_advertiser_classification(coalesce(raw_snapshot->>'advertiser_classification', raw_snapshot->'enrichment'->>'advertiser_classification'))
    and not public.lji_opportunity_city_conflicts(city,title)
    and (lower(coalesce(property_type,'')) in ('apartamento','apartment','apto','casa','house','home','sobrado','studio','kitnet','cobertura','penthouse') or public.lji_norm_text(coalesce(title,'')) ~ '(apartamento|apto|casa|sobrado|studio|kitnet|cobertura)');
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.lji_sync_quinto_statuses()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count integer;
begin
  with latest as (
    select distinct on (listing_id) listing_id,status,approved_for_pipeline,confidence,checked_at,verifier_version,reason
    from public.lj_v2_quinto_checks
    where verifier_version like '4.%'
    order by listing_id,checked_at desc
  )
  update public.lji_opportunity_index o
  set quinto_status=l.status,
      radar_status=case when l.status='found_on_quintoandar' and o.radar_status='approved' then 'review' else o.radar_status end,
      raw_snapshot=(coalesce(o.raw_snapshot,'{}'::jsonb)-'quinto_legacy_result_invalidated'-'quinto_legacy_version'-'quinto_legacy_status') || jsonb_build_object('quinto_confidence',l.confidence,'quinto_checked_at',l.checked_at,'quinto_verifier_version',l.verifier_version,'quinto_reason',l.reason,'quinto_fail_closed',true,'quinto_found_blocks_approval',true),
      updated_at=now()
  from latest l
  where l.listing_id::text=o.raw_snapshot->>'listing_id';
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;
