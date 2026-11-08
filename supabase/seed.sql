-- TechShot marketplace — seed data.
-- Idempotent: every statement uses ON CONFLICT DO NOTHING, so re-running
-- this file never duplicates rows and never overwrites edited data.
-- Money is integer poisha (100 poisha = 1 BDT). Prices are in BDT.
-- Run AFTER supabase/migrations/0001_initial_schema.sql.
-- No users, orders or payments are seeded; products are platform-owned
-- (seller_id is null) until real sellers are onboarded.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into public.categories (name, slug, sort_order, is_active) values
  ('Smartphones',  'smartphones',  1, true),
  ('Laptops',      'laptops',      2, true),
  ('Audio',        'audio',        3, true),
  ('Wearables',    'wearables',    4, true),
  ('Cameras',      'cameras',      5, true),
  ('Gaming',       'gaming',       6, true),
  ('Accessories',  'accessories',  7, true),
  ('Smart Home',   'smart-home',   8, true),
  ('Subscriptions','subscriptions',9, true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Coupon: FIRST2000 — ৳2,000 off (200000 poisha) on a minimum spend of
-- ৳50,000 (5000000 poisha). No usage limit. Valid for one year from the
-- first seed run; an admin can extend it in the dashboard.
-- ---------------------------------------------------------------------------
insert into public.coupons
  (code, type, value_poisha, min_spend_poisha, usage_limit, used_count, expires_at, is_active)
values
  ('FIRST2000', 'fixed', 200000, 5000000, null, 0, now() + interval '365 days', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Physical products (all status = 'active' so they are publicly readable).
-- Brand is part of the description and search_text, as specified.
-- ---------------------------------------------------------------------------
insert into public.products
  (category_id, title, slug, description, price_poisha, compare_at_poisha,
   stock, status, search_text, rating, review_count, is_flash_deal, flash_ends_at)
values
  (
    (select id from public.categories where slug = 'smartphones'),
    'Apple iPhone 16 Pro 256GB Natural Titanium',
    'apple-iphone-16-pro-256gb-natural-titanium',
    'Apple iPhone 16 Pro with 256GB storage in Natural Titanium. A18 Pro chip, 48MP Pro camera system, titanium design and USB-C. Official warranty in Bangladesh.',
    11990000, 12990000, 12, 'active',
    'apple iphone 16 pro 256gb natural titanium smartphone a18 pro camera',
    4.9, 1248, true, now() + interval '7 days'
  ),
  (
    (select id from public.categories where slug = 'audio'),
    'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    'sony-wh-1000xm5',
    'Sony WH-1000XM5 wireless noise cancelling headphones with industry-leading ANC, 30-hour battery life and crystal-clear hands-free calling.',
    2499000, 2999000, 30, 'active',
    'sony wh-1000xm5 headphones wireless noise cancelling audio bluetooth',
    4.8, 862, false, null
  ),
  (
    (select id from public.categories where slug = 'laptops'),
    'MacBook Air 13" M3',
    'macbook-air-13-m3',
    'Apple MacBook Air 13-inch with M3 chip, 8GB unified memory and 256GB SSD. Fanless, lightweight and up to 18 hours of battery life.',
    9990000, 11490000, 8, 'active',
    'apple macbook air 13 m3 laptop macos',
    4.9, 476, false, null
  ),
  (
    (select id from public.categories where slug = 'wearables'),
    'Samsung Galaxy Watch7',
    'samsung-galaxy-watch7',
    'Samsung Galaxy Watch7 with advanced sleep tracking, Galaxy AI health insights, GPS and 5ATM water resistance. Works with Android phones.',
    2699900, 3299900, 25, 'active',
    'samsung galaxy watch7 smartwatch wearable health fitness',
    4.7, 324, false, null
  ),
  (
    (select id from public.categories where slug = 'smartphones'),
    'Samsung Galaxy S24 Ultra',
    'samsung-galaxy-s24-ultra',
    'Samsung Galaxy S24 Ultra with Galaxy AI, 200MP camera, built-in S Pen and titanium frame. 12GB RAM, 256GB storage.',
    10999900, 12999900, 15, 'active',
    'samsung galaxy s24 ultra smartphone galaxy ai s pen camera',
    4.8, 934, false, null
  ),
  (
    (select id from public.categories where slug = 'cameras'),
    'Sony Alpha ZV-E10 II',
    'sony-alpha-zv-e10-ii',
    'Sony Alpha ZV-E10 II mirrorless vlog camera with 26MP APS-C sensor, 4K video, fast autofocus and a vari-angle touchscreen. Body only.',
    9499000, 10499900, 6, 'active',
    'sony alpha zv-e10 ii camera mirrorless vlog 4k',
    4.8, 186, false, null
  ),
  (
    (select id from public.categories where slug = 'gaming'),
    'PlayStation DualSense Wireless Controller',
    'playstation-dualsense',
    'Sony PlayStation DualSense wireless controller for PS5 with haptic feedback, adaptive triggers and a built-in microphone.',
    549000, 639000, 40, 'active',
    'sony playstation dualsense wireless controller ps5 gaming',
    4.8, 711, false, null
  ),
  (
    (select id from public.categories where slug = 'audio'),
    'JBL Flip 6 Portable Bluetooth Speaker',
    'jbl-flip-6',
    'JBL Flip 6 portable Bluetooth speaker with powerful sound, IP67 waterproof and dustproof rating and 12 hours of playtime.',
    899900, 1199900, 35, 'active',
    'jbl flip 6 speaker portable bluetooth waterproof audio',
    4.7, 589, false, null
  ),
  (
    (select id from public.categories where slug = 'accessories'),
    'Anker 737 Power Bank 24,000mAh',
    'anker-737-power-bank',
    'Anker 737 GaNPrime power bank, 24,000mAh capacity with 140W fast charging, smart digital display and USB-C. Charges laptops and phones.',
    1299900, 1699900, 50, 'active',
    'anker 737 power bank 24000mah ganprime fast charging usb-c accessory',
    4.6, 203, false, null
  )
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Subscription products (digital). No compare-at price. Large stock
-- because fulfilment is by code / account, not by physical inventory.
-- ---------------------------------------------------------------------------
insert into public.products
  (category_id, title, slug, description, price_poisha, compare_at_poisha,
   stock, status, search_text, rating, review_count, is_flash_deal, flash_ends_at)
values
  (
    (select id from public.categories where slug = 'subscriptions'),
    'Netflix Premium — 1 Month',
    'netflix-premium-1-month',
    'Netflix Premium subscription for 1 month. Stream in 4K Ultra HD on up to 4 screens at the same time. Account details delivered after purchase.',
    64900, null, 999, 'active',
    'netflix premium subscription 1 month streaming 4k',
    4.8, 412, false, null
  ),
  (
    (select id from public.categories where slug = 'subscriptions'),
    'Amazon Prime — 1 Year',
    'amazon-prime-1-year',
    'Amazon Prime membership for 1 year. Prime Video, fast delivery benefits and exclusive deals. Account details delivered after purchase.',
    149900, null, 999, 'active',
    'amazon prime subscription 1 year prime video membership',
    4.7, 298, false, null
  ),
  (
    (select id from public.categories where slug = 'subscriptions'),
    'YouTube Premium — 1 Month',
    'youtube-premium-1-month',
    'YouTube Premium subscription for 1 month. Ad-free videos, background play and YouTube Music included. Account details delivered after purchase.',
    14900, null, 999, 'active',
    'youtube premium subscription 1 month ad-free music',
    4.8, 531, false, null
  )
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Product images — one image per product. The files live at
-- public/images/products/<slug>.jpg in the Next.js app.
-- ---------------------------------------------------------------------------
insert into public.product_images (product_id, storage_path, alt_text, sort_order)
select id, '/images/products/' || slug || '.jpg', title, 0
from public.products
where slug in (
  'apple-iphone-16-pro-256gb-natural-titanium',
  'sony-wh-1000xm5',
  'macbook-air-13-m3',
  'samsung-galaxy-watch7',
  'samsung-galaxy-s24-ultra',
  'sony-alpha-zv-e10-ii',
  'playstation-dualsense',
  'jbl-flip-6',
  'anker-737-power-bank',
  'netflix-premium-1-month',
  'amazon-prime-1-year',
  'youtube-premium-1-month'
)
on conflict (product_id, storage_path) do nothing;
