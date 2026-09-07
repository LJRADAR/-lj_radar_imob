-- Invalidate pre-v4 Quinto verification semantics.
-- v4+ is fail-closed: absence of a positive match is inconclusive, never proof that a listing is outside QuintoAndar.
update public.lj_v2_quinto_checks
set approved_for_pipeline = false,
    status = case when status = 'no_public_match_found' then 'inconclusive' else status end,
    reason = case
      when verifier_version !~ '^4\.' then concat('[legacy invalidated 2026-09-07] ', coalesce(reason,''))
      else reason
    end,
    updated_at = now()
where verifier_version !~ '^4\.'
  and (approved_for_pipeline = true or status = 'no_public_match_found');
