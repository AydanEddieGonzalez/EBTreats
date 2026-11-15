# EBTreats

Helping families stretch their EBT/SNAP benefits further and eat healthier. EBTreats shows you where to shop, what to buy, and how to use it all before it goes bad.

Built for the OpenProject Hackathon (UN Sustainable Development Goals). Based on [SaveBites](https://github.com/Devansh-Ojha/SaveBites).

## Overview

SNAP helps families afford food, but it doesn't help them choose it. Studies keep finding that adults on SNAP eat lower-quality diets than other low-income adults ([Nguyen et al., 2014](https://pubmed.ncbi.nlm.nih.gov/25107469/)). The aid is there; the guidance isn't.

**EBTreats** closes that gap by:

- **Finding nearby EBT stores**, ranking stores in fruit-and-vegetable incentive programs first, using USDA's SNAP retailer data
- **Building a healthy shopping list** that fits your weekly budget and goals, from a simple chat ("feed 4 on $60", "more protein")
- **Turning that list into recipes** that share ingredients, so nothing is bought for a single meal
- **Tracking your pantry** and reminding you what to use first, to cut food waste

Coming next: one-tap checkout with delivery partners that accept EBT online (autobuy is a work-in-progress demo today).

**SDGs:** 2 Zero Hunger, 3 Good Health, 12 Responsible Consumption, 17 Partnerships for the Goals.

## Features

- **Mobile-first app with bottom tabs**: Home, List, Recipes, Stores and Chat, designed in Figma ([EBTreats Mobile Redesign](https://www.figma.com/design/4dJbxo4FffyvljGjfIpNkT)). On a laptop it shows as a centered phone-width column.
- **Weekly SNAP budget at a glance**: the Home screen shows how much is left after your list, with a progress bar.
- **Goal chat**: tell the AI coach what you want ("more protein, feeding 3, kid hates spicy food") and it turns that into shopping goals that feed straight into your list.
- **Healthy shopping lists for your budget**: picks a nearby SNAP store and builds a list grouped by aisle, with prices and a running total.
- **Recipes that share ingredients**: plan 2 to 3 meals from your list so nothing gets bought for just one meal. Each recipe shows how many ingredients you already have.
- **Receipt scan (OCR)**: snap a grocery receipt and the food items go into your pantry. Tax, bags and non-food lines are skipped.
- **"Use this first" reminders**: pantry items expiring within 7 days show up on Home and in the pantry tab, for guests too.
- **SNAP store map**: nearby EBT stores from USDA data, with produce-incentive stores highlighted.
- **Accounts or guest mode**: sign up to sync your pantry, preferences and goals, or use everything as a guest (saved in your browser).

## Tech Stack

### Frontend
- **React** - UI framework (mobile layout with bottom tabs)
- **Leaflet + OpenStreetMap** - Store map
- **CSS** - Styling (`index.css` base design, `mobile.css` for the mobile screens)

### Backend
- **Node.js + Express** - RESTful API
- **MongoDB** - Database for user profiles and pantry data
- **Mongoose** - ODM for MongoDB
- **Multer** - File upload handling
- **Bcrypt** - Password hashing
- **CORS** - Cross-origin resource sharing

### ML Pipeline
- **Python** - Data processing and ML
- **Claude API** - Recipes, shopping lists and goal chat (called with Python's standard library, no SDK needed)
- **Tesseract OCR** - Receipt image text extraction
- **USDA FoodData Central** - Checks whether a receipt line is food
- **Image Processing** - Receipt cleaning and preprocessing

## Project Structure

```
EBTreats/
├── frontend/                 # React application
│   ├── src/
│   │   ├── App.js           # App shell: welcome screen, bottom tabs (Home, List, Recipes, Stores, Chat)
│   │   ├── mobile.css       # Styles for the mobile screens
│   │   ├── StoreMap.js      # Stores tab: Leaflet map of SNAP stores
│   │   ├── Modals.js        # Log in/sign up, preferences, receipt scan, recipe details, shopping plan
│   │   ├── api.js           # Backend client
│   │   ├── storage.js       # Browser storage for guests
│   │   ├── Icon.js          # Line icons
│   │   └── index.css        # Base design system (from the Figma Make design)
│   └── public/              # Static files
│
├── backend/                 # Express API
│   ├── api_call.js          # API endpoints, MongoDB connection
│   ├── goalChat.js          # POST /goal-chat, saved goals
│   ├── shoppingPlan.js      # POST /shopping-plan: store + healthy list for a budget
│   ├── stores.js            # SNAP store search
│   ├── pantryMapping.js     # Shelf life and "use this first" dates
│   ├── ImageCleaning.py     # Receipt OCR
│   ├── mongodb.js           # Database configuration
│   └── package.json         # Dependencies
│
├── llm_pipeline/            # AI features (Claude)
│   ├── llm.py               # Shared Claude client: model fallbacks, structured JSON answers
│   ├── llm_recipe_generator.py  # Recipes and meal plans
│   ├── shopping_list.py     # Shopping lists
│   ├── goal_chat.py         # Goal chat coach
│   ├── *_cli.py             # Entry points the Express server calls
│   ├── LLMValidator.py      # Recipe validation
│   └── ranker.py            # Recipe ranking
│
├── data_classes/            # Shared data models
├── Providers/
│   └── LLM_test.py          # Quick check that your Claude key works
└── validator/               # Recipe validation
```

## Getting Started

### Prerequisites
- Node.js and npm
- Python 3.8+
- MongoDB Atlas (or local MongoDB)
- Claude API key
- Tesseract (for receipt scanning)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/AydanEddieGonzalez/EBTreats.git
   cd EBTreats
   ```

2. **Install Tesseract** (needed for receipt scanning)
   - Windows: install from https://github.com/UB-Mannheim/tesseract/wiki (default path `C:\Program Files\Tesseract-OCR` is detected automatically)
   - Mac: `brew install tesseract`

3. **Set up the Python environment** (from the repo root)
   ```bash
   python -m venv venv
   # Windows (PowerShell):
   venv\Scripts\activate
   # Mac/Linux:
   source venv/bin/activate

   pip install -r requirements.txt
   ```
   The backend finds `venv/` at the repo root automatically. Don't commit `venv/`.

4. **Set up the backend**
   ```bash
   cd backend
   npm install
   # Windows (PowerShell): copy .env.example .env
   # Mac/Linux:            cp .env.example .env
   ```
   Then fill in `backend/.env` (see Environment Variables below).

5. **Set up the frontend** (from the repo root)
   ```bash
   cd frontend
   npm install
   ```

### Environment Variables

All keys live in `backend/.env`, which is gitignored. Never commit it. `backend/.env.example` lists every variable:

| Variable | What it's for | Where to get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude recipe generation, shopping list, goal chat | https://console.anthropic.com/settings/keys |
| `USDA_API_KEY` | Receipt OCR food check | https://fdc.nal.usda.gov/api-key-signup |
| `MONGODB_URI` | Database connection | Ask the Integration lead for the team URI |
| `MONGODB_DB` | Database name | Ask the Integration lead |
| `CLAUDE_MODEL` / `CLAUDE_FALLBACK_MODELS` | Optional: which Claude models to use (defaults are in `.env.example`) | |
| `PYTHON_PATH` | Optional: only if Python isn't auto-detected | Full path to `venv\Scripts\python.exe` |
| `TESSERACT_CMD` | Optional: only if Tesseract isn't auto-detected | Full path to `tesseract.exe` |

**MongoDB Atlas:** add your IP under Atlas > Network Access (or allow `0.0.0.0/0` for the hackathon), or the backend can't connect.

**Check your Claude key** from the repo root, with the venv active: `python -m Providers.LLM_test`

### Running the Application

1. **Start the backend** (run it from `backend/` so it finds `.env`)
   ```bash
   cd backend
   npm start
   ```
   It runs at `http://localhost:3001`. Look for `Successful connection to MongoDB`. If you see `MongoDB connection FAILED`, the line after it says what to fix (IP allow list, password, or DNS).

2. **Start the frontend** (in a new terminal)
   ```bash
   cd frontend
   npm start
   ```

3. Open `http://localhost:3000`. For the mobile view in a laptop browser, press F12 and turn on device mode.

### Running it on your phone

**Same Wi-Fi (quickest):** find your laptop's IP (`ipconfig` on Windows, the IPv4 Address), then start the frontend pointed at it:
```powershell
$env:REACT_APP_API_URL="http://YOUR-IP:3001"; npm start
```
Open `http://YOUR-IP:3000` on your phone. Location won't work over plain `http`, but zip code search does. Campus Wi-Fi often blocks this, so use a hotspot if it won't load.

**Public link with Cloudflare (works anywhere, and location works):** install once with `winget install --id Cloudflare.cloudflared`, then use 4 terminals:

1. Backend: `cd backend` then `npm start`
2. Backend tunnel: `cloudflared tunnel --url http://localhost:3001` (copy the `https://...trycloudflare.com` link)
3. Frontend, pointed at that link:
   ```powershell
   cd frontend
   $env:REACT_APP_API_URL="https://YOUR-BACKEND-LINK.trycloudflare.com"
   $env:DANGEROUSLY_DISABLE_HOST_CHECK="true"
   npm start
   ```
4. Frontend tunnel: `cloudflared tunnel --url http://localhost:3000`. Open this link on your phone.

Keep all 4 open. The links change every time `cloudflared` restarts. If you restart the backend tunnel, redo step 3 with the new link.

### Troubleshooting

- **`npm ci` fails in `frontend/`:** the lock file is out of sync. Use `npm install`.
- **"Could not reach the server":** the backend isn't running, or `REACT_APP_API_URL` points at the wrong place.
- **Mongoose "buffering timed out":** MongoDB never connected. Check the `MongoDB connection FAILED` line in the backend terminal.

## Usage

1. **Welcome** - Create an account, log in, or continue as a guest
2. **Home** - See your weekly SNAP budget, quick actions, "Use this first" items and recipe ideas
3. **Chat** - Tell the coach your goals, then tap **Build my shopping list**
4. **List** - Check items off as you buy them (they move to your pantry), add your own items, or plan meals from your list
5. **Recipes** - Suggestions that use what you have; open one to add missing ingredients to your list
6. **Stores** - Find SNAP stores nearby and build a list for a specific store
7. **Scan a receipt** - From Home or the pantry tab, to fill your pantry

## Key Components

### Frontend
A mobile app with a bottom tab bar:
- **Home** - Budget card, quick actions (scan receipt, plan with chat, find stores), "Use this first" banner, recipe carousel
- **List** - "To buy" items grouped by aisle with a running total, and an "In pantry" tab
- **Recipes** - Recipe cards showing how many ingredients you already have
- **Stores** - SNAP stores on a map, produce-incentive stores highlighted
- **Chat** - Goal chat that feeds your goals into the shopping plan
- **Dialogs** - Log in/sign up, preferences, receipt scan, recipe details, shopping plan (bottom sheets on phones)

Signed-out guests can use everything; their pantry, list and goals are saved in the browser.

### Backend API
- User accounts, preferences and saved goals
- Receipt upload and OCR (`POST /ocr`)
- Pantry inventory and "use this first" dates (`/user-ingredients`, `/expiring`, `/expiring-items`)
- SNAP store search (`/stores`) and shopping plans (`POST /shopping-plan`)
- Recipe and meal plan generation (`POST /generate_recipes`)
- Goal chat (`POST /goal-chat`)

### LLM Pipeline
- **llm.py** - One shared Claude client for every AI feature; falls back to the next model if one is busy
- **RecipeLLM** - Generates personalized recipes and shared-ingredient meal plans
- **Shopping list and goal chat** - Turn budgets and goals into healthy lists
- **LLMValidator** - Validates and verifies recipe data
- **Ranker** - Ranks recipes by relevance to user preferences

## Team

This project was built collaboratively with contributions from:
- Frontend Development
- Backend Development  
- ML/LLM Pipeline Development
- UI/UX Design

**EBTreats** - Making every EBT dollar count.
