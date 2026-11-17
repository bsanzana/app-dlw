-- Configuración global de la app (límite de ancho de banda por defecto: 10 GB)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('default_bandwidth_limit_bytes', '10737418240'::jsonb) -- 10 GB
on conflict (key) do nothing;

-- Métricas y cuota de ancho de banda por usuario
create table if not exists public.user_usage (
  user_id uuid primary key,
  email text not null,
  provider text not null default 'email',
  requests_count integer not null default 0,
  downloads_count integer not null default 0,
  bytes_transferred bigint not null default 0,
  bandwidth_limit_bytes bigint null, -- NULL = usa el límite global de app_settings
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
alter table public.user_usage enable row level security;
