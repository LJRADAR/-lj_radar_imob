-- Normalizes trusted Source Router payloads without fetching source URLs.
-- Automatic promotion is currently limited to official API payloads and OLX via Apify.

create or replace function public.lji_process_source_router_discoveries(p_discovery_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_raw jsonb;
  v_q jsonb;
  v_source text;
  v_city text;
  v_neighborhood text;
  v_state text;
  v_pt text;
  v_content text;
  v_reason text;
  v_status text;
  v_official boolean;
  v_apify boolean;
  v_task_norm boolean;
  v_exact boolean;
  v_owner_signal boolean;
  v_professional boolean;
  v_seller_type text;
  v_seller_name text;
  v_classification text;
  v_entity_type text;
  v_contact_conf smallint;
  v_price numeric;
  v_area numeric;
  v_bedrooms smallint;
  v_bathrooms smallint;
  v_parking smallint;
  v_postal text;
  v_image text;
  v_property_id uuid;
  v_listing_id uuid;
  v_contact_id uuid;
  v_phone_raw text;
  v_digits text;
  v_phone_norm text;
  v_ddd text;
  v_whatsapp text;
  v_whatsapp_status text;
  v_now timestamptz;
  v_selected integer := 0;
  v_promoted integer := 0;
  v_rejected integer := 0;
  v_prefiltered integer := 0;
  v_errors integer := 0;
begin
  if coalesce(array_length(p_discovery_ids,1),0)=0 then
    return jsonb_build_object('ok',true,'version','1.0.0','selected',0,'promoted',0,'rejected',0,'prefiltered',0,'errors',0,'external_fetch',false);
  end if;

  for r in
    select * from public.lj_v2_raw_discoveries
    where id = any(p_discovery_ids[1:30])
  loop
    v_selected := v_selected + 1;
    v_now := now();
    v_raw := coalesce(r.raw_payload,'{}'::jsonb);
    v_q := coalesce(v_raw->'raw_quality','{}'::jsonb);
    v_source := coalesce(nullif(v_raw->>'source_name',''), nullif(r.metadata->'source_router'->>'source_name',''), 'unknown');
    v_official := lower(coalesce(v_q->>'official_api','false'))='true';
    v_apify := lower(coalesce(v_q->>'apify','false'))='true';
    v_task_norm := lower(coalesce(v_q->>'task_normalized','false'))='true';
    v_exact := lower(coalesce(v_q->>'exact_city_or_zone','false'))='true';
    v_owner_signal := lower(coalesce(v_q->>'owner_signal','false'))='true';
    v_reason := null;
    v_status := 'prefiltered';

    if not (v_official or (v_apify and v_task_norm)) then
      v_reason := 'untrusted_source_payload';
    elsif not public.lji_is_safe_external_url(r.original_url) then
      v_reason := 'unsafe_source_url';
      v_status := 'rejected';
    elsif r.published_at is not null and r.published_at < now() - interval '365 days' then
      v_reason := 'expired_over_365_days';
      v_status := 'rejected';
    end if;

    v_content := public.lji_norm_text(concat_ws(' ',v_raw->>'property_type',r.detected_property_type,r.title,r.snippet,v_raw->>'description'));
    v_pt := case
      when v_content ~ '\m(apartamento|apartamentos|apto|apartment)\M' then 'Apartamento'
      when v_content ~ '\m(casa|casas|sobrado|sobrados|house|home)\M' then 'Casa'
      when v_content ~ '\m(cobertura|coberturas|penthouse)\M' then 'Cobertura'
      when v_content ~ '\m(studio|studios|kitnet|kitnets|flat)\M' then 'Studio'
      when v_content ~ '(sala comercial|galpao|loja|escritorio|terreno|lote|fazenda|sitio|chacara)' then 'Não residencial'
      else null end;

    if v_reason is null and (v_pt is null or v_pt not in ('Apartamento','Casa','Cobertura','Studio')) then
      v_reason := 'non_residential_or_unconfirmed_type';
      v_status := 'rejected';
    end if;

    v_seller_type := public.lji_norm_text(coalesce(v_raw->>'seller_type',v_raw->'attributes'->>'seller_type',''));
    v_seller_name := nullif(v_raw->>'seller_nickname','');
    v_content := public.lji_norm_text(concat_ws(' ',v_seller_name,r.title,r.snippet,v_raw->>'description',v_seller_type));
    v_professional := public.lji_is_professional_advertiser_text(
      v_seller_type, v_seller_name, v_raw->>'description'
    );

    if v_reason is null and v_professional then
      v_reason := 'professional_advertiser';
      v_status := 'rejected';
    end if;

    v_city := coalesce(nullif(v_raw->>'city',''),r.detected_city);
    v_state := upper(coalesce(nullif(v_raw->>'state_code',''),r.detected_state_code,'SP'));
    if v_reason is null and (v_state <> 'SP' or public.lji_norm_text(coalesce(v_city,'')) not in ('sao caetano do sul','santo andre','sao bernardo do campo','diadema','sao paulo')) then
      v_reason := 'location_outside_core_operation';
      v_status := 'rejected';
    end if;

    if v_reason is null and not v_exact then
      v_reason := 'location_not_verified';
      v_status := 'prefiltered';
    end if;

    if v_reason is null and not (v_official or (v_apify and v_source='OLX Imóveis')) then
      v_reason := 'source_not_enabled_for_payload_promotion';
      v_status := 'prefiltered';
    end if;

    if v_reason is not null then
      update public.lj_v2_raw_discoveries
      set discovery_status=v_status,
          metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('enrichment',jsonb_build_object(
            'function','lji_process_source_router_discoveries','version','1.0.0','completed_at',v_now,
            'pipeline_outcome','not_promoted','rejection_reason',v_reason,'source_name',v_source,
            'external_fetch',false,'retryable',false))
      where id=r.id;
      if v_status='rejected' then v_rejected:=v_rejected+1; else v_prefiltered:=v_prefiltered+1; end if;
      continue;
    end if;

    begin
      v_neighborhood := coalesce(nullif(v_raw->>'neighborhood',''),r.detected_neighborhood);
      v_price := case when r.advertised_price is not null and r.advertised_price>=0 then r.advertised_price else null end;
      v_area := case when coalesce(v_raw->>'area_m2','') ~ '^\d+(\.\d+)?$' then (v_raw->>'area_m2')::numeric else null end;
      v_bedrooms := case when coalesce(v_raw->>'bedrooms','') ~ '^\d+$' then least(100,(v_raw->>'bedrooms')::integer)::smallint else null end;
      v_bathrooms := case when coalesce(v_raw->>'bathrooms','') ~ '^\d+$' then least(100,(v_raw->>'bathrooms')::integer)::smallint else null end;
      v_parking := case when coalesce(v_raw->>'parking_spaces','') ~ '^\d+$' then least(100,(v_raw->>'parking_spaces')::integer)::smallint else null end;
      v_postal := nullif(regexp_replace(coalesce(v_raw->>'postal_code',v_raw->'attributes'->>'postal_code',''),'\D','','g'),'');
      v_image := case when public.lji_is_safe_external_url(coalesce(v_raw->>'main_image_url','')) then nullif(v_raw->>'main_image_url','') else null end;
      v_seller_name := nullif(v_raw->>'seller_nickname','');

      select id,property_id into v_listing_id,v_property_id
      from public.lj_v2_listings where original_url=r.original_url limit 1;

      if v_property_id is null then
        insert into public.lj_v2_properties(
          property_type,country_code,state_code,city,neighborhood,postal_code,area_m2,bedrooms,bathrooms,parking_spaces,main_image_url,current_status,last_seen_at,metadata
        ) values (
          v_pt,'BR',v_state,v_city,v_neighborhood,v_postal,v_area,v_bedrooms,v_bathrooms,v_parking,v_image,'active',v_now,
          jsonb_build_object('source_router_payload',jsonb_build_object('processor_version','1.0.0','discovery_id',r.id,'source_name',v_source,'external_fetch',false,'updated_at',v_now))
        ) returning id into v_property_id;
      else
        update public.lj_v2_properties set
          property_type=coalesce(v_pt,property_type), state_code=coalesce(v_state,state_code), city=coalesce(v_city,city),
          neighborhood=coalesce(v_neighborhood,neighborhood), postal_code=coalesce(v_postal,postal_code), area_m2=coalesce(v_area,area_m2),
          bedrooms=coalesce(v_bedrooms,bedrooms), bathrooms=coalesce(v_bathrooms,bathrooms), parking_spaces=coalesce(v_parking,parking_spaces),
          main_image_url=coalesce(v_image,main_image_url), current_status='active', last_seen_at=v_now,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_router_payload',jsonb_build_object('processor_version','1.0.0','discovery_id',r.id,'source_name',v_source,'external_fetch',false,'updated_at',v_now)),
          updated_at=v_now
        where id=v_property_id;
      end if;

      if v_listing_id is null then
        insert into public.lj_v2_listings(
          property_id,source_id,external_listing_id,original_url,title,description,transaction_type,price,advertised_city,advertised_neighborhood,advertiser_name,published_at,last_seen_at,listing_status,raw_data
        ) values (
          v_property_id,r.source_id,nullif(v_raw->>'source_item_id',''),r.original_url,coalesce(nullif(v_raw->>'title',''),r.title),coalesce(nullif(v_raw->>'description',''),r.snippet),
          case when r.detected_transaction='rent' then 'rent' else 'sale' end,v_price,v_city,v_neighborhood,v_seller_name,r.published_at,v_now,'active',
          jsonb_build_object('source_router_payload',jsonb_build_object('processor_version','1.0.0','discovery_id',r.id,'source_name',v_source,'provider',case when v_apify then 'apify' else 'official_api' end,'external_fetch',false,'updated_at',v_now))
        ) returning id into v_listing_id;
      else
        update public.lj_v2_listings set
          property_id=coalesce(property_id,v_property_id), source_id=coalesce(r.source_id,source_id), external_listing_id=coalesce(nullif(v_raw->>'source_item_id',''),external_listing_id),
          title=coalesce(nullif(v_raw->>'title',''),r.title,title), description=coalesce(nullif(v_raw->>'description',''),r.snippet,description),
          transaction_type=case when r.detected_transaction='rent' then 'rent' else 'sale' end, price=coalesce(v_price,price),
          advertised_city=coalesce(v_city,advertised_city), advertised_neighborhood=coalesce(v_neighborhood,advertised_neighborhood),
          advertiser_name=coalesce(v_seller_name,advertiser_name), published_at=coalesce(r.published_at,published_at), last_seen_at=v_now, listing_status='active',
          raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('source_router_payload',jsonb_build_object('processor_version','1.0.0','discovery_id',r.id,'source_name',v_source,'provider',case when v_apify then 'apify' else 'official_api' end,'external_fetch',false,'updated_at',v_now)),
          updated_at=v_now
        where id=v_listing_id;
      end if;

      v_classification := case
        when v_official and v_owner_signal then 'probable_owner'
        when v_seller_type in ('private','individual','pessoa fisica','person') then 'individual_unconfirmed'
        else 'not_identified' end;
      v_entity_type := case when v_seller_name is not null then 'person' else 'unknown' end;
      v_contact_conf := case when v_classification='probable_owner' then 85 when v_classification='individual_unconfirmed' then 65 else 50 end;
      v_phone_raw := nullif(v_raw->'attributes'->>'phone','');
      v_digits := regexp_replace(coalesce(v_phone_raw,''),'\D','','g');
      if left(v_digits,2)='55' and length(v_digits) in (12,13) then v_digits:=substr(v_digits,3); end if;
      if length(v_digits) in (10,11) then
        v_ddd:=substr(v_digits,1,2); v_phone_norm:='55'||v_digits;
      else
        v_ddd:=null; v_phone_norm:=null; v_phone_raw:=null;
      end if;
      v_whatsapp := nullif(v_raw->'attributes'->>'whatsapp','');
      v_whatsapp_status := case when v_whatsapp is not null then 'probable' when v_phone_norm is not null then 'not_confirmed' else 'not_found' end;
      v_contact_id := null;

      if v_seller_name is not null or v_phone_norm is not null then
        select contact_id into v_contact_id from public.lj_v2_listing_contacts
        where listing_id=v_listing_id and relationship_type='advertiser' and is_primary=true
        order by created_at asc limit 1;

        if v_contact_id is null then
          insert into public.lj_v2_contacts(
            display_name,entity_type,advertiser_classification,phone_raw,phone_normalized,ddd,whatsapp_status,whatsapp_evidence,contact_evidence,public_profile_url,discovered_source_id,last_seen_at,metadata
          ) values (
            v_seller_name,v_entity_type,v_classification,v_phone_raw,v_phone_norm,v_ddd,v_whatsapp_status,
            case when v_whatsapp is not null then 'WhatsApp signal supplied by source payload; not independently re-fetched.' else null end,
            case when v_classification='probable_owner' then 'Explicit first-person owner signal from official source.' when v_classification='individual_unconfirmed' then 'Source identifies a private/individual advertiser; ownership remains unconfirmed.' else 'Public advertiser identity from source payload; ownership unconfirmed.' end,
            r.original_url,r.source_id,v_now,
            jsonb_build_object('source_router_payload',jsonb_build_object('processor_version','1.0.0','discovery_id',r.id,'external_fetch',false,'updated_at',v_now))
          ) returning id into v_contact_id;
          insert into public.lj_v2_listing_contacts(listing_id,contact_id,relationship_type,is_primary,confidence_score,evidence)
          values(v_listing_id,v_contact_id,'advertiser',true,v_contact_conf,
            case when v_classification='probable_owner' then 'Explicit first-person owner signal from official source.' when v_classification='individual_unconfirmed' then 'Private/individual advertiser from source payload; ownership unconfirmed.' else 'Advertiser from source payload.' end)
          on conflict(listing_id,contact_id) do update set is_primary=true,confidence_score=excluded.confidence_score,evidence=excluded.evidence;
        else
          update public.lj_v2_contacts set
            display_name=coalesce(v_seller_name,display_name), entity_type=v_entity_type, advertiser_classification=v_classification,
            phone_raw=coalesce(v_phone_raw,phone_raw), phone_normalized=coalesce(v_phone_norm,phone_normalized), ddd=coalesce(v_ddd,ddd),
            whatsapp_status=v_whatsapp_status, last_seen_at=v_now,
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_router_payload',jsonb_build_object('processor_version','1.0.0','discovery_id',r.id,'external_fetch',false,'updated_at',v_now)),
            updated_at=v_now
          where id=v_contact_id;
        end if;
      end if;

      update public.lj_v2_raw_discoveries set
        discovery_status='accepted_for_enrichment', detected_property_type=v_pt, detected_city=v_city, detected_neighborhood=v_neighborhood,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('enrichment',jsonb_build_object(
          'function','lji_process_source_router_discoveries','version','1.0.0','completed_at',v_now,'pipeline_outcome','promoted',
          'promotion_reason','trusted_source_payload','listing_id',v_listing_id,'property_id',v_property_id,'contact_id',v_contact_id,
          'advertiser_classification',v_classification,'source_name',v_source,'external_fetch',false,'retryable',false,
          'price',v_price,'area_m2',v_area,'bedrooms',v_bedrooms,'parking_spaces',v_parking,'published_at',r.published_at))
      where id=r.id;
      v_promoted:=v_promoted+1;
    exception when others then
      v_errors:=v_errors+1;
      update public.lj_v2_raw_discoveries set
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_router_processor_error',jsonb_build_object('version','1.0.0','at',now(),'error',left(sqlerrm,300)))
      where id=r.id;
    end;
  end loop;

  return jsonb_build_object('ok',v_errors=0,'version','1.0.0','selected',v_selected,'promoted',v_promoted,'rejected',v_rejected,'prefiltered',v_prefiltered,'errors',v_errors,'external_fetch',false);
end;
$$;

revoke all on function public.lji_process_source_router_discoveries(uuid[]) from public;
revoke all on function public.lji_process_source_router_discoveries(uuid[]) from anon;
revoke all on function public.lji_process_source_router_discoveries(uuid[]) from authenticated;
grant execute on function public.lji_process_source_router_discoveries(uuid[]) to service_role;

create or replace function public.lji_process_source_router_discovery_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.raw_payload ? 'raw_quality'
     and (
       lower(coalesce(new.raw_payload->'raw_quality'->>'official_api','false'))='true'
       or lower(coalesce(new.raw_payload->'raw_quality'->>'apify','false'))='true'
     ) then
    perform public.lji_process_source_router_discoveries(array[new.id]);
  end if;
  return new;
end;
$$;

revoke all on function public.lji_process_source_router_discovery_trigger() from public;
revoke all on function public.lji_process_source_router_discovery_trigger() from anon;
revoke all on function public.lji_process_source_router_discovery_trigger() from authenticated;

drop trigger if exists lji_auto_process_source_router_payload on public.lj_v2_raw_discoveries;
create trigger lji_auto_process_source_router_payload
after insert or update of raw_payload on public.lj_v2_raw_discoveries
for each row execute function public.lji_process_source_router_discovery_trigger();
