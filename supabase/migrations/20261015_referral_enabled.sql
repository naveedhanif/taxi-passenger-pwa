-- Lets each driver switch Refer & Earn on or off (Settings → Refer & Earn in the driver app).
-- Default OFF: existing drivers' customers stop seeing referrals until the driver turns it on.
-- Additive only — no existing column, view or function is changed.
alter table public.drivers
  add column if not exists referral_enabled boolean not null default false;
