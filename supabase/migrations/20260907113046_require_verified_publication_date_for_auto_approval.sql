-- Auto-approval must prove that the source publication date is real and within the 365-day validity window.
-- Unknown publication dates remain eligible for review, never for automatic approval.
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
