create table if not exists public.capacity_plans (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_capacity_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_capacity_plans_updated_at on public.capacity_plans;

create trigger set_capacity_plans_updated_at
before update on public.capacity_plans
for each row
execute function public.set_capacity_plans_updated_at();

alter table public.capacity_plans enable row level security;

drop policy if exists "capacity plans are readable" on public.capacity_plans;
drop policy if exists "capacity plans can be inserted" on public.capacity_plans;
drop policy if exists "capacity plans can be updated" on public.capacity_plans;

create policy "capacity plans are readable"
on public.capacity_plans
for select
to anon
using (true);

create policy "capacity plans can be inserted"
on public.capacity_plans
for insert
to anon
with check (true);

create policy "capacity plans can be updated"
on public.capacity_plans
for update
to anon
using (true)
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.capacity_plans;
exception
  when duplicate_object then null;
end;
$$;
