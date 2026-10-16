-- Cool-down bookkeeping for driver-initiated customer notifications.
alter table public.promo_codes add column if not exists last_notified_at timestamptz;
alter table public.drivers add column if not exists referral_notified_at timestamptz;
