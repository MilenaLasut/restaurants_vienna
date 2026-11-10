import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Page = 'home' | 'payment' | 'visit' | 'map';
type Restaurant = {
  id: number;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};
type DishDraft = { key: number; name: string; price: string; rating: string };
type AppDatabase = {
  public: {
    Tables: {};
    Views: {};
    Functions: {
      list_restaurants: { Args: Record<string, never>; Returns: Restaurant[] };
      submit_restaurant_payment_report: {
        Args: {
          p_restaurant_id: number | null;
          p_new_restaurant_name: string | null;
          p_new_restaurant_address: string | null;
          p_cash_accepted: boolean;
          p_card_accepted: boolean;
          p_submitted_name: string | null;
        };
        Returns: number;
      };
      submit_restaurant_visit: {
        Args: {
          p_restaurant_id: number | null;
          p_new_restaurant_name: string | null;
          p_new_restaurant_address: string | null;
          p_submitted_name: string | null;
          p_dishes: { name: string; price: number; rating: number }[];
        };
        Returns: number;
      };
    };
  };
};
let supabaseClient: SupabaseClient<AppDatabase> | undefined;

type RestaurantFieldsProps = {
  restaurants: Restaurant[];
  selectedRestaurantId: number | null;
  onSelectRestaurant: (id: number | null) => void;
  isAddingRestaurant: boolean;
  onToggleAddRestaurant: () => void;
  newRestaurantName: string;
  onNewRestaurantNameChange: (name: string) => void;
  newRestaurantAddress: string;
  onNewRestaurantAddressChange: (address: string) => void;
};

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured. Add the project URL and public anon key to .env.local, then restart the dev server.');
  }
  supabaseClient = createClient<AppDatabase>(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Please try again.';
}

function RestaurantFields({
  restaurants,
  selectedRestaurantId,
  onSelectRestaurant,
  isAddingRestaurant,
  onToggleAddRestaurant,
  newRestaurantName,
  onNewRestaurantNameChange,
  newRestaurantAddress,
  onNewRestaurantAddressChange,
}: RestaurantFieldsProps) {
  const matchingLocation = isAddingRestaurant && newRestaurantName.trim() && newRestaurantAddress.trim()
    ? restaurants.find((restaurant) =>
        restaurant.name.trim().toLocaleLowerCase() === newRestaurantName.trim().toLocaleLowerCase() &&
        restaurant.address.trim().toLocaleLowerCase() === newRestaurantAddress.trim().toLocaleLowerCase())
    : undefined;

  return (
    <fieldset className="restaurant-choice">
      <legend>Restaurant</legend>
      {!isAddingRestaurant ? (
        <label>
          Choose a restaurant
          <select
            name="restaurant_id"
            value={selectedRestaurantId ?? ''}
            onChange={(event) => onSelectRestaurant(event.target.value ? Number(event.target.value) : null)}
            required
          >
            <option value="">Select a restaurant</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name} — {restaurant.address}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="new-restaurant-fields">
          <label>
            Restaurant name
            <input
              autoComplete="organization"
              name="new_restaurant_name"
              value={newRestaurantName}
              onChange={(event) => onNewRestaurantNameChange(event.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label>
            Address
            <input
              autoComplete="street-address"
              name="new_restaurant_address"
              value={newRestaurantAddress}
              onChange={(event) => onNewRestaurantAddressChange(event.target.value)}
              maxLength={300}
              required
            />
          </label>
          {matchingLocation && (
            <div className="duplicate-warning" role="status">
              <span>
                This location is already listed as {matchingLocation.name} — {matchingLocation.address}.
              </span>
              <button
                className="text-button"
                onClick={() => {
                  onToggleAddRestaurant();
                  onSelectRestaurant(matchingLocation.id);
                }}
                type="button"
              >
                Use existing restaurant
              </button>
            </div>
          )}
        </div>
      )}
      <button className="secondary-button" onClick={onToggleAddRestaurant} type="button">
        {isAddingRestaurant ? 'Choose an existing restaurant instead' : 'Add a new restaurant'}
      </button>
    </fieldset>
  );
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [isLoadingRestaurants, setIsLoadingRestaurants] = useState(false);
  const [restaurantListError, setRestaurantListError] = useState('');
  const [restaurantListRefresh, setRestaurantListRefresh] = useState(0);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | null>(null);
  const [isAddingRestaurant, setIsAddingRestaurant] = useState(false);
  const [newRestaurantName, setNewRestaurantName] = useState('');
  const [newRestaurantAddress, setNewRestaurantAddress] = useState('');
  const [cashAccepted, setCashAccepted] = useState(false);
  const [cardAccepted, setCardAccepted] = useState(false);
  const [dishDrafts, setDishDrafts] = useState<DishDraft[]>([
    { key: 0, name: '', price: '', rating: '' },
  ]);
  const nextDishKey = useRef(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [formMessageIsError, setFormMessageIsError] = useState(false);

  useEffect(() => {
    if (page === 'home') return;

    let isCurrentRequest = true;
    async function loadRestaurants() {
      setIsLoadingRestaurants(true);
      setRestaurantListError('');

      try {
        const { data, error } = await getSupabaseClient().rpc('list_restaurants');
        if (error) throw error;

        if (isCurrentRequest) {
          setRestaurants(data ?? []);
        }
      } catch (error) {
        if (isCurrentRequest) {
          setRestaurantListError(`Could not load restaurants: ${errorMessage(error)}`);
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

  function resetRestaurantFields() {
    setSelectedRestaurantId(null);
    setIsAddingRestaurant(false);
    setNewRestaurantName('');
    setNewRestaurantAddress('');
  }

  function startPage(nextPage: Page) {
    setFormMessage('');
    setFormMessageIsError(false);
    resetRestaurantFields();
    setCashAccepted(false);
    setCardAccepted(false);
    setDishDrafts([{ key: nextDishKey.current++, name: '', price: '', rating: '' }]);
    setPage(nextPage);
  }

  function toggleAddRestaurant() {
    setIsAddingRestaurant((adding) => !adding);
    setSelectedRestaurantId(null);
    setNewRestaurantName('');
    setNewRestaurantAddress('');
  }

  function reportFormError(message: string) {
    setFormMessage(message);
    setFormMessageIsError(true);
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage('');
    setFormMessageIsError(false);

    const form = event.currentTarget;
    const values = new FormData(form);
    if (!isAddingRestaurant && selectedRestaurantId === null) {
      reportFormError('Choose a restaurant or add a new one.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await getSupabaseClient().rpc('submit_restaurant_payment_report', {
        p_restaurant_id: isAddingRestaurant ? null : selectedRestaurantId,
        p_new_restaurant_name: isAddingRestaurant ? newRestaurantName.trim() : null,
        p_new_restaurant_address: isAddingRestaurant ? newRestaurantAddress.trim() : null,
        p_cash_accepted: cashAccepted,
        p_card_accepted: cardAccepted,
        p_submitted_name: String(values.get('submitted_name') ?? '').trim() || null,
      });
      if (error) throw error;

      form.reset();
      resetRestaurantFields();
      setCashAccepted(false);
      setCardAccepted(false);
      setFormMessage('Payment information saved. Thanks for helping everyone plan ahead!');
      setRestaurantListRefresh((refresh) => refresh + 1);
    } catch (error) {
      reportFormError(`Could not save payment information: ${errorMessage(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVisitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage('');
    setFormMessageIsError(false);

    if (!isAddingRestaurant && selectedRestaurantId === null) {
      reportFormError('Choose a restaurant or add a new one.');
      return;
    }

    if (dishDrafts.length < 1 || dishDrafts.length > 4) {
      reportFormError('Add between one and four dishes to the visit.');
      return;
    }

    const dishes = dishDrafts.map((dish) => ({
      name: dish.name.trim(),
      price: Number(dish.price),
      rating: Number(dish.rating),
    }));
    const invalidDish = dishDrafts.some((dish, index) =>
      !dish.name.trim() ||
      dish.name.trim().length > 200 ||
      !/^\d{1,5}(\.\d{1,2})?$/.test(dish.price) ||
      !Number.isFinite(dishes[index].price) ||
      !Number.isInteger(dishes[index].rating) ||
      dishes[index].rating < 1 ||
      dishes[index].rating > 5);
    if (invalidDish) {
      reportFormError('Each dish needs a name, a price from 0 to 99,999.99 EUR, and a rating from 1 to 5.');
      return;
    }

    const duplicateDish = dishes.find((dish, index) =>
      dishes.findIndex((other) => other.name.toLocaleLowerCase() === dish.name.toLocaleLowerCase()) !== index);
    if (duplicateDish) {
      reportFormError('Each dish can only be listed once per visit.');
      return;
    }

    const form = event.currentTarget;
    const values = new FormData(form);
    setIsSubmitting(true);
    try {
      const { error } = await getSupabaseClient().rpc('submit_restaurant_visit', {
        p_restaurant_id: isAddingRestaurant ? null : selectedRestaurantId,
        p_new_restaurant_name: isAddingRestaurant ? newRestaurantName.trim() : null,
        p_new_restaurant_address: isAddingRestaurant ? newRestaurantAddress.trim() : null,
        p_submitted_name: String(values.get('submitted_name') ?? '').trim() || null,
        p_dishes: dishes,
      });
      if (error) throw error;

      form.reset();
      resetRestaurantFields();
      setDishDrafts([{ key: nextDishKey.current++, name: '', price: '', rating: '' }]);
      setFormMessage('Your visit was saved. Thanks for sharing!');
      setRestaurantListRefresh((refresh) => refresh + 1);
    } catch (error) {
      reportFormError(`Could not save the visit: ${errorMessage(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateDish(key: number, field: 'name' | 'price' | 'rating', value: string) {
    setDishDrafts((drafts) =>
      drafts.map((dish) => dish.key === key ? { ...dish, [field]: value } : dish));
  }

  if (page !== 'home') {
    const isPaymentPage = page === 'payment';
    const isVisitPage = page === 'visit';

    return (
      <main className="shell">
        <header className="topbar">
          <span className="brand-mark" aria-hidden="true">V</span>
          <span>Vienna Restaurant Journal</span>
        </header>

        {isPaymentPage && (
          <section className="form-card" aria-labelledby="page-title">
            <p className="eyebrow">YOUR SHARED FOOD JOURNAL</p>
            <h1 id="page-title">Share payment options</h1>
            <p className="intro">Let your friends know whether this restaurant accepts cash and card.</p>
            <form className="visit-form" onSubmit={handlePaymentSubmit}>
              <RestaurantFields
                restaurants={restaurants}
                selectedRestaurantId={selectedRestaurantId}
                onSelectRestaurant={setSelectedRestaurantId}
                isAddingRestaurant={isAddingRestaurant}
                onToggleAddRestaurant={toggleAddRestaurant}
                newRestaurantName={newRestaurantName}
                onNewRestaurantNameChange={setNewRestaurantName}
                newRestaurantAddress={newRestaurantAddress}
                onNewRestaurantAddressChange={setNewRestaurantAddress}
              />
              {isLoadingRestaurants && <p className="list-status" role="status">Loading restaurants…</p>}
              {restaurantListError && (
                <div>
                  <p className="list-status list-error" role="alert">{restaurantListError}</p>
                  <button
                    className="retry-button"
                    onClick={() => setRestaurantListRefresh((refresh) => refresh + 1)}
                    type="button"
                  >
                    Retry restaurant list
                  </button>
                </div>
              )}
              <div className="form-row">
                <label className="toggle-field">
                  <span>Does it accept cash?</span>
                  <span className="toggle-control">
                    <input
                      checked={cashAccepted}
                      name="cash_accepted"
                      onChange={(event) => setCashAccepted(event.target.checked)}
                      role="switch"
                      type="checkbox"
                    />
                    <span className="toggle-track" aria-hidden="true" />
                    <span className="toggle-state">{cashAccepted ? 'Yes' : 'No'}</span>
                  </span>
                </label>
                <label className="toggle-field">
                  <span>Does it accept card?</span>
                  <span className="toggle-control">
                    <input
                      checked={cardAccepted}
                      name="card_accepted"
                      onChange={(event) => setCardAccepted(event.target.checked)}
                      role="switch"
                      type="checkbox"
                    />
                    <span className="toggle-track" aria-hidden="true" />
                    <span className="toggle-state">{cardAccepted ? 'Yes' : 'No'}</span>
                  </span>
                </label>
              </div>
              <label>
                Your name (optional)
                <input autoComplete="name" name="submitted_name" maxLength={80} />
              </label>
              <button className="submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save payment information'}
              </button>
              {formMessage && (
                <p className={`form-message${formMessageIsError ? ' form-message-error' : ''}`} role={formMessageIsError ? 'alert' : 'status'}>
                  {formMessage}
                </p>
              )}
            </form>
            <button className="back-button" onClick={() => startPage('home')} type="button">
              <span aria-hidden="true">←</span> Back to home
            </button>
          </section>
        )}

        {isVisitPage && (
          <section className="form-card" aria-labelledby="page-title">
            <p className="eyebrow">YOUR SHARED FOOD JOURNAL</p>
            <h1 id="page-title">Record a visit</h1>
            <p className="intro">Share up to four dishes you tried, with the price and your rating.</p>
            <form className="visit-form" onSubmit={handleVisitSubmit}>
              <RestaurantFields
                restaurants={restaurants}
                selectedRestaurantId={selectedRestaurantId}
                onSelectRestaurant={setSelectedRestaurantId}
                isAddingRestaurant={isAddingRestaurant}
                onToggleAddRestaurant={toggleAddRestaurant}
                newRestaurantName={newRestaurantName}
                onNewRestaurantNameChange={setNewRestaurantName}
                newRestaurantAddress={newRestaurantAddress}
                onNewRestaurantAddressChange={setNewRestaurantAddress}
              />
              {isLoadingRestaurants && <p className="list-status" role="status">Loading restaurants…</p>}
              {restaurantListError && (
                <div>
                  <p className="list-status list-error" role="alert">{restaurantListError}</p>
                  <button
                    className="retry-button"
                    onClick={() => setRestaurantListRefresh((refresh) => refresh + 1)}
                    type="button"
                  >
                    Retry restaurant list
                  </button>
                </div>
              )}
              <div className="dish-list">
                {dishDrafts.map((dish, index) => (
                  <fieldset className="dish-entry" key={dish.key}>
                    <legend>Dish {index + 1}</legend>
                    {dishDrafts.length > 1 && (
                      <button
                        className="remove-button"
                        onClick={() => setDishDrafts((drafts) => drafts.filter((item) => item.key !== dish.key))}
                        type="button"
                        aria-label={`Remove dish ${index + 1}`}
                      >
                        Remove
                      </button>
                    )}
                    <label>
                      Dish name
                      <input
                        name={`dish_${dish.key}_name`}
                        value={dish.name}
                        onChange={(event) => updateDish(dish.key, 'name', event.target.value)}
                        maxLength={200}
                        required
                      />
                    </label>
                    <div className="form-row">
                      <label>
                        Price (EUR)
                        <input
                          name={`dish_${dish.key}_price`}
                          type="number"
                          min="0"
                          max="99999.99"
                          step="0.01"
                          value={dish.price}
                          onChange={(event) => updateDish(dish.key, 'price', event.target.value)}
                          required
                        />
                      </label>
                      <div className="rating-field">
                        <span>Rating</span>
                        <span className="star-rating" role="radiogroup" aria-label={`Rating for dish ${index + 1}`}>
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <span className="star-option" key={rating}>
                              <input
                                aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                                checked={dish.rating === String(rating)}
                                id={`dish-${dish.key}-rating-${rating}`}
                                name={`dish_${dish.key}_rating`}
                                onChange={() => updateDish(dish.key, 'rating', String(rating))}
                                required={rating === 1}
                                type="radio"
                                value={rating}
                              />
                              <label
                                className={Number(dish.rating) >= rating ? 'star-filled' : ''}
                                htmlFor={`dish-${dish.key}-rating-${rating}`}
                                title={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                              >
                                ★
                              </label>
                            </span>
                          ))}
                        </span>
                      </div>
                    </div>
                  </fieldset>
                ))}
              </div>
              {dishDrafts.length < 4 && (
                <button
                  className="secondary-button add-dish-button"
                  onClick={() => setDishDrafts((drafts) => [
                    ...drafts,
                    { key: nextDishKey.current++, name: '', price: '', rating: '' },
                  ])}
                  type="button"
                >
                  Add another dish
                </button>
              )}
              <label>
                Your name (optional)
                <input autoComplete="name" name="submitted_name" maxLength={80} />
              </label>
              <button className="submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save visit'}
              </button>
              {formMessage && (
                <p className={`form-message${formMessageIsError ? ' form-message-error' : ''}`} role={formMessageIsError ? 'alert' : 'status'}>
                  {formMessage}
                </p>
              )}
            </form>
            <button className="back-button" onClick={() => startPage('home')} type="button">
              <span aria-hidden="true">←</span> Back to home
            </button>
          </section>
        )}

        {page === 'map' && (
          <section className="restaurant-card" aria-labelledby="page-title">
            <p className="eyebrow">YOUR SHARED FOOD JOURNAL</p>
            <h1 id="page-title">Restaurant map</h1>
            <p className="intro">Every restaurant is listed once, whether it was added with a payment report or a visit.</p>
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
                  {restaurants.map((restaurant) => (
                    <li key={restaurant.id}>
                      <strong>{restaurant.name}</strong>
                      <span className="restaurant-address">{restaurant.address}</span>
                      <span className="restaurant-coordinates">
                        {restaurant.latitude !== null && restaurant.longitude !== null
                          ? `${restaurant.latitude}, ${restaurant.longitude}`
                          : 'Map coordinates not added yet'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="list-status">No restaurants have been added yet.</p>
              )}
            </div>
            <button className="back-button" onClick={() => startPage('home')} type="button">
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
          Keep track of the places you visit, what they accept, the dishes you love, and the memories you make together.
        </p>
      </section>

      <nav className="actions" aria-label="Main navigation">
        <button className="action-card action-primary" onClick={() => startPage('payment')} type="button">
          <span className="action-icon" aria-hidden="true">€</span>
          <span className="action-copy">
            <strong>Share payment options</strong>
            <span>Tell friends if cash and card are accepted</span>
          </span>
          <span className="action-arrow" aria-hidden="true">↗</span>
        </button>
        <button className="action-card action-secondary" onClick={() => startPage('visit')} type="button">
          <span className="action-icon" aria-hidden="true">＋</span>
          <span className="action-copy">
            <strong>Record a visit</strong>
            <span>Rate up to four dishes and their prices</span>
          </span>
          <span className="action-arrow" aria-hidden="true">↗</span>
        </button>
        <button className="action-card action-secondary" onClick={() => startPage('map')} type="button">
          <span className="action-icon" aria-hidden="true">⌖</span>
          <span className="action-copy">
            <strong>Explore restaurants</strong>
            <span>Browse unique restaurant locations</span>
          </span>
          <span className="action-arrow" aria-hidden="true">↗</span>
        </button>
      </nav>

      <footer className="footer">Made for sharing good meals in Vienna.</footer>
    </main>
  );
}

export default App;
