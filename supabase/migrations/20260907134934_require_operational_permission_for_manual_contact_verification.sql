create or replace function public.lji_confirm_contact(p_kind text, p_id uuid, p_phone text, p_note text default null::text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone,''),'\D','','g');
  v_workspace uuid;
begin
  if v_user is null then return false; end if;
  if public.lj_v2_has_permission('manage_operational_leads') is not true then return false; end if;

  if left(v_phone,2)='55' and length(v_phone) in (12,13) then
    v_phone := substr(v_phone,3);
  end if;

  if length(v_phone) not in (10,11) or substr(v_phone,1,2) !~ '^[1-9][0-9]$' then
    return false;
  end if;

  if lower(p_kind)='opportunity' then
    select workspace_id into v_workspace from public.lji_opportunity_index where id=p_id;
    if not exists(select 1 from public.lji_workspace_members where workspace_id=v_workspace and user_id=v_user and is_active=true) then return false; end if;
    update public.lji_opportunity_index
       set contact_verified=true,
           contact_verified_at=now(),
           contact_verified_by=v_user,
           contact_verified_phone=v_phone,
           contact_phone=coalesce(nullif(contact_phone,''),v_phone),
           contact_verification_note=nullif(btrim(p_note),'')
     where id=p_id;
    return found;
  elsif lower(p_kind)='lead' then
    select workspace_id into v_workspace from public.lji_discovered_leads where id=p_id;
    if not exists(select 1 from public.lji_workspace_members where workspace_id=v_workspace and user_id=v_user and is_active=true) then return false; end if;
    update public.lji_discovered_leads
       set contact_verified=true,
           contact_verified_at=now(),
           contact_verified_by=v_user,
           contact_verified_phone=v_phone,
           contact_phone=coalesce(nullif(contact_phone,''),v_phone),
           contact_status='manually_verified',
           contact_checked_at=now(),
           contact_verification_note=nullif(btrim(p_note),'')
     where id=p_id;
    return found;
  end if;
  return false;
end;
$function$;

create or replace function public.lji_manual_verify_contact(p_kind text, p_id uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text := regexp_replace(coalesce(p_phone,''),'\D','','g');
  v_workspace uuid;
  v_user uuid := auth.uid();
  v_wa text;
begin
  if length(v_phone) in (12,13) and left(v_phone,2)='55' then v_phone:=substr(v_phone,3); end if;
  if length(v_phone) not in (10,11) then raise exception 'Telefone deve ter DDD e 10 ou 11 dígitos'; end if;
  if v_user is null then raise exception 'Usuário não autenticado'; end if;
  if public.lj_v2_has_permission('manage_operational_leads') is not true then raise exception 'Sem permissão para gerenciar leads'; end if;
  v_wa := case when length(v_phone)=11 and substr(v_phone,3,1)='9' then 'https://wa.me/55'||v_phone else null end;

  if p_kind='opportunity' then
    select workspace_id into v_workspace from public.lji_opportunity_index where id=p_id;
    if v_workspace is null then raise exception 'Imóvel não encontrado'; end if;
    if not public.lji_is_workspace_member(v_workspace) then raise exception 'Sem acesso ao workspace'; end if;
    update public.lji_opportunity_index
      set contact_phone=v_phone,whatsapp_url=v_wa,contact_method='Confirmado manualmente',
          contact_verified=true,contact_verified_at=now(),contact_verified_by=v_user,updated_at=now()
      where id=p_id;
  elsif p_kind='discovered' then
    select workspace_id into v_workspace from public.lji_discovered_leads where id=p_id;
    if v_workspace is null then raise exception 'Lead não encontrado'; end if;
    if not public.lji_is_workspace_member(v_workspace) then raise exception 'Sem acesso ao workspace'; end if;
    update public.lji_discovered_leads
      set contact_phone=v_phone,whatsapp_url=v_wa,contact_method='Confirmado manualmente',contact_status='manual_verified',
          contact_note='Número confirmado manualmente por usuário do LJ Radar.',contact_verified=true,
          contact_verified_at=now(),contact_verified_by=v_user,updated_at=now()
      where id=p_id;
  else
    raise exception 'Tipo de registro inválido';
  end if;
  return jsonb_build_object('ok',true,'kind',p_kind,'id',p_id,'phone',v_phone,'whatsapp_url',v_wa,'verified_at',now());
end
$function$;
