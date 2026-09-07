-- Harden legacy Match tables so manager/admin access is limited to shared LJ workspaces.

revoke all privileges on table public.lj_match_intentions from public, anon;
revoke all privileges on table public.oportunidades_lj from public, anon;
revoke insert, update, delete on table public.oportunidades_lj from authenticated;
grant select on table public.oportunidades_lj to authenticated;

alter policy lj_match_intentions_select on public.lj_match_intentions
using (
  created_by = auth.uid()
  or assigned_to = auth.uid()
  or (
    public.lj_is_manager_or_admin()
    and exists (
      select 1
      from public.lji_workspace_members me
      join public.lji_workspace_members teammate
        on teammate.workspace_id = me.workspace_id
       and teammate.is_active = true
      where me.user_id = auth.uid()
        and me.is_active = true
        and (teammate.user_id = created_by or teammate.user_id = assigned_to)
    )
  )
);

alter policy lj_match_intentions_update on public.lj_match_intentions
using (
  created_by = auth.uid()
  or assigned_to = auth.uid()
  or (
    public.lj_is_manager_or_admin()
    and exists (
      select 1
      from public.lji_workspace_members me
      join public.lji_workspace_members teammate
        on teammate.workspace_id = me.workspace_id
       and teammate.is_active = true
      where me.user_id = auth.uid()
        and me.is_active = true
        and (teammate.user_id = created_by or teammate.user_id = assigned_to)
    )
  )
)
with check (
  created_by = auth.uid()
  or assigned_to = auth.uid()
  or (
    public.lj_is_manager_or_admin()
    and exists (
      select 1
      from public.lji_workspace_members me
      join public.lji_workspace_members teammate
        on teammate.workspace_id = me.workspace_id
       and teammate.is_active = true
      where me.user_id = auth.uid()
        and me.is_active = true
        and (teammate.user_id = created_by or teammate.user_id = assigned_to)
    )
  )
);

alter policy lj_opportunities_role_select on public.oportunidades_lj
using (
  approved_for_pipeline = true
  and exists (
    select 1
    from public.lji_opportunity_index oi
    join public.lji_workspace_members me
      on me.workspace_id = oi.workspace_id
     and me.user_id = auth.uid()
     and me.is_active = true
    where oportunidades_lj.listing_id is not null
      and oi.raw_snapshot->>'listing_id' = oportunidades_lj.listing_id::text
  )
  and (public.lj_is_manager_or_admin() or assigned_to = auth.uid())
);
