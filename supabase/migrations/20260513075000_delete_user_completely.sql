-- Migration: delete_user_completely(uuid) for the "forget me" path.
-- Per tasks/22-deletion-forget-me.md.
--
-- Companion script: hermes-hanu-skill/admin_delete_user.py
-- (which also deletes Storage objects under voice-notes/<uid>/ and the
-- auth.users row via the Supabase Admin API).

create or replace function public.delete_user_completely(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Defensive deletes in dependency-friendly order. With CASCADEs wired this
  -- is overkill, but it makes the function authoritative regardless of FK shape.
  delete from public.activity_log      where user_id = p_user_id;
  delete from public.appointments      where user_id = p_user_id;
  delete from public.approvals         where user_id = p_user_id;
  delete from public.daily_reviews     where user_id = p_user_id;
  delete from public.decisions         where user_id = p_user_id;
  delete from public.goal_completions  where user_id = p_user_id;
  delete from public.goals             where user_id = p_user_id;
  delete from public.memories          where user_id = p_user_id;
  delete from public.memory_inbox      where user_id = p_user_id;
  delete from public.messages          where user_id = p_user_id;
  delete from public.conversations     where user_id = p_user_id;
  delete from public.open_loops        where user_id = p_user_id;
  delete from public.permissions       where user_id = p_user_id;
  delete from public.people            where user_id = p_user_id;
  delete from public.promises          where user_id = p_user_id;
  delete from public.reminders         where user_id = p_user_id;
  delete from public.routines          where user_id = p_user_id;
  delete from public.settings          where user_id = p_user_id;
  delete from public.spaces            where user_id = p_user_id;

  -- Conditional tables from later tasks.
  if to_regclass('public.conflicts')         is not null then
    execute format('delete from public.conflicts where user_id = %L', p_user_id);
  end if;
  if to_regclass('public.approval_rules')    is not null then
    execute format('delete from public.approval_rules where user_id = %L', p_user_id);
  end if;
  if to_regclass('public.messages_archive')  is not null then
    execute format('delete from public.messages_archive where user_id = %L', p_user_id);
  end if;

  delete from public.profiles where id = p_user_id;

  -- This function does NOT delete auth.users (admin API only) or storage
  -- objects (Storage API only). See admin_delete_user.py.
end $$;
