BEGIN;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_coordinates_pair_check,
  DROP CONSTRAINT IF EXISTS restaurants_latitude_range_check,
  DROP CONSTRAINT IF EXISTS restaurants_longitude_range_check;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_coordinates_pair_check
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT restaurants_latitude_range_check
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT restaurants_longitude_range_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_normalized_location_key
  ON public.restaurants (lower(btrim(name)), lower(btrim(address)));

CREATE UNIQUE INDEX IF NOT EXISTS dishes_restaurant_normalized_name_key
  ON public.dishes (restaurant_id, lower(btrim(name)));

INSERT INTO public.payment_methods (name)
SELECT method.name
FROM (VALUES ('cash'), ('card')) AS method(name)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payment_methods existing
  WHERE lower(existing.name) = method.name
);

CREATE TABLE IF NOT EXISTS public.restaurant_payment_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id bigint NOT NULL REFERENCES public.restaurants(id),
  submitted_by_user_id uuid DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_name text CHECK (
    submitted_name IS NULL OR char_length(submitted_name) <= 80
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id)
);

ALTER TABLE public.restaurant_payment_observations
  ADD COLUMN IF NOT EXISTS payment_report_id bigint;

ALTER TABLE public.restaurant_payment_observations
  DROP CONSTRAINT IF EXISTS restaurant_payment_observations_report_restaurant_fkey;

ALTER TABLE public.restaurant_payment_observations
  ADD CONSTRAINT restaurant_payment_observations_report_restaurant_fkey
    FOREIGN KEY (payment_report_id, restaurant_id)
    REFERENCES public.restaurant_payment_reports(id, restaurant_id)
    ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS restaurant_payment_reports_restaurant_id_idx
  ON public.restaurant_payment_reports (restaurant_id);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_payment_observations_report_method_key
  ON public.restaurant_payment_observations (payment_report_id, payment_method_id)
  WHERE payment_report_id IS NOT NULL;

ALTER TABLE public.restaurant_payment_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_payment_reports FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_restaurants()
RETURNS TABLE (
  id bigint,
  name text,
  address text,
  latitude double precision,
  longitude double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT r.id, r.name, r.address, r.latitude, r.longitude
  FROM public.restaurants AS r
  ORDER BY lower(r.name), lower(r.address), r.id;
$function$;

CREATE OR REPLACE FUNCTION public.submit_restaurant_payment_report(
  p_restaurant_id bigint,
  p_new_restaurant_name text,
  p_new_restaurant_address text,
  p_cash_accepted boolean,
  p_card_accepted boolean,
  p_submitted_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_restaurant_id bigint;
  v_report_id bigint;
  v_cash_method_id smallint;
  v_card_method_id smallint;
  v_submitted_name text := nullif(btrim(p_submitted_name), '');
BEGIN
  IF p_restaurant_id IS NULL THEN
    IF p_new_restaurant_name IS NULL OR p_new_restaurant_address IS NULL THEN
      RAISE EXCEPTION 'Choose an existing restaurant or provide both a new restaurant name and address.';
    END IF;
  ELSIF p_new_restaurant_name IS NOT NULL OR p_new_restaurant_address IS NOT NULL THEN
    RAISE EXCEPTION 'Choose an existing restaurant or provide both a new restaurant name and address.';
  END IF;

  IF p_cash_accepted IS NULL OR p_card_accepted IS NULL THEN
    RAISE EXCEPTION 'Both cash and card acceptance must be answered.';
  END IF;

  IF v_submitted_name IS NOT NULL AND char_length(v_submitted_name) > 80 THEN
    RAISE EXCEPTION 'The display name must be 80 characters or fewer.';
  END IF;

  IF p_restaurant_id IS NULL THEN
    IF p_new_restaurant_name IS NULL
      OR p_new_restaurant_address IS NULL
      OR char_length(btrim(p_new_restaurant_name)) > 200
      OR char_length(btrim(p_new_restaurant_address)) > 300
      OR btrim(p_new_restaurant_name) = ''
      OR btrim(p_new_restaurant_address) = '' THEN
      RAISE EXCEPTION 'Enter a restaurant name (up to 200 characters) and address (up to 300 characters).';
    END IF;

    INSERT INTO public.restaurants (name, address)
    VALUES (btrim(p_new_restaurant_name), btrim(p_new_restaurant_address))
    ON CONFLICT (lower(btrim(name)), lower(btrim(address)))
    DO UPDATE SET name = public.restaurants.name
    RETURNING id INTO v_restaurant_id;
  ELSE
    SELECT r.id INTO v_restaurant_id
    FROM public.restaurants AS r
    WHERE r.id = p_restaurant_id;

    IF v_restaurant_id IS NULL THEN
      RAISE EXCEPTION 'The selected restaurant does not exist.';
    END IF;
  END IF;

  SELECT pm.id INTO v_cash_method_id
  FROM public.payment_methods AS pm
  WHERE lower(pm.name) = 'cash'
  ORDER BY pm.id
  LIMIT 1;

  SELECT pm.id INTO v_card_method_id
  FROM public.payment_methods AS pm
  WHERE lower(pm.name) = 'card'
  ORDER BY pm.id
  LIMIT 1;

  IF v_cash_method_id IS NULL OR v_card_method_id IS NULL THEN
    RAISE EXCEPTION 'Cash and card payment methods must exist in payment_methods.';
  END IF;

  INSERT INTO public.restaurant_payment_reports (restaurant_id, submitted_name)
  VALUES (v_restaurant_id, v_submitted_name)
  RETURNING id INTO v_report_id;

  INSERT INTO public.restaurant_payment_observations (
    restaurant_id,
    payment_method_id,
    accepted,
    submitted_name,
    payment_report_id
  )
  VALUES
    (v_restaurant_id, v_cash_method_id, p_cash_accepted, v_submitted_name, v_report_id),
    (v_restaurant_id, v_card_method_id, p_card_accepted, v_submitted_name, v_report_id);

  RETURN v_report_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_restaurant_visit(
  p_restaurant_id bigint,
  p_new_restaurant_name text,
  p_new_restaurant_address text,
  p_submitted_name text,
  p_dishes jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_restaurant_id bigint;
  v_visit_id bigint;
  v_dish_item jsonb;
  v_dish_id bigint;
  v_dish_name text;
  v_price_text text;
  v_price numeric;
  v_rating_text text;
  v_rating smallint;
  v_submitted_name text := nullif(btrim(p_submitted_name), '');
  v_seen_names text[] := ARRAY[]::text[];
BEGIN
  IF p_restaurant_id IS NULL THEN
    IF p_new_restaurant_name IS NULL OR p_new_restaurant_address IS NULL THEN
      RAISE EXCEPTION 'Choose an existing restaurant or provide both a new restaurant name and address.';
    END IF;
  ELSIF p_new_restaurant_name IS NOT NULL OR p_new_restaurant_address IS NOT NULL THEN
    RAISE EXCEPTION 'Choose an existing restaurant or provide both a new restaurant name and address.';
  END IF;

  IF v_submitted_name IS NOT NULL AND char_length(v_submitted_name) > 80 THEN
    RAISE EXCEPTION 'The display name must be 80 characters or fewer.';
  END IF;

  IF p_dishes IS NULL OR jsonb_typeof(p_dishes) <> 'array' THEN
    RAISE EXCEPTION 'A visit must include between one and four dishes.';
  END IF;

  IF jsonb_array_length(p_dishes) < 1 OR jsonb_array_length(p_dishes) > 4 THEN
    RAISE EXCEPTION 'A visit must include between one and four dishes.';
  END IF;

  IF p_restaurant_id IS NULL THEN
    IF p_new_restaurant_name IS NULL
      OR p_new_restaurant_address IS NULL
      OR char_length(btrim(p_new_restaurant_name)) > 200
      OR char_length(btrim(p_new_restaurant_address)) > 300
      OR btrim(p_new_restaurant_name) = ''
      OR btrim(p_new_restaurant_address) = '' THEN
      RAISE EXCEPTION 'Enter a restaurant name (up to 200 characters) and address (up to 300 characters).';
    END IF;

    INSERT INTO public.restaurants (name, address)
    VALUES (btrim(p_new_restaurant_name), btrim(p_new_restaurant_address))
    ON CONFLICT (lower(btrim(name)), lower(btrim(address)))
    DO UPDATE SET name = public.restaurants.name
    RETURNING id INTO v_restaurant_id;
  ELSE
    SELECT r.id INTO v_restaurant_id
    FROM public.restaurants AS r
    WHERE r.id = p_restaurant_id;

    IF v_restaurant_id IS NULL THEN
      RAISE EXCEPTION 'The selected restaurant does not exist.';
    END IF;
  END IF;

  INSERT INTO public.restaurant_visits (restaurant_id, submitted_name)
  VALUES (v_restaurant_id, v_submitted_name)
  RETURNING id INTO v_visit_id;

  FOR v_dish_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_dishes) AS item(value)
  LOOP
    IF jsonb_typeof(v_dish_item) <> 'object' THEN
      RAISE EXCEPTION 'Each dish must include a name, price, and rating.';
    END IF;

    v_dish_name := nullif(btrim(v_dish_item ->> 'name'), '');
    v_price_text := v_dish_item ->> 'price';
    v_rating_text := v_dish_item ->> 'rating';

    IF v_dish_name IS NULL OR char_length(v_dish_name) > 200 THEN
      RAISE EXCEPTION 'Dish names must be between 1 and 200 characters.';
    END IF;

    IF lower(v_dish_name) = ANY(v_seen_names) THEN
      RAISE EXCEPTION 'Each dish can only be listed once per visit.';
    END IF;
    v_seen_names := array_append(v_seen_names, lower(v_dish_name));

    IF v_price_text IS NULL OR v_price_text !~ '^[0-9]{1,5}([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Dish prices must be EUR amounts from 0 to 99999.99 with at most two decimals.';
    END IF;
    v_price := v_price_text::numeric;

    IF v_rating_text IS NULL OR v_rating_text !~ '^[1-5]$' THEN
      RAISE EXCEPTION 'Dish ratings must be whole numbers from 1 to 5.';
    END IF;
    v_rating := v_rating_text::smallint;

    INSERT INTO public.dishes (restaurant_id, name)
    VALUES (v_restaurant_id, v_dish_name)
    ON CONFLICT (restaurant_id, (lower(btrim(name))) )
    DO NOTHING;

    SELECT d.id INTO v_dish_id
    FROM public.dishes AS d
    WHERE d.restaurant_id = v_restaurant_id
      AND lower(btrim(d.name)) = lower(v_dish_name);

    IF v_dish_id IS NULL THEN
      RAISE EXCEPTION 'Could not find or create the dish record.';
    END IF;

    INSERT INTO public.visit_items (
      restaurant_id,
      visit_id,
      dish_id,
      quantity,
      price,
      currency_code
    )
    VALUES (v_restaurant_id, v_visit_id, v_dish_id, 1, v_price, 'EUR');

    INSERT INTO public.dish_reviews (
      restaurant_id,
      dish_id,
      visit_id,
      rating,
      submitted_name
    )
    VALUES (v_restaurant_id, v_dish_id, v_visit_id, v_rating, v_submitted_name);
  END LOOP;

  RETURN v_visit_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_restaurants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_restaurant_payment_report(bigint, text, text, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_restaurant_visit(bigint, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_restaurants() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_restaurant_payment_report(bigint, text, text, boolean, boolean, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_restaurant_visit(bigint, text, text, text, jsonb)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
