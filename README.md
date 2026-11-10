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
3. Run the SQL in `supabase/migrations/20261110183000_restaurant_submission_workflows.sql` once in the Supabase SQL Editor. The migration adds optional coordinates, creates a parent record for grouped cash/card reports, prevents duplicate restaurant locations and per-restaurant dishes, and adds the RPCs used by the app.
4. Restart the Vite development server after changing `.env.local`.

The app loads restaurant names and addresses through the `list_restaurants` RPC and saves submissions through transactional database RPCs. The functions are executable by the `anon` role to support the current no-login workflow, so anyone who can reach the deployed site can submit data. Before a public launch, add appropriate abuse protection such as rate limiting or CAPTCHA. The browser app must use only the public publishable/anon key; never put a database password or service-role key in this repository.

## Current status

The home screen supports separate payment reports and restaurant visits. A visit can contain one to four dish ratings and prices; payment reports collect cash and card acceptance separately. Both workflows can select an existing restaurant or add a new location, and the restaurant list shows each canonical location once. Latitude and longitude are optional for future map pins; an interactive map and photo upload remain future steps.
