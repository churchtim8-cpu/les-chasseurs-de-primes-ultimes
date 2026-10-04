# Online class board: setting up Supabase (one time, about 10 minutes)

The Daily Challenge can share each class's board online, so every student sees the whole class on their own device. Students do not sign up. Only the teacher makes one free Supabase account.

## 1. Make the project

1. Go to https://supabase.com and sign up (a Google account or an email is fine).
2. Click **New project**. Name it `chasseurs`, choose any database password (keep it somewhere safe; Claude never needs it) and the region nearest Trinidad (for example *East US*). Click **Create**.

## 2. Make the board (copy and paste once)

1. In the left menu, open **SQL Editor**, then **New query**.
2. Paste everything in the box below. **Change `CHANGE-ME` to your own teacher PIN** (letters and numbers you will remember).
3. Click **Run**. It should say *Success*.

```sql
-- The scores: one line per student, class and day (the first try).
create table public.daily_scores (
  id bigint generated always as identity primary key,
  day date not null,
  class_code text not null check (char_length(class_code) between 1 and 8),
  nickname text not null check (char_length(nickname) between 1 and 14),
  score int not null check (score between 0 and 8191),
  stars int not null check (stars between 0 and 3),
  created_at timestamptz not null default now(),
  unique (day, class_code, nickname)
);
alter table public.daily_scores enable row level security;
grant select, insert on public.daily_scores to anon;
-- Anyone with the game can read the boards and add a first try for around today; nobody can change or delete a score.
create policy "read the boards" on public.daily_scores for select to anon using (true);
create policy "add a first try" on public.daily_scores for insert to anon
  with check (day between current_date - 1 and current_date + 1);

-- The teacher PIN, which the game can never read.
create table public.teacher_pin (pin text not null);
alter table public.teacher_pin enable row level security;
insert into public.teacher_pin values ('CHANGE-ME');

-- REMOVE A NAME in the game: removes one line, only with the right PIN.
create function public.remove_daily_score(p_day date, p_class text, p_nickname text, p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from teacher_pin where pin = p_pin) then return false; end if;
  delete from daily_scores where day = p_day and class_code = p_class and nickname = p_nickname;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.remove_daily_score from public;
grant execute on function public.remove_daily_score to anon;
```

## 3. Send Claude two things

Open **Project Settings → Data API** (or **API**) and copy:

- the **Project URL** (it looks like `https://abcdxyz.supabase.co`)
- the **anon public** key (a long text starting with `eyJ`, or `sb_publishable_`)

Do **not** send the `service_role` / secret key. The anon key is safe to share: the rules above only let it read boards, add a first try, and remove a name with your PIN.

## Good to know

- A free project pauses after a week with no visits (for example during a school holiday). Supabase emails you; open the project and click **Restore**. While it is paused the game simply uses this device's board and score codes.
- To change the PIN later: SQL Editor, `update public.teacher_pin set pin = 'NEW-PIN';`, Run.
- To see or clear every score: **Table Editor → daily_scores**.
