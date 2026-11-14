import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShoppingPlanModal, planItemToListItem } from './Modals';
import * as api from './api';

jest.mock('./api', () => ({ getShoppingPlan: jest.fn() }));

const prefs = { budget: 40, allergens: ['Peanut'] };

const plan = {
  stores: [],
  store: {
    id: 7,
    name: 'BERKELEY BOWL',
    address: '2020 Oregon St',
    city: 'BERKELEY',
    state: 'CA',
    distanceMiles: 0.8,
    hasIncentive: true,
    incentiveProgram: 'Market Match',
  },
  list: {
    items: [
      {
        name: 'Bananas',
        category: 'produce',
        quantity: 2,
        unit: 'lb',
        estimatedPrice: 1.2,
        snapEligible: true,
        reason: 'Cheap fruit.',
      },
      {
        name: 'Dried black beans',
        category: 'protein',
        quantity: 1,
        unit: 'bag',
        estimatedPrice: 2.5,
        snapEligible: true,
        reason: 'Protein.',
      },
    ],
    estimatedTotal: 3.7,
    budget: 40,
    remaining: 36.3,
    overBudget: false,
    goalNotes: ['Half the list is produce.'],
    tips: ['Freeze ripe bananas.'],
  },
};

function renderModal(props = {}) {
  const handlers = { onAddItems: jest.fn(), onShowStore: jest.fn(), onClose: jest.fn() };
  render(
    <ShoppingPlanModal
      prefs={prefs}
      pantryItems={['rice']}
      mapSearch={{ zip: '94704' }}
      mapStore={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

afterEach(() => jest.clearAllMocks());

test('sends location, budget, allergies and pantry, then adds only the checked items', async () => {
  api.getShoppingPlan.mockResolvedValue(plan);
  const { onAddItems } = renderModal();

  fireEvent.click(screen.getByRole('button', { name: /more protein/i }));
  fireEvent.click(screen.getByRole('button', { name: /build my list/i }));

  expect(api.getShoppingPlan).toHaveBeenCalledWith(
    expect.objectContaining({
      zip: '94704',
      budget: 40,
      goals: ['More protein'],
      allergens: ['Peanut'],
      pantryItems: ['rice'],
      householdSize: 1,
      days: 7,
    }),
  );

  expect(await screen.findByText('Berkeley Bowl')).toBeInTheDocument();
  expect(screen.getByText(/Market Match/)).toBeInTheDocument();
  expect(screen.getByText('$36.30 left')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /leave out bananas/i }));
  fireEvent.click(screen.getByRole('button', { name: /put 1 item on my list \(\$2\.50\)/i }));

  expect(onAddItems).toHaveBeenCalledWith([
    { name: 'Dried black beans', detail: '1 bag · about $2.50', store: 'Berkeley Bowl' },
  ]);
});

test('asks for a location instead of calling the API when there is none', () => {
  renderModal({ mapSearch: null });
  fireEvent.click(screen.getByRole('button', { name: /build my list/i }));
  expect(screen.getByText(/use your location or enter a zip code/i)).toBeInTheDocument();
  expect(api.getShoppingPlan).not.toHaveBeenCalled();
});

test('uses the map location and picked store when there is no zip', async () => {
  api.getShoppingPlan.mockResolvedValue(plan);
  renderModal({ mapSearch: { lat: 37.87, lng: -122.27, radius: 1 }, mapStore: plan.store });
  expect(screen.getByRole('checkbox', { name: /build it for berkeley bowl/i })).toBeChecked();

  fireEvent.click(screen.getByRole('button', { name: /build my list/i }));
  expect(api.getShoppingPlan).toHaveBeenCalledWith(
    expect.objectContaining({
      lat: 37.87,
      lng: -122.27,
      radius: 1,
      storeId: 7,
    }),
  );
  await screen.findByText('Berkeley Bowl');
});

test('still shows the store when the AI list fails', async () => {
  api.getShoppingPlan.mockResolvedValue({
    ...plan,
    list: null,
    listError: 'Could not build the shopping list right now',
  });
  renderModal();
  fireEvent.click(screen.getByRole('button', { name: /build my list/i }));
  expect(await screen.findByText(/could not build the shopping list right now/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /see store on map/i })).toBeInTheDocument();
});

test('shows server errors in the form', async () => {
  api.getShoppingPlan.mockRejectedValue(new Error('Could not reach the USDA store data'));
  renderModal();
  fireEvent.click(screen.getByRole('button', { name: /build my list/i }));
  await waitFor(() => expect(screen.getByText(/could not reach the usda store data/i)).toBeInTheDocument());
});

test('planItemToListItem handles a missing price and unit', () => {
  expect(planItemToListItem({ name: 'Eggs', quantity: 1, unit: '', estimatedPrice: 0 }, null)).toEqual({
    name: 'Eggs',
    detail: '1',
    store: undefined,
  });
});
