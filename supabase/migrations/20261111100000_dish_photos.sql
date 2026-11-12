BEGIN;

CREATE TABLE IF NOT EXISTS public.dish_photos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visit_item_id bigint NOT NULL UNIQUE
    REFERENCES public.visit_items(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dish_photos_storage_path_format CHECK (
    storage_path ~ '^dish-photos/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](webp|jpg|jpeg|png)$'
  )
);

ALTER TABLE public.dish_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dish_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dish_photos TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read dish photos" ON public.dish_photos;
CREATE POLICY "Public can read dish photos"
  ON public.dish_photos
  FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dish-photos',
  'dish-photos',
  true,
  1500000,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can read dish photo objects" ON storage.objects;
CREATE POLICY "Public can read dish photo objects"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'dish-photos');

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
  v_visit_item_id bigint;
  v_dish_item jsonb;
  v_dish_id bigint;
  v_dish_name text;
  v_price_text text;
  v_price numeric;
  v_rating_text text;
  v_rating smallint;
  v_photo_path text;
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
    v_photo_path := nullif(v_dish_item ->> 'photo_path', '');

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

    IF v_photo_path IS NOT NULL
      AND v_photo_path !~ '^dish-photos/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](webp|jpg|jpeg|png)$' THEN
      RAISE EXCEPTION 'The dish photo path is invalid.';
    END IF;

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
    VALUES (v_restaurant_id, v_visit_id, v_dish_id, 1, v_price, 'EUR')
    RETURNING id INTO v_visit_item_id;

    IF v_photo_path IS NOT NULL THEN
      INSERT INTO public.dish_photos (visit_item_id, storage_path)
      VALUES (v_visit_item_id, v_photo_path);
    END IF;

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

REVOKE ALL ON FUNCTION public.submit_restaurant_visit(bigint, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_restaurant_visit(bigint, text, text, text, jsonb)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
