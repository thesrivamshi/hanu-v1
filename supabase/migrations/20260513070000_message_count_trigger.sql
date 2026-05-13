-- Migration: maintain conversations.message_count and last_message_at via trigger.
-- Replaces the broken application-side counter in tools.py:hanu_log_message.

create or replace function public.tg_messages_after_change()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'INSERT') then
    update public.conversations
       set message_count = coalesce(message_count, 0) + 1,
           last_message_at = greatest(coalesce(last_message_at, NEW.created_at), NEW.created_at)
     where id = NEW.conversation_id;
    return NEW;
  elsif (TG_OP = 'DELETE') then
    update public.conversations
       set message_count = greatest(coalesce(message_count, 1) - 1, 0)
     where id = OLD.conversation_id;
    return OLD;
  end if;
  return null;
end $$;

drop trigger if exists messages_after_change on public.messages;
create trigger messages_after_change
  after insert or delete on public.messages
  for each row execute function public.tg_messages_after_change();

-- Backfill existing counts (idempotent; safe to re-run).
update public.conversations c
   set message_count = sub.cnt,
       last_message_at = greatest(coalesce(c.last_message_at, sub.last_at), sub.last_at)
  from (
    select conversation_id,
           count(*)::int as cnt,
           max(created_at) as last_at
      from public.messages
     group by conversation_id
  ) sub
 where c.id = sub.conversation_id;

update public.conversations
   set message_count = 0
 where id not in (select conversation_id from public.messages);
