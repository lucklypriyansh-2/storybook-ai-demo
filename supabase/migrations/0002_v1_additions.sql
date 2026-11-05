-- 0002_v1_additions.sql
-- Starring Me — v1 additions on top of 0001_init.sql.
-- Target: Postgres 15 / Supabase. Idempotent where reasonable.
-- Depends on: 0001_init.sql (tables, public.is_member(uuid), pgcrypto).

-- ============================================================================
-- Schema additions
-- ============================================================================

alter table public.templates add column if not exists video text;

alter table public.settings
  add column if not exists bedtime_mode   boolean not null default false,
  add column if not exists remake_enabled boolean not null default true;

-- ============================================================================
-- RPCs
-- ============================================================================

-- rename_kid: change a kid's display name. Membership is checked through the
-- kid's household. Existing book titles that contain the old name are rewritten.
create or replace function public.rename_kid(p_kid uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_hid   uuid;
  v_old   text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select household_id, display_name
    into v_hid, v_old
    from public.kids
   where id = p_kid;

  if v_hid is null then
    raise exception 'kid not found';
  end if;

  if not public.is_member(v_hid) then
    raise exception 'not a household member';
  end if;

  v_name := btrim(p_name);

  if v_name is null or char_length(v_name) not between 1 and 20 then
    raise exception 'name must be 1 to 20 characters';
  end if;

  update public.kids
     set display_name = v_name
   where id = p_kid;

  update public.books
     set title = replace(title, v_old, v_name)
   where household_id = v_hid
     and v_old <> v_name
     and strpos(title, v_old) > 0;
end;
$$;

revoke all on function public.rename_kid(uuid, text) from public;
revoke all on function public.rename_kid(uuid, text) from anon;
grant execute on function public.rename_kid(uuid, text) to authenticated;

-- create_reel: build a new reel from a template for the caller's household.
-- Requires 'create' consent. Inserts the reel (queued), its first version,
-- a queued render job, and the matching book. Returns {reel_id, version, job_id}.
create or replace function public.create_reel(p_template text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_hid        uuid;
  v_kid_id     uuid;
  v_kid_name   text;
  v_tmpl       record;
  v_state      jsonb;
  v_title      text;
  v_reel_id    uuid;
  v_version_id uuid;
  v_job_id     uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select hm.household_id
    into v_hid
    from public.household_members hm
   where hm.user_id = v_uid
   order by hm.created_at
   limit 1;

  if v_hid is null then
    raise exception 'no household';
  end if;

  if not exists (
    select 1 from public.consents
     where household_id = v_hid
       and kind = 'create'
       and granted = true
  ) then
    raise exception 'create consent not granted';
  end if;

  select id, display_name
    into v_kid_id, v_kid_name
    from public.kids
   where household_id = v_hid
   order by created_at
   limit 1;

  if v_kid_id is null then
    raise exception 'no kid in household';
  end if;

  select * into v_tmpl from public.templates where id = p_template;
  if v_tmpl.id is null then
    raise exception 'template not found: %', p_template;
  end if;

  v_state := coalesce(v_tmpl.default_state, '{}'::jsonb);
  v_title := replace(coalesce(v_tmpl.book_title, v_tmpl.title), '{name}', v_kid_name);

  insert into public.reels
    (household_id, kid_id, template_id, title, state, version, status, video_url, poster)
  values
    (v_hid, v_kid_id, v_tmpl.id, v_title, v_state, 1, 'queued', null, v_tmpl.cover)
  returning id into v_reel_id;

  -- jsonb -> text is canonical (jsonb stores keys in a fixed order), so the
  -- hash is stable across equivalent inputs.
  insert into public.reel_versions
    (reel_id, household_id, version, state, state_hash, status)
  values
    (v_reel_id, v_hid, 1, v_state,
     encode(sha256(convert_to(v_state::text, 'utf8')), 'hex'),
     'queued')
  returning id into v_version_id;

  insert into public.render_jobs
    (household_id, reel_id, reel_version_id, status)
  values
    (v_hid, v_reel_id, v_version_id, 'queued')
  returning id into v_job_id;

  insert into public.books (household_id, reel_id, title, pages)
  values (
    v_hid,
    v_reel_id,
    v_title,
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'text',  replace(line, '{name}', v_kid_name),
                 'image', v_tmpl.cover
               )
               order by idx
             )
        from jsonb_array_elements_text(v_tmpl.script) with ordinality as t(line, idx)
    ), '[]'::jsonb)
  );

  return jsonb_build_object(
    'reel_id', v_reel_id,
    'version', 1,
    'job_id',  v_job_id
  );
end;
$$;

revoke all on function public.create_reel(text) from public;
revoke all on function public.create_reel(text) from anon;
grant execute on function public.create_reel(text) to authenticated;

-- delete_my_household: delete the caller's household. All child rows are
-- removed by the `on delete cascade` foreign keys from public.households.
create or replace function public.delete_my_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hid uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select hm.household_id
    into v_hid
    from public.household_members hm
   where hm.user_id = v_uid
   order by hm.created_at
   limit 1;

  if v_hid is null then
    raise exception 'no household';
  end if;

  delete from public.households where id = v_hid;
end;
$$;

revoke all on function public.delete_my_household() from public;
revoke all on function public.delete_my_household() from anon;
grant execute on function public.delete_my_household() to authenticated;
