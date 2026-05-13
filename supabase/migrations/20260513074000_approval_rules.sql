-- Migration: approval_rules + match_approval_rule().
-- Per tasks/12-approval-rule-playback.md.
-- (Applied via Composio: sequential statements; SQL captured here for parity.)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'approval_rule_action') then
    create type public.approval_rule_action as enum ('allow', 'deny', 'always_ask');
  end if;
end $$;

create table if not exists public.approval_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  from_person_id  uuid references public.people(id) on delete cascade,
  kind            text,
  text_match      text,
  action          public.approval_rule_action not null,
  reply_template  text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  origin_approval_id uuid references public.approvals(id) on delete set null
);

create index if not exists approval_rules_lookup_idx
  on public.approval_rules(user_id, from_person_id, kind)
  where active = true;

alter table public.approval_rules enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approval_rules' and policyname='approval_rules: owner select') then
    create policy "approval_rules: owner select" on public.approval_rules for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approval_rules' and policyname='approval_rules: owner insert') then
    create policy "approval_rules: owner insert" on public.approval_rules for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approval_rules' and policyname='approval_rules: owner update') then
    create policy "approval_rules: owner update" on public.approval_rules for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approval_rules' and policyname='approval_rules: owner delete') then
    create policy "approval_rules: owner delete" on public.approval_rules for delete using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.match_approval_rule(p_from_person_id uuid, p_kind text, p_text text)
returns table (id uuid, action public.approval_rule_action, reply_template text)
language sql stable security definer as $$
  select r.id, r.action, r.reply_template
    from public.approval_rules r
   where r.active = true
     and (r.expires_at is null or r.expires_at > now())
     and (r.from_person_id is null or r.from_person_id = p_from_person_id)
     and (r.kind is null or r.kind = p_kind)
     and (r.text_match is null or p_text ilike r.text_match)
   order by
     (case when r.from_person_id is not null then 0 else 1 end),
     (case when r.kind is not null then 0 else 1 end),
     (case when r.text_match is not null then 0 else 1 end),
     r.created_at desc
   limit 1;
$$;
