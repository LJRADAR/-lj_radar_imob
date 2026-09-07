create or replace function public.lji_auto_index_manual_capture_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_text text;
  v_workspace_id uuid;
  v_result jsonb;
begin
  if coalesce(new.metadata->>'provider','') <> 'manual_paste'
     and coalesce(new.raw_payload->>'source','') <> 'manual_paste' then
    return new;
  end if;

  if coalesce(new.metadata->'enrichment'->>'pipeline_outcome','') <> 'promoted' then
    return new;
  end if;

  v_workspace_text := coalesce(
    nullif(new.metadata->>'workspace_id',''),
    nullif(new.metadata->'search_context'->>'workspace_id',''),
    nullif(new.raw_payload->>'workspace_id','')
  );

  if v_workspace_text is null then
    return new;
  end if;

  begin
    v_workspace_id := v_workspace_text::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  v_result := public.lji_sync_manual_capture_opportunity(v_workspace_id,new.id);
  return new;
end;
$$;

revoke all on function public.lji_auto_index_manual_capture_review() from public, anon, authenticated;
grant execute on function public.lji_auto_index_manual_capture_review() to service_role;

drop trigger if exists lji_auto_index_manual_capture_review_trg on public.lj_v2_raw_discoveries;
create trigger lji_auto_index_manual_capture_review_trg
after insert or update of metadata, raw_payload on public.lj_v2_raw_discoveries
for each row
when (
  coalesce(new.metadata->>'provider','') = 'manual_paste'
  or coalesce(new.raw_payload->>'source','') = 'manual_paste'
)
execute function public.lji_auto_index_manual_capture_review();
