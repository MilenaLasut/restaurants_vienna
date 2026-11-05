import { useEffect, useState, type FormEvent } from 'react';
import { createClient } from '@supabase/supabase-js';

type Page = 'home' | 'add' | 'map';

function App() {
  const [page, setPage] = useState<Page>('home');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [restaurants, setRestaurants] = useState<string[]>([]);
  const [isLoadingRestaurants, setIsLoadingRestaurants] = useState(false);
  const [restaurantListError, setRestaurantListError] = useState('');
  const [restaurantListRefresh, setRestaurantListRefresh] = useState(0);

  useEffect(() => {
    if (page !== 'map') return;

    let isCurrentRequest = true;
    async function loadRestaurants() {
      setIsLoadingRestaurants(true);
      setRestaurantListError('');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        setRestaurantListError('Supabase is not configured. Add the project URL and public anon key to .env.local, then restart the dev server.');
        setIsLoadingRestaurants(false);
        return;
      }

      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase
          .from('restaurant_votes')
          .select('restaurant_name')
          .not('restaurant_name', 'is', null)
          .order('restaurant_name');

        if (error) {
          throw new Error(error.message);
        }

        if (isCurrentRequest) {
          const uniqueNames = new Map<string, string>();
          for (const row of data) {
            const name = row.restaurant_name?.trim();
            if (name) uniqueNames.set(name.toLocaleLowerCase(), name);
          }
          setRestaurants([...uniqueNames.values()].sort((a, b) => a.localeCompare(b)));
        }
      } catch (error) {
        if (isCurrentRequest) {
          setRestaurantListError(
            `Could not load restaurants: ${error instanceof Error ? error.message : 'Please try again.'}`,
          );
        }
      } finally {
        if (isCurrentRequest) setIsLoadingRestaurants(false);
      }
    }

    void loadRestaurants();
    return () => {
      isCurrentRequest = false;
    };
  }, [page, restaurantListRefresh]);

  async function handleAddVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage('');

    const form = event.currentTarget;
    const values = new FormData(form);
    const displayName = String(values.get('user') ?? '').trim();
    const restaurantName = String(values.get('restaurant_name') ?? '').trim();
    const dishName = String(values.get('dish_name') ?? '').trim();
    const price = Number(values.get('price_eur'));
    const rating = Number(values.get('rating'));
    const cardPayment = values.get('card_payment');

    if (!displayName || !restaurantName || !dishName || !Number.isFinite(price) || price < 0 ||
      !Number.isInteger(rating) || rating < 1 || rating > 5 || (cardPayment !== 'true' && cardPayment !== 'false')) {
      setFormMessage('Please fill in each field with a valid value.');
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      setFormMessage('Supabase is not configured yet. Add the project URL and public anon key to .env.local, then restart the dev server.');
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error } = await supabase.from('restaurant_votes').insert({
        user: displayName,
        restaurant_name: restaurantName,
        dish_name: dishName,
        price_eur: price,
        card_payment: cardPayment === 'true',
        rating,
      });

      if (error) {
        setFormMessage(`Could not save your visit: ${error.message}`);
        return;
      }

      form.reset();
      setFormMessage('Your restaurant visit was saved. Thanks for sharing!');
    } catch (error) {
      setFormMessage(
        `Could not connect to Supabase: ${error instanceof Error ? error.message : 'Please check your connection and try again.'}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (page !== 'home') {
    const isAddPage = page === 'add';

    return (
      <main className="shell">
        <header className="topbar">
          <span className="brand-mark" aria-hidden="true">V</span>
          <span>Vienna Restaurant Journal</span>
        </header>
        {isAddPage ? (
          <section className="form-card" aria-labelledby="page-title">
            <p className="eyebrow">YOUR SHARED FOOD JOURNAL</p>
            <h1 id="page-title">Add a restaurant visit</h1>
            <p className="intro">Share what you tried with your friends.</p>
            <form className="visit-form" onSubmit={handleAddVisit}>
              <label>
                Your name
                <input autoComplete="name" name="user" required maxLength={100} />
              </label>
              <label>
                Restaurant
                <input name="restaurant_name" required maxLength={200} />
              </label>
              <label>
                Dish
                <input name="dish_name" required maxLength={200} />
              </label>
              <div className="form-row">
                <label>
                  Price (EUR)
                  <input name="price_eur" type="number" min="0" step="0.01" required />
                </label>
                <label>
                  Rating
                  <select name="rating" defaultValue="" required>
                    <option value="" disabled>Select 1–5</option>
                    <option value="1">1 – Not for me</option>
                    <option value="2">2 – Okay</option>
                    <option value="3">3 – Good</option>
                    <option value="4">4 – Great</option>
                    <option value="5">5 – Loved it</option>
                  </select>
                </label>
              </div>
              <label>
                Did you pay by card?
                <select name="card_payment" defaultValue="" required>
                  <option value="" disabled>Choose an answer</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <button className="submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save visit'}
              </button>
              {formMessage && <p className="form-message" role="status">{formMessage}</p>}
            </form>
            <button className="back-button" onClick={() => setPage('home')} type="button">
              <span aria-hidden="true">←</span> Back to home
            </button>
          </section>
        ) : (
          <section className="restaurant-card" aria-labelledby="page-title">
            <p className="eyebrow">YOUR SHARED FOOD JOURNAL</p>
            <h1 id="page-title">Restaurant map</h1>
            <p className="intro">The map is coming later. For now, here are the restaurants your friends have shared.</p>
            <div className="restaurant-list-section" aria-labelledby="restaurant-list-title">
              <h2 id="restaurant-list-title">Restaurants</h2>
              {isLoadingRestaurants ? (
                <p className="list-status" role="status">Loading restaurants…</p>
              ) : restaurantListError ? (
                <div>
                  <p className="list-status list-error" role="alert">{restaurantListError}</p>
                  <button
                    className="retry-button"
                    onClick={() => setRestaurantListRefresh((refresh) => refresh + 1)}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : restaurants.length > 0 ? (
                <ul className="restaurant-list">
                  {restaurants.map((name) => <li key={name}>{name}</li>)}
                </ul>
              ) : (
                <p className="list-status">No restaurants have been added yet.</p>
              )}
            </div>
            <button className="back-button" onClick={() => setPage('home')} type="button">
              <span aria-hidden="true">←</span> Back to home
            </button>
          </section>
        )}
        <footer className="footer">Made for sharing good meals in Vienna.</footer>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand-mark" aria-hidden="true">V</span>
        <span>Vienna Restaurant Journal</span>
      </header>

      <section className="hero" aria-labelledby="welcome-title">
        <p className="eyebrow">A LITTLE NOTEBOOK FOR YOUR FRIEND GROUP</p>
        <h1 id="welcome-title">Good meals are<br />better shared.</h1>
        <p className="intro">
          Keep track of the places you visit, the dishes you love, and the memories you make together.
        </p>
      </section>

      <nav className="actions" aria-label="Main navigation">
        <button className="action-card action-primary" onClick={() => setPage('add')} type="button">
          <span className="action-icon" aria-hidden="true">＋</span>
          <span className="action-copy">
            <strong>Add a restaurant</strong>
            <span>Share a dish, a price, and your thoughts</span>
          </span>
          <span className="action-arrow" aria-hidden="true">↗</span>
        </button>
        <button className="action-card action-secondary" onClick={() => setPage('map')} type="button">
          <span className="action-icon" aria-hidden="true">⌖</span>
          <span className="action-copy">
            <strong>Explore the map</strong>
            <span>See the places your friends recommend</span>
          </span>
          <span className="action-arrow" aria-hidden="true">↗</span>
        </button>
      </nav>

      <footer className="footer">Made for sharing good meals in Vienna.</footer>
    </main>
  );
}

export default App;
