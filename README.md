# Vienna Restaurant Journal

A mobile-friendly website for friends to record restaurant visits in Vienna.

## Run the project locally

1. Install the current Node.js LTS version from [nodejs.org](https://nodejs.org/). This also installs npm, the tool used to install the project's packages.
2. Open this repository folder in VS Code.
3. Open **Terminal → New Terminal** and run `npm install` once to install the project packages.
4. Run `npm run dev` and open the local address printed in the terminal.

To check that the project is ready for deployment, run `npm run build`.

## Deploy to Vercel

The site can be hosted on Vercel when you are ready. You will need to push this project to a GitHub repository first.

1. Sign in to [Vercel](https://vercel.com/) and choose **Add New → Project**.
2. Connect your GitHub account, find this repository, and choose **Import**.
3. Vercel should detect the project as Vite. Check the build command is `npm run build` and the output directory is `dist`, then choose **Deploy**.
4. When the deployment finishes, open the Vercel URL to view the hosted site.

Vercel can deploy future changes automatically when you push them to GitHub. The site can be viewed without Supabase settings, but saving restaurant visits requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project's **Settings → Environment Variables**. Do not add a database password or service-role key.

## Supabase setup

The app uses the `public.restaurants` table as the canonical list of restaurant locations. Payment reports and visits are stored in the normalized payment, visit, dish, item, and review tables; `public.restaurant_votes` is not used.

1. Copy `.env.example` to `.env.local`.
2. In the Supabase dashboard, open the project's API settings and copy the project URL and public publishable/anon key into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. If not already applied, run `supabase/migrations/20261110183000_restaurant_submission_workflows.sql` in the Supabase SQL Editor. It adds optional coordinates, grouped cash/card reports, restaurant/dish uniqueness, and the app RPCs.
4. Run `supabase/migrations/20261111100000_dish_photos.sql`. It creates a private-write/public-read `dish-photos` bucket, stores each photo's path against its individual visit item, and updates the visit RPC to save those links.
5. To enable dish-photo submissions, create a Cloudflare Turnstile widget for your local and production hostnames. Put its **site key** in `.env.local` as `VITE_TURNSTILE_SITE_KEY`, then add that same public setting to Vercel. The Turnstile **secret key** must only be stored in Supabase Edge Function secrets, never in the frontend.
6. Deploy the Edge Function from the repository root with the Supabase CLI linked to your project: `supabase functions deploy submit-visit-with-photos`. In Supabase **Project Settings → Edge Functions → Secrets**, set `TURNSTILE_SECRET_KEY` and `ALLOWED_ORIGINS` to a comma-separated list of exact origins, for example `http://localhost:5173,https://your-site.vercel.app`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
7. Restart the Vite development server after changing `.env.local`.

The app loads restaurant names and addresses through the `list_restaurants` RPC and saves submissions through transactional database RPCs. Photo uploads go through the Edge Function, which verifies Turnstile server-side, uploads objects with the service-role key, and removes uploaded objects if the database save fails. The bucket has public read access because photos are intended to be visible, but browser uploads are not permitted. The no-login submission RPCs can still be reached by anyone; Turnstile protects photo uploads, not the payment or photo-free visit flows. The browser app must use only the public publishable/anon key; never put a database password, Turnstile secret, or service-role key in this repository.

## Current status

The home screen supports separate payment reports and restaurant visits. A visit can contain one to four dish ratings and prices, with one optional photo per dish; payment reports collect cash and card acceptance separately. Photos are resized in the browser to 1600 px or less and 1 MB or less before upload. Both workflows can select an existing restaurant or add a new location, and the restaurant list shows each canonical location once. Latitude and longitude are optional for future map pins; an interactive map remains a future step.
