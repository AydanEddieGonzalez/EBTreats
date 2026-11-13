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

- **Receipt Upload & OCR Processing**: Upload receipt images and automatically extract ingredient lists
- **Pantry Management**: Track your grocery inventory with expiration date reminders
- **AI-Powered Recipe Generation**: Get personalized recipe suggestions based on your dietary preferences, budget, and available time
- **Preference Customization**: Set dietary restrictions, cuisine preferences, available appliances, and cooking time constraints
- **User Profiles**: Create personalized accounts to store preferences and track your grocery history
- **Smart Filtering**: Filter recipes by difficulty, cooking time, cuisine type, and estimated cost

## Tech Stack

### Frontend
- **React** - UI framework
- **React Router** - Client-side routing
- **CSS** - Styling

### Backend
- **Node.js + Express** - RESTful API
- **MongoDB** - Database for user profiles and pantry data
- **Mongoose** - ODM for MongoDB
- **Multer** - File upload handling
- **Bcrypt** - Password hashing
- **CORS** - Cross-origin resource sharing

### ML Pipeline
- **Python** - Data processing and ML
- **Google Gemini API** - LLM-based recipe generation
- **OCR** - Receipt image text extraction
- **Image Processing** - Receipt cleaning and preprocessing

## Project Structure

```
EBTreats/
├── frontend/                 # React application
│   ├── src/
│   │   ├── App.js           # Main app component
│   │   ├── Generate.js      # Recipe generation interface
│   │   ├── UploadReceipts.js # Receipt upload component
│   │   ├── Login.js         # User authentication
│   │   ├── UserProfile.js   # User profile management
│   │   ├── Recipes.js       # Recipe display
│   │   └── ...              # Other components
│   └── public/              # Static files
│
├── backend/                 # Express API
│   ├── api_call.js          # API endpoints
│   ├── mongodb.js           # Database configuration
│   ├── UserProfile.js       # User management
│   ├── control.py           # Backend orchestration
│   └── package.json         # Dependencies
│
├── llm_pipeline/            # Recipe generation engine
│   ├── llm_recipe_generator.py  # Gemini API integration
│   ├── LLMValidator.py      # Recipe validation
│   └── ranker.py            # Recipe ranking
│
├── data_classes/            # Shared data models
│   ├── UserProfile.py       # User data structure
│   ├── UserPantry.py        # Pantry inventory
│   └── Recipes.py           # Recipe data structure
│
├── Providers/               # External service providers
│   └── LLM_test.py          # LLM testing utilities
│
└── validator/               # Data validation
    └── Validator.py         # Input validation
```

## Getting Started

### Prerequisites
- Node.js and npm
- Python 3.8+
- MongoDB (local or Atlas)
- Google Gemini API key

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
| `MY_API_KEY` | Gemini recipe generation | https://aistudio.google.com/apikey |
| `USDA_API_KEY` | Receipt OCR food check | https://fdc.nal.usda.gov/api-key-signup |
| `MONGODB_URI` | Database connection | Ask the Integration lead for the team URI |
| `MONGODB_DB` | Database name | Ask the Integration lead |
| `PYTHON_PATH` | Optional: only if Python isn't auto-detected | Full path to `venv\Scripts\python.exe` |
| `TESSERACT_CMD` | Optional: only if Tesseract isn't auto-detected | Full path to `tesseract.exe` |

### Running the Application

1. **Start MongoDB** (if running locally)
   ```bash
   mongod
   ```

2. **Start Backend** (must be run from `backend/` so it finds `.env`)
   ```bash
   cd backend
   npm start
   ```
   It runs at `http://localhost:3001`.

3. **Start Frontend** (in a new terminal)
   ```bash
   cd frontend
   npm start
   ```

4. The application will open at `http://localhost:3000`

## Usage

### For End Users

1. **Sign Up / Log In** - Create an account or log in with existing credentials
2. **Set Preferences** - Configure dietary restrictions, cuisine preferences, budget, and available appliances
3. **Upload Receipts** - Scan grocery receipts to add items to your pantry
4. **Generate Recipes** - Click "Generate" to get AI-powered recipe suggestions
5. **View Your Pantry** - Track ingredients and receive expiration date reminders
6. **Save Recipes** - Bookmark favorite recipes for later

## Key Components

### Frontend Pages
- **Hero** - Landing page
- **Login/Signup** - Authentication
- **UserProfile** - User settings and preferences
- **UploadReceipts** - Grocery inventory management
- **Generate** - Recipe generation interface
- **Recipes** - View generated and saved recipes
- **Preferences** - Configure cooking preferences

### Backend API
- User authentication and management
- Receipt upload and processing
- Pantry inventory endpoints
- Recipe generation requests
- User preference management

### LLM Pipeline
- **RecipeLLM** - Generates personalized recipes using Google Gemini
- **LLMValidator** - Validates and verifies recipe data
- **Ranker** - Ranks recipes by relevance to user preferences

## Team

This project was built collaboratively with contributions from:
- Frontend Development
- Backend Development  
- ML/LLM Pipeline Development
- UI/UX Design

**EBTreats** - Making every EBT dollar count. 🥕
