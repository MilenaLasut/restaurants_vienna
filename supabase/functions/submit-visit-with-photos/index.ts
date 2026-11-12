import { createClient } from 'npm:@supabase/supabase-js@2';

const bucket = 'dish-photos';
const maxPhotoBytes = 1_000_000;
const maxRequestBytes = 4_500_000;

type VisitSubmission = {
  restaurantId: number | null;
  newRestaurantName: string | null;
  newRestaurantAddress: string | null;
  submittedName: string | null;
  dishes: { name: string; price: number; rating: number }[];
};

class SubmissionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function response(
  status: number,
  body: Record<string, unknown>,
  origin: string,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

function getAllowedOrigins() {
  const configuredOrigins = Deno.env.get('ALLOWED_ORIGINS');
  if (!configuredOrigins) throw new Error('ALLOWED_ORIGINS is not configured.');
  return new Set(configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSubmission(value: unknown): VisitSubmission {
  if (!isRecord(value)) throw new Error('The visit details are invalid.');

  const {
    restaurantId,
    newRestaurantName,
    newRestaurantAddress,
    submittedName,
    dishes,
  } = value;
  if (restaurantId !== null && (!Number.isSafeInteger(restaurantId) || Number(restaurantId) < 1)) {
    throw new Error('Choose a valid restaurant.');
  }
  if (restaurantId === null) {
    if (typeof newRestaurantName !== 'string' || !newRestaurantName.trim() ||
      newRestaurantName.trim().length > 200 ||
      typeof newRestaurantAddress !== 'string' || !newRestaurantAddress.trim() ||
      newRestaurantAddress.trim().length > 300) {
      throw new Error('Enter a restaurant name and address.');
    }
  } else if (newRestaurantName !== null || newRestaurantAddress !== null) {
    throw new Error('Choose an existing restaurant or enter a new one, not both.');
  }

  if (submittedName !== null &&
    (typeof submittedName !== 'string' || submittedName.trim().length > 80)) {
    throw new Error('The display name must be 80 characters or fewer.');
  }
  if (!Array.isArray(dishes) || dishes.length < 1 || dishes.length > 4) {
    throw new Error('A visit must include between one and four dishes.');
  }

  const names = new Set<string>();
  const validatedDishes = dishes.map((dish) => {
    if (!isRecord(dish) || typeof dish.name !== 'string' ||
      !dish.name.trim() || dish.name.trim().length > 200 ||
      typeof dish.price !== 'number' || !Number.isFinite(dish.price) ||
      !/^[0-9]{1,5}([.][0-9]{1,2})?$/.test(String(dish.price)) ||
      typeof dish.rating !== 'number' || !Number.isInteger(dish.rating) ||
      dish.rating < 1 || dish.rating > 5) {
      throw new Error('Each dish needs a name, valid EUR price, and rating from 1 to 5.');
    }
    const normalizedName = dish.name.trim().toLocaleLowerCase();
    if (names.has(normalizedName)) throw new Error('Each dish can only be listed once per visit.');
    names.add(normalizedName);
    return { name: dish.name.trim(), price: dish.price, rating: dish.rating };
  });

  return {
    restaurantId: restaurantId === null ? null : Number(restaurantId),
    newRestaurantName: typeof newRestaurantName === 'string' ? newRestaurantName.trim() : null,
    newRestaurantAddress: typeof newRestaurantAddress === 'string' ? newRestaurantAddress.trim() : null,
    submittedName: typeof submittedName === 'string' ? submittedName.trim() || null : null,
    dishes: validatedDishes,
  };
}

function isValidImage(type: string, bytes: Uint8Array) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (type === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

Deno.serve(async (request) => {
  let allowedOrigins: Set<string>;
  try {
    allowedOrigins = getAllowedOrigins();
  } catch (error) {
    console.error(error);
    return Response.json({ message: 'Photo uploads are not configured.' }, { status: 500 });
  }

  const origin = request.headers.get('origin') ?? '';
  if (!origin || !allowedOrigins.has(origin)) {
    return new Response('Origin not allowed.', { status: 403 });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }
  if (request.method !== 'POST') return response(405, { message: 'Use POST for photo submissions.' }, origin);

  const apiKeys = [
    Deno.env.get('SUPABASE_ANON_KEY'),
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY'),
  ].filter((key): key is string => Boolean(key));
  if (!apiKeys.some((key) => request.headers.get('apikey') === key)) {
    return response(401, { message: 'The request could not be authenticated.' }, origin);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxRequestBytes) {
    return response(413, { message: 'The photos are too large to upload together.' }, origin);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return response(400, { message: 'The photo upload request is malformed.' }, origin);
  }

  const token = form.get('turnstileToken');
  const submissionText = form.get('submission');
  if (typeof token !== 'string' || !token || typeof submissionText !== 'string') {
    return response(400, { message: 'Complete the human check and provide visit details.' }, origin);
  }

  let submission: VisitSubmission;
  try {
    submission = validateSubmission(JSON.parse(submissionText));
  } catch (error) {
    return response(400, { message: error instanceof Error ? error.message : 'The visit details are invalid.' }, origin);
  }

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!turnstileSecret) {
    return response(500, { message: 'Photo uploads are not configured.' }, origin);
  }
  const verification = new URLSearchParams({ secret: turnstileSecret, response: token });
  let captchaResult: { success?: boolean; action?: string };
  try {
    const captchaResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verification,
    });
    captchaResult = await captchaResponse.json();
  } catch (error) {
    console.error('Turnstile verification request failed.', error);
    return response(502, { message: 'The human check could not be verified. Please try again.' }, origin);
  }
  if (!captchaResult.success || captchaResult.action !== 'dish_photo_upload') {
    return response(400, { message: 'The human check expired or was not completed. Please try again.' }, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, { message: 'Photo uploads are not configured.' }, origin);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const uploadedPaths: string[] = [];
  try {
    const dishesWithPhotos = [];
    for (let index = 0; index < submission.dishes.length; index += 1) {
      const photoPart = form.get(`photo_${index}`);
      let photoPath: string | null = null;
      if (photoPart !== null) {
        if (!(photoPart instanceof File) || photoPart.size < 1 || photoPart.size > maxPhotoBytes) {
          throw new SubmissionError('Each compressed photo must be between 1 byte and 1 MB.', 400);
        }
        const bytes = new Uint8Array(await photoPart.arrayBuffer());
        if (!isValidImage(photoPart.type, bytes)) {
          throw new SubmissionError('A photo was not a valid JPEG, PNG, or WebP image.', 400);
        }
        const extension = photoPart.type === 'image/jpeg'
          ? 'jpg'
          : photoPart.type === 'image/png' ? 'png' : 'webp';
        photoPath = `dish-photos/${crypto.randomUUID()}.${extension}`;
        uploadedPaths.push(photoPath);
        const { error } = await admin.storage.from(bucket).upload(photoPath, bytes, {
          contentType: photoPart.type,
          cacheControl: '31536000',
          upsert: false,
        });
        if (error) throw new Error(`Could not upload a dish photo: ${error.message}`);
      }
      dishesWithPhotos.push({ ...submission.dishes[index], photo_path: photoPath });
    }

    const { error } = await admin.rpc('submit_restaurant_visit', {
      p_restaurant_id: submission.restaurantId,
      p_new_restaurant_name: submission.newRestaurantName,
      p_new_restaurant_address: submission.newRestaurantAddress,
      p_submitted_name: submission.submittedName,
      p_dishes: dishesWithPhotos,
    });
    if (error) throw new Error(`Could not save the visit: ${error.message}`);

    return response(200, { message: 'Visit and photos saved.' }, origin);
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        const { error: cleanupError } = await admin.storage.from(bucket).remove(uploadedPaths);
        if (cleanupError) throw cleanupError;
      } catch (cleanupError) {
        console.error('Could not remove uploaded photos after a failed visit submission.', cleanupError);
        return response(500, {
          message: `${error instanceof Error ? error.message : 'The visit could not be saved.'} Uploaded photos could not be cleaned up; contact the site owner.`,
        }, origin);
      }
    }
    return response(error instanceof SubmissionError ? error.status : 500, {
      message: error instanceof Error ? error.message : 'The visit and photos could not be saved.',
    }, origin);
  }
});
