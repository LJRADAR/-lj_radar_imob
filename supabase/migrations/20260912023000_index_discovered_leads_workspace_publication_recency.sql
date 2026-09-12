-- Hot path used by the dashboard and capture center:
-- filter by workspace, then show the newest published/discovered leads first.
create index if not exists lji_discovered_leads_workspace_publication_idx
  on public.lji_discovered_leads (workspace_id, published_at desc nulls last, discovered_at desc);
