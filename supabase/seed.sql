-- supabase/seed.sql
-- Bootstrap data for a fresh local DB. Only runs on `supabase db reset`.
-- Production remote already has the canonical user row.

insert into public.profiles (id, display_name, first_name, avatar_letter)
values ('d804b9ed-5eaa-497c-8390-86ba02007a33', 'Vamshi', 'Vamshi', 'V')
on conflict (id) do nothing;

insert into public.settings (user_id)
values ('d804b9ed-5eaa-497c-8390-86ba02007a33')
on conflict (user_id) do nothing;

insert into public.spaces (user_id, name, kind, description)
values ('d804b9ed-5eaa-497c-8390-86ba02007a33', 'My private space', 'private', null)
on conflict do nothing;
