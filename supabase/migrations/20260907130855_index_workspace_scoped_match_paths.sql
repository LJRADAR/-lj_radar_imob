-- Index the hot paths used by workspace-scoped RLS/RPC checks and Match lookups.

create index if not exists lji_workspace_members_user_active_workspace_idx
  on public.lji_workspace_members(user_id, is_active, workspace_id);

create index if not exists lji_opportunity_index_workspace_listing_id_idx
  on public.lji_opportunity_index(workspace_id, ((raw_snapshot->>'listing_id')))
  where raw_snapshot->>'listing_id' is not null;

create index if not exists lj_match_intentions_created_by_idx
  on public.lj_match_intentions(created_by);

create index if not exists lji_opportunity_index_handled_by_user_id_idx
  on public.lji_opportunity_index(handled_by_user_id)
  where handled_by_user_id is not null;

create index if not exists oportunidades_lj_approved_listing_id_idx
  on public.oportunidades_lj(listing_id)
  where approved_for_pipeline = true and listing_id is not null;
