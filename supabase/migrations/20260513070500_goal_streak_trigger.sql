-- Migration: maintain goals.streak / missed_count / risk via trigger on goal_completions.
-- Per tasks/04-goal-streak-trigger.md. Backfills existing goals at the end.

create or replace function public.recompute_goal_stats(p_goal_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_streak integer := 0;
  v_missed_30 integer := 0;
  v_missed_7  integer := 0;
  v_risk text;
  v_cursor date := current_date;
  v_status text;
begin
  -- Streak: consecutive 'done' days ending today.
  loop
    select status into v_status
      from public.goal_completions
     where goal_id = p_goal_id
       and on_date = v_cursor
     limit 1;
    if v_status is null or v_status <> 'done' then
      exit;
    end if;
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  -- Missed counts in trailing 30 / 7 days.
  select count(*) into v_missed_30
    from public.goal_completions
   where goal_id = p_goal_id
     and status = 'missed'
     and on_date >= current_date - 30;

  select count(*) into v_missed_7
    from public.goal_completions
   where goal_id = p_goal_id
     and status = 'missed'
     and on_date >= current_date - 7;

  -- Risk heuristic (tune later from real data).
  if v_missed_7 >= 3 then
    v_risk := 'high';
  elsif v_missed_7 >= 1 then
    v_risk := 'medium';
  else
    v_risk := 'low';
  end if;

  update public.goals
     set streak       = v_streak,
         missed_count = v_missed_30,
         risk         = v_risk,
         updated_at   = now()
   where id = p_goal_id;
end $$;


create or replace function public.tg_goal_completions_after_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.recompute_goal_stats(OLD.goal_id);
    return OLD;
  else
    perform public.recompute_goal_stats(NEW.goal_id);
    return NEW;
  end if;
end $$;


drop trigger if exists goal_completions_after_change on public.goal_completions;
create trigger goal_completions_after_change
  after insert or update or delete on public.goal_completions
  for each row execute function public.tg_goal_completions_after_change();


-- Backfill existing goals (idempotent).
do $$
declare gid uuid;
begin
  for gid in select id from public.goals loop
    perform public.recompute_goal_stats(gid);
  end loop;
end $$;
