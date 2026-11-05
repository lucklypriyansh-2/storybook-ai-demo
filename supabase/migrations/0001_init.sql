-- 0001_init.sql
-- Starring Me — initial schema for milestones M1/M2 (single-household-first).
-- Target: Postgres 15 / Supabase. Idempotent where reasonable.
-- Anonymous Supabase sign-in is a first-class auth path: anon-signed users
-- carry the `authenticated` role in their JWT, so grants to `authenticated`
-- cover them. The `anon` role (no JWT at all) only needs read on templates.

create extension if not exists pgcrypto;

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'parent',
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_id_idx on public.household_members(user_id);

create table if not exists public.kids (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 20),
  age_band      text,
  created_at    timestamptz not null default now()
);
create index if not exists kids_household_id_idx on public.kids(household_id);

create table if not exists public.characters (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kid_id       uuid not null references public.kids(id) on delete cascade,
  look         jsonb not null default '{}'::jsonb,  -- {skin, hair, hairColor, outfit, glasses, freckles}
  created_at   timestamptz not null default now()
);
create index if not exists characters_household_id_idx on public.characters(household_id);
create index if not exists characters_kid_id_idx on public.characters(kid_id);

create table if not exists public.templates (
  id            text primary key,                           -- e.g. 'moon'
  title         text not null,
  mode          text not null check (mode in ('day','bedtime','birthday')),
  duration_s    int  not null default 30,
  scenes        jsonb not null default '[]'::jsonb,         -- [{image, caption}, ...]
  script        jsonb not null default '[]'::jsonb,         -- ["line {name}", ...]
  cover         text,
  book_title    text,
  default_state jsonb not null default '{}'::jsonb,         -- {scene, outfit, co_star, text}
  cliffhanger   text,
  sort          int  not null default 0
);

create table if not exists public.reels (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kid_id       uuid not null references public.kids(id) on delete cascade,
  template_id  text not null references public.templates(id),
  title        text not null,
  state        jsonb not null default '{}'::jsonb,          -- {scene, outfit, co_star, text}
  version      int  not null default 1,
  status       text not null default 'ready'
               check (status in ('ready','queued','rendering','failed')),
  video_url    text,
  poster       text,
  loved        boolean not null default false,
  saved        boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists reels_household_id_idx on public.reels(household_id);
create index if not exists reels_kid_id_idx       on public.reels(kid_id);

create table if not exists public.reel_versions (
  id           uuid primary key default gen_random_uuid(),
  reel_id      uuid not null references public.reels(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  version      int  not null,
  state        jsonb not null,
  state_hash   text not null,
  status       text not null default 'queued'
               check (status in ('ready','queued','rendering','failed')),
  video_url    text,
  created_at   timestamptz not null default now(),
  unique (reel_id, version)
);
create index if not exists reel_versions_reel_id_idx    on public.reel_versions(reel_id);
create index if not exists reel_versions_state_hash_idx on public.reel_versions(state_hash);

create table if not exists public.render_jobs (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  reel_id         uuid not null references public.reels(id) on delete cascade,
  reel_version_id uuid not null references public.reel_versions(id) on delete cascade,
  status          text not null default 'queued'
                  check (status in ('queued','rendering','done','failed')),
  attempts        int  not null default 0,
  locked_at       timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists render_jobs_household_id_idx on public.render_jobs(household_id);
create index if not exists render_jobs_status_idx       on public.render_jobs(status);

create table if not exists public.books (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  reel_id      uuid references public.reels(id) on delete set null,
  title        text not null,
  pages        jsonb not null default '[]'::jsonb,          -- [{text, image}, ...]
  created_at   timestamptz not null default now()
);
create index if not exists books_household_id_idx on public.books(household_id);

create table if not exists public.consents (
  household_id uuid not null references public.households(id) on delete cascade,
  kid_id       uuid references public.kids(id) on delete cascade,
  kind         text not null
               check (kind in ('create','family_share','ai_training','marketing','publish_social')),
  granted      boolean not null,
  method       text,
  updated_at   timestamptz not null default now(),
  unique (household_id, kind)
);
create index if not exists consents_household_id_idx on public.consents(household_id);

create table if not exists public.publish_queue (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  reel_id         uuid not null references public.reels(id) on delete cascade,
  reel_version_id uuid not null references public.reel_versions(id) on delete cascade,
  platform        text not null default 'instagram',
  caption         text,
  status          text not null default 'draft'
                  check (status in ('draft','approved','posted','failed','cancelled')),
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists publish_queue_household_id_idx on public.publish_queue(household_id);

create table if not exists public.settings (
  household_id  uuid primary key references public.households(id) on delete cascade,
  reels_per_day int     not null default 6,
  bedtime_after time    not null default '19:30',
  autoplay      boolean not null default false
);

-- ============================================================================
-- Helpers
-- ============================================================================

create or replace function public.is_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.household_members hm
     where hm.household_id = hid
       and hm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to anon, authenticated, service_role;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists reels_touch_updated_at on public.reels;
create trigger reels_touch_updated_at
  before update on public.reels
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.kids              enable row level security;
alter table public.characters        enable row level security;
alter table public.templates         enable row level security;
alter table public.reels             enable row level security;
alter table public.reel_versions     enable row level security;
alter table public.render_jobs       enable row level security;
alter table public.books             enable row level security;
alter table public.consents          enable row level security;
alter table public.publish_queue     enable row level security;
alter table public.settings          enable row level security;

-- households: members have full access to their own row
drop policy if exists hh_all on public.households;
create policy hh_all on public.households
  for all to authenticated
  using     (public.is_member(id))
  with check(public.is_member(id));

-- household_members: visible/mutable only to existing members of the same household
-- (initial membership row is inserted by bootstrap_household, which bypasses RLS)
drop policy if exists hm_all on public.household_members;
create policy hm_all on public.household_members
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- kids
drop policy if exists kids_all on public.kids;
create policy kids_all on public.kids
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- characters
drop policy if exists characters_all on public.characters;
create policy characters_all on public.characters
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- templates: public read for anon + authenticated; no writes from any client role
drop policy if exists templates_select on public.templates;
create policy templates_select on public.templates
  for select to anon, authenticated
  using (true);

-- reels: full access for members (video_url writes are blocked by column privilege below)
drop policy if exists reels_all on public.reels;
create policy reels_all on public.reels
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- reel_versions
drop policy if exists rv_all on public.reel_versions;
create policy rv_all on public.reel_versions
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- render_jobs: read own household; insert only status='queued'; never update/delete
drop policy if exists rj_select on public.render_jobs;
create policy rj_select on public.render_jobs
  for select to authenticated
  using (public.is_member(household_id));

drop policy if exists rj_insert on public.render_jobs;
create policy rj_insert on public.render_jobs
  for insert to authenticated
  with check (public.is_member(household_id) and status = 'queued');

-- books
drop policy if exists books_all on public.books;
create policy books_all on public.books
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- consents
drop policy if exists consents_all on public.consents;
create policy consents_all on public.consents
  for all to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- publish_queue:
--   select: members
--   insert: members, status must be 'draft'
--   update: members, resulting status must be 'cancelled'
--           (approved/posted transitions are server-side only via service_role)
drop policy if exists pq_select on public.publish_queue;
create policy pq_select on public.publish_queue
  for select to authenticated
  using (public.is_member(household_id));

drop policy if exists pq_insert on public.publish_queue;
create policy pq_insert on public.publish_queue
  for insert to authenticated
  with check (public.is_member(household_id) and status = 'draft');

drop policy if exists pq_update on public.publish_queue;
create policy pq_update on public.publish_queue
  for update to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id) and status = 'cancelled');

-- settings: members may read and update; row is created by bootstrap_household
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (public.is_member(household_id));

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using     (public.is_member(household_id))
  with check(public.is_member(household_id));

-- ============================================================================
-- Column-level lockdown: clients cannot set reels.video_url directly.
-- SECURITY DEFINER RPCs (owned by postgres) and the render worker
-- (service_role) both bypass this restriction.
-- ============================================================================

revoke update (video_url) on public.reels from anon, authenticated;

-- ============================================================================
-- RPCs
-- ============================================================================

-- bootstrap_household: returns the caller's household, creating it + a kid +
-- character + default consents + settings + one reel/book per template if the
-- caller is not yet a member of any household. Idempotent per caller.
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
    (v_hid, 'family_share',   true,  'default'),
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

-- remake_reel: bump the reel to a new version with a new state, enqueue a
-- render job. Atomic. Returns {reel_id, version, job_id}.
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

-- queue_publish: create a draft publish_queue row for the reel's current
-- version. Does nothing else. Returns the publish_queue id.
create or replace function public.queue_publish(p_reel uuid, p_caption text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_hid        uuid;
  v_version    int;
  v_version_id uuid;
  v_pq_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select household_id, version
    into v_hid, v_version
    from public.reels
   where id = p_reel;

  if v_hid is null then
    raise exception 'reel not found';
  end if;
  if not public.is_member(v_hid) then
    raise exception 'not a household member';
  end if;

  select id
    into v_version_id
    from public.reel_versions
   where reel_id = p_reel
     and version = v_version
   order by created_at desc
   limit 1;

  if v_version_id is null then
    raise exception 'current reel version not found';
  end if;

  insert into public.publish_queue
    (household_id, reel_id, reel_version_id, platform, caption, status)
  values
    (v_hid, p_reel, v_version_id, 'instagram', p_caption, 'draft')
  returning id into v_pq_id;

  return v_pq_id;
end;
$$;

revoke all on function public.queue_publish(uuid, text) from public;
grant execute on function public.queue_publish(uuid, text) to authenticated;
