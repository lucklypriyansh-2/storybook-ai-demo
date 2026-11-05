-- 0003_hardening.sql
-- Starring Me — RLS/privilege hardening and RPC fixes.
-- Target: Postgres 15 / Supabase. Idempotent: policies are dropped before creation
-- and functions are create-or-replaced.
-- Depends on: 0001_init.sql and 0002_v1_additions.sql.
--
-- Fixes REVIEW.md findings 11, 12, 13, 16, 17, 19.

-- ============================================================================
-- Finding 11: family_share consent defaults to false.
-- Same body as 0001's bootstrap_household; only the family_share default changes.
-- ============================================================================
create or replace function public.bootstrap_household(p_kid_name text default 'Mira')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_hid          uuid;
  v_kid_id       uuid;
  v_reel_id      uuid;
  v_template     record;
  v_state        jsonb;
  v_default_look jsonb := '{"skin":"#B9764F","hair":"curly","hairColor":"#2B1B14","outfit":"#FFC800","glasses":false,"freckles":false}'::jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select hm.household_id
    into v_hid
    from public.household_members hm
   where hm.user_id = v_uid
   limit 1;

  if v_hid is not null then
    return v_hid;
  end if;

  insert into public.households(name)
       values (p_kid_name || '''s Household')
    returning id into v_hid;

  insert into public.household_members(household_id, user_id, role)
       values (v_hid, v_uid, 'parent');

  insert into public.kids(household_id, display_name, age_band)
       values (v_hid, p_kid_name, '5-7')
    returning id into v_kid_id;

  insert into public.characters(household_id, kid_id, look)
       values (v_hid, v_kid_id, v_default_look);

  insert into public.settings(household_id) values (v_hid)
    on conflict (household_id) do nothing;

  insert into public.consents(household_id, kind, granted, method) values
    (v_hid, 'create',         true,  'default'),
    (v_hid, 'family_share',   false, 'default'),
    (v_hid, 'ai_training',    false, 'default'),
    (v_hid, 'marketing',      false, 'default'),
    (v_hid, 'publish_social', false, 'default')
  on conflict (household_id, kind) do nothing;

  for v_template in
    select * from public.templates order by sort, id
  loop
    v_state := coalesce(v_template.default_state, '{}'::jsonb);

    insert into public.reels
      (household_id, kid_id, template_id, title, state, version, status, poster)
    values
      (v_hid, v_kid_id, v_template.id,
       replace(coalesce(v_template.book_title, v_template.title), '{name}', p_kid_name),
       v_state, 1, 'ready', v_template.cover)
    returning id into v_reel_id;

    insert into public.reel_versions
      (reel_id, household_id, version, state, state_hash, status)
    values
      (v_reel_id, v_hid, 1, v_state,
       encode(sha256(convert_to(v_state::text, 'utf8')), 'hex'),
       'ready');

    insert into public.books (household_id, reel_id, title, pages)
    values (
      v_hid,
      v_reel_id,
      replace(coalesce(v_template.book_title, v_template.title), '{name}', p_kid_name),
      coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'text',  replace(line, '{name}', p_kid_name),
                   'image', v_template.scenes
                              -> (((idx::int - 1) % greatest(jsonb_array_length(v_template.scenes), 1)))
                              ->> 'image'
                 )
                 order by idx
               )
          from jsonb_array_elements_text(v_template.script) with ordinality as t(line, idx)
      ), '[]'::jsonb)
    );
  end loop;

  return v_hid;
end;
$$;

revoke all on function public.bootstrap_household(text) from public;
grant execute on function public.bootstrap_household(text) to authenticated;

-- ============================================================================
-- Findings 12 and 13: clients get select-only access to generated rows.
-- Insert/update/delete are reserved for SECURITY DEFINER RPCs and service_role.
-- The only client-writable reel columns are loved and saved.
-- ============================================================================

-- reels: members may read; may update loved/saved only; no direct insert/delete.
drop policy if exists reels_all on public.reels;
drop policy if exists reels_select on public.reels;
create policy reels_select on public.reels
  for select to authenticated
  using (public.is_member(household_id));

drop policy if exists reels_update on public.reels;
create policy reels_update on public.reels
  for update to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

revoke insert, delete, update on public.reels from anon, authenticated;
grant update (loved, saved) on public.reels to authenticated;
grant select on public.reels to authenticated;

-- reel_versions: members may read only; rows are created by RPCs.
drop policy if exists rv_all on public.reel_versions;
drop policy if exists rv_select on public.reel_versions;
create policy rv_select on public.reel_versions
  for select to authenticated
  using (public.is_member(household_id));

revoke insert, delete, update on public.reel_versions from anon, authenticated;
grant select on public.reel_versions to authenticated;

-- books: members may read only; rows are created by RPCs.
drop policy if exists books_all on public.books;
drop policy if exists books_select on public.books;
create policy books_select on public.books
  for select to authenticated
  using (public.is_member(household_id));

revoke insert, delete, update on public.books from anon, authenticated;
grant select on public.books to authenticated;

-- render_jobs: members may read only; jobs are created by RPCs.
drop policy if exists rj_insert on public.render_jobs;

revoke insert, delete, update on public.render_jobs from anon, authenticated;
grant select on public.render_jobs to authenticated;

-- ============================================================================
-- Finding 19: remake_reel honours settings.remake_enabled.
-- Same body as 0001's remake_reel with the settings check added.
-- ============================================================================
create or replace function public.remake_reel(p_reel uuid, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_hid        uuid;
  v_version    int;
  v_version_id uuid;
  v_job_id     uuid;
  v_hash       text;
  v_text       text;
  v_key        text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select household_id into v_hid from public.reels where id = p_reel;
  if v_hid is null then
    raise exception 'reel not found';
  end if;
  if not public.is_member(v_hid) then
    raise exception 'not a household member';
  end if;

  if exists (
    select 1 from public.settings
     where household_id = v_hid
       and remake_enabled = false
  ) then
    raise exception 'remake disabled';
  end if;

  if not exists (
    select 1 from public.consents
     where household_id = v_hid
       and kind = 'create'
       and granted = true
  ) then
    raise exception 'create consent not granted';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'state must be a json object';
  end if;

  for v_key in select jsonb_object_keys(p_state) loop
    if v_key not in ('scene','outfit','co_star','text') then
      raise exception 'invalid state key: %', v_key;
    end if;
  end loop;

  v_text := p_state ->> 'text';
  if v_text is not null and char_length(v_text) > 120 then
    raise exception 'text too long (max 120 chars)';
  end if;

  update public.reels
     set version    = version + 1,
         state      = p_state,
         status     = 'queued',
         video_url  = null,
         updated_at = now()
   where id = p_reel
   returning version into v_version;

  -- jsonb -> text is canonical (jsonb stores keys in a fixed order), so the
  -- hash is stable across equivalent inputs.
  v_hash := encode(sha256(convert_to(p_state::text, 'utf8')), 'hex');

  insert into public.reel_versions
    (reel_id, household_id, version, state, state_hash, status)
  values
    (p_reel, v_hid, v_version, p_state, v_hash, 'queued')
  returning id into v_version_id;

  insert into public.render_jobs
    (household_id, reel_id, reel_version_id, status)
  values
    (v_hid, p_reel, v_version_id, 'queued')
  returning id into v_job_id;

  return jsonb_build_object(
    'reel_id', p_reel,
    'version', v_version,
    'job_id',  v_job_id
  );
end;
$$;

revoke all on function public.remake_reel(uuid, jsonb) from public;
grant execute on function public.remake_reel(uuid, jsonb) to authenticated;

-- ============================================================================
-- Finding 16: rename_kid re-derives book titles from the template's book_title
-- with {name} replaced, instead of substring-replacing the old name.
-- ============================================================================
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

  update public.books b
     set title = replace(coalesce(t.book_title, t.title), '{name}', v_name)
    from public.reels r
    join public.templates t on t.id = r.template_id
   where b.reel_id = r.id
     and b.household_id = v_hid
     and r.kid_id = p_kid
     and v_old <> v_name;
end;
$$;

revoke all on function public.rename_kid(uuid, text) from public;
revoke all on function public.rename_kid(uuid, text) from anon;
grant execute on function public.rename_kid(uuid, text) to authenticated;

-- ============================================================================
-- Finding 17: create_reel cycles book page images through template.scenes[].image,
-- matching bootstrap_household's behaviour.
-- ============================================================================
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
                 'image', v_tmpl.scenes
                            -> (((idx::int - 1) % greatest(jsonb_array_length(v_tmpl.scenes), 1)))
                            ->> 'image'
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
