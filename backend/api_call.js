import pluralize from 'pluralize';
 import { getDb } from './mongodb.js';
 import { registerStoreRoutes, registerStoreFallbackRoutes } from './stores.js';
 import { registerShoppingPlanRoutes } from './shoppingPlan.js';
 import { registerGoalChatRoutes } from './goalChat.js';
 import { shelfLifeFor, pantryNamesFor, expiringItemsFor, expiringFromDates } from './pantryMapping.js';
import 'dotenv/config';

import express from 'express';
const app = express();
const port = 3001;
import mongoose from 'mongoose';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const uri = process.env.MONGODB_URI
import cors from 'cors'

import bcrypt from "bcrypt";
const SALT = 10;
export async function verifyPassword(plain, hashed) {
	return bcrypt.compare(plain, hashed);
}

export async function hashPassword(plain) {
  return await bcrypt.hash(plain, SALT);
}

// Middleware to parse JSON request bodies
app.use(express.json());
app.use(cors());

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Check if directory exists, if not, create it
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        // Save to the absolute path
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage });

// Find a Python interpreter that works on Windows, Mac and Linux.
// Set PYTHON_PATH in .env to override.
function resolvePython() {
    if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
    const candidates = [
        path.resolve(__dirname, '../venv/Scripts/python.exe'), // Windows venv at repo root
        path.resolve(__dirname, '../venv/bin/python'),         // Mac/Linux venv at repo root
        path.resolve(__dirname, 'venv/Scripts/python.exe'),
        path.resolve(__dirname, 'venv/bin/python'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

// Run a Python script, send `input` as JSON on stdin, resolve with parsed JSON from stdout.
function runPython(scriptPath, args = [], input = null) {
    return new Promise((resolve, reject) => {
        const python = spawn(resolvePython(), [scriptPath, ...args], {
            cwd: path.resolve(__dirname, '..'),
            env: process.env,
        });
        let output = '';
        let error = '';
        python.stdout.on('data', (data) => { output += data.toString(); });
        python.stderr.on('data', (data) => { error += data.toString(); });
        python.on('error', (err) => reject(new Error(`Could not start Python: ${err.message}`)));
        python.on('close', (code) => {
            if (code !== 0) return reject(new Error(error || `Python exited with code ${code}`));
            // Use the last non-empty line so stray prints don't break JSON parsing
            const lines = output.trim().split(/\r?\n/).filter(Boolean);
            try {
                resolve(JSON.parse(lines[lines.length - 1] ?? 'null'));
            } catch (e) {
                reject(new Error(`Could not parse Python output: ${output}`));
            }
        });
        if (input !== null) python.stdin.write(JSON.stringify(input));
        python.stdin.end();
    });
}

async function connect() {
    try {
        await mongoose.connect(uri);
        console.log("Successful connection to MongoDB")
    } catch (error) {
        console.log(error);
    }
}

class UserProfileClass {
    // Model static
    static findByUsername(username) {
      return this.findOne({ username });
    }
  
    // Instance helpers (operate on schema's camelCase fields)
    fullSummary() {
      return `${this.username} • budget=${this.budget ?? 0} • time=${this.timeAvailable ?? 0}m`;
    }
  
    addRestriction(r) {
      const x = String(r);
      this.dietaryRestrictions ??= [];
      if (!this.dietaryRestrictions.includes(x)) this.dietaryRestrictions.push(x);
      return this;
    }
    removeRestriction(r) {
      const x = String(r);
      this.dietaryRestrictions = (this.dietaryRestrictions ?? []).filter(s => s !== x);
      return this;
    }
  
    addPreference(p) {
      const x = String(p);
      this.cuisinePreferences ??= [];
      if (!this.cuisinePreferences.includes(x)) this.cuisinePreferences.push(x);
      return this;
    }
    removePreference(p) {
      const x = String(p);
      this.cuisinePreferences = (this.cuisinePreferences ?? []).filter(s => s !== x);
      return this;
    }
  
    setBudget(amount) {
      this.budget = Number(amount);
      return this;
    }
    setTime(minutes) {
      this.timeAvailable = parseInt(minutes, 10) || 0;
      return this;
    }
  
    addAppliance(a) {
      const x = String(a);
      this.appliances ??= [];
      if (!this.appliances.includes(x)) this.appliances.push(x);
      return this;
    }
    removeAppliance(a) {
      const x = String(a);
      this.appliances = (this.appliances ?? []).filter(s => s !== x);
      return this;
    }
  
    rateRecipe(recipe, rating) {
      this.recipeRatings ??= new Map(); // Mongoose Map works with set/get
      this.recipeRatings.set(String(recipe), Number(rating));
      return this;
    }
  }

connect();
app.post('/users/:username/verify-password', async (req, res) => {
  try {
    const user = await UserProfile.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: "Could not find user" });
    const valid = await verifyPassword(req.body?.password ?? '', user.password);
    return res.status(200).json({ valid });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to verify password" });
  }
});
// Define your schema (e.g., for a 'Product' model)
const userProfileSchema = new mongoose.Schema({
    username: { type: String, required: true, trim: true, unique: true },
    password: { type: String, required: true }, 
    dietaryRestrictions: [String],
    cuisinePreferences: [String],
    budget: Number,
    timeAvailable: Number,
    appliances: [String],
    goals: [String],             // health goals from the goal chat (goalChat.js)
    recipeRatings: { type: Map, of: Number },
    ingredients:   { type: Map, of: Number },
    ingredientAddedAt: { type: Map, of: Date, default: {} },
  }, {
    timestamps: true,
    collection: 'User Profile'
  });
  
  // 3) Attach the class
  userProfileSchema.loadClass(UserProfileClass);
  
  // 4) Model (clean name; schema controls collection)
  const UserProfile = mongoose.models.UserProfile
    || mongoose.model('UserProfile', userProfileSchema);

app.get('/users', async (req, res) => {
    try {
        const users = await UserProfile.find({}).lean();
        return res.status(200).json(users);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch users" });
    }
});

app.get('/users/:username', async (req, res) => {
    try {
        const { username } = req.params
        if (mongoAvailable) {
          try {
              user = await UserProfile.findByUsername(username);
          } catch (err) {
              console.warn("Mongo fetch failed, proceeding without it.");
          }
        }

        // If no user from DB, provide a dummy user
        if (!user) {
            user = {
                username: username || "test_user",
                ingredients: new Map([["tomato", 2], ["cheese", 1], ["flour", 3]]),
                budget: 10,
                timeAvailable: 60,
                appliances: ["Oven", "Stove"],
                cuisinePreferences: ["Italian"]
            };
        }

        return res.status(200).json(user);
    } catch(error){
        console.log(error)
        return res.status(500).json({error: "Failed to fetch user"});
    }
});

// CREATE user
app.post('/users', async (req, res) => {
    try {
      let {
        username,
        password, 
        dietaryRestrictions,
        cuisinePreferences,
        budget,
        timeAvailable,
        appliances,
        recipeRatings,
        ingredients,
      } = req.body;
  
      if (!username) {
        return res.status(400).json({ error: "username is required" });
      }

      if (!ingredients) {
        ingredients = {};
      }
      //hash password to encrypt
      password = await hashPassword(password);

      const newUser = await UserProfile.create({
        username,
        password, 
        dietaryRestrictions,
        cuisinePreferences,
        budget,
        timeAvailable,
        appliances,
        recipeRatings,
        ingredients,
      });
  
      return res.status(201).json(newUser);
    } catch (error) {
      console.error(error);
      if (error?.code === 11000) {
        return res.status(409).json({ error: "Username already exists" });
      }
      return res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.delete('/users/:username', async (req, res) => {
    try {
        const { username } = req.params
        const doc = await UserProfile.findOneAndDelete({ username }).lean();
        if(!doc) {
            return res.status(404).json({ error: "User not found" });
        }
        return res.status(204).send()
    } catch(error){
        console.error(error)
        return res.status(500).json({ error: "Failed to delete user" });
    }
  });
  app.patch('/users/:username', async (req, res) => {
    try {
        const { username } = req.params;
        if (!username) {
            return res.status(400).json({ error: "username is required" });
        }
        
        const allowed = ['dietaryRestrictions','cuisinePreferences','budget','timeAvailable','appliances','recipeRatings','ingredients'];
        const update = {};
        const unupdate = {};
        for (const k of allowed) {
            const hasKey = Object.prototype.hasOwnProperty.call(req.body, k);
            if (!hasKey) continue;
      
            const val = req.body[k];
      
            if (val === null) {
              unupdate[k] = "";
            } else if (val !== undefined) {
              update[k] = val;
            }
        }
        
        const updateOps = {};
        if (Object.keys(update).length) updateOps.$set = update;
        if (Object.keys(unupdate).length) updateOps.$unset = unupdate;

        const user = await UserProfile.findOneAndUpdate({ username }, updateOps, { new: true, runValidators: true }).lean();
        return res.status(200).json(user);
    } catch(error){
        console.error(error)
        return res.status(500).json({ error: "Failed to patch user" });
    }
  });


/*//Middleware to get DB
app.use(async (req, res, next) => {
   try {
    req.db = await getDb(); // attach db to the request
    next(); // continue to next handler
   } catch(e) {
    next(e)
   } 
});
*/

// Dummy ingredients database for testing
const ingredients = new Map([
    ["tomato", 1],
    ["carrot", 5],
    ["chicken breast", 1],
    ["potato", 3],
    ["beef", 2]
]);

// Routes
// PARAM: username
// GET all ingredients of the user
app.get('/user-ingredients/:user', async (req, res) => {
    try {
        const { user : username } = req.params
        const user = await UserProfile.findByUsername(username);
        if (!user) return res.status(404).json({ error: "Could not find user" });
        return res.status(200).json(user.ingredients);
    } catch(error){
        console.log(error)
        return res.status(500).json({error: "Failed to fetch user"});
    }
});


// GET ingredients that expire within ?days=N (default 3), soonest first
app.get('/expiring/:user', async (req, res) => {
  try {
    const user = await UserProfile.findByUsername(req.params.user);
    if (!user) return res.status(404).json({ error: "Could not find user" });
    const withinDays = Number(req.query.days ?? 3);
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const items = [];
    for (const [name, qty] of user.ingredients ?? new Map()) {
      const added = user.ingredientAddedAt?.get(name);
      if (!added) continue; // added before dates were tracked
      const expiresOn = new Date(new Date(added).getTime() + shelfLifeFor(name) * DAY);
      const daysLeft = Math.ceil((expiresOn.getTime() - now) / DAY);
      if (daysLeft <= withinDays) items.push({ name, quantity: qty, expiresOn, daysLeft });
    }
    items.sort((a, b) => a.daysLeft - b.daysLeft);
    return res.status(200).json(items);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to check expiring items" });
  }
});

// GET a single item by ingredient
app.get('/user-ingredients/:user/:ingredient', async (req, res) => {
  try {
    const { user : username, ingredient } = req.params
    const user = await UserProfile.findByUsername(username);
    if (!user) return res.status(404).json({ error: "Could not find user" });
    const ingredientKey = pluralize.singular(ingredient.toLowerCase());
    const ingredientQuantity = user.ingredients?.get(ingredientKey);
    if (ingredientQuantity == undefined) {
      return res.status(404).json({ error: "Ingredient not found" });
    }
    const newJson = { [ingredientKey]: ingredientQuantity };
    return res.status(200).json(newJson);

    
} catch(error){
    console.log(error)
    return res.status(500).json({error: "Failed to fetch user"});
}
});

// GET what the shopping list needs from the pantry:
// pantryItems = names to not buy again; useFirst = items expiring within ?days=N (default 3)
app.get('/shopping-pantry/:user', async (req, res) => {
  try {
    const user = await UserProfile.findByUsername(req.params.user);
    if (!user) return res.status(404).json({ error: "Could not find user" });
    const days = Number(req.query.days ?? 3);
    return res.status(200).json({
      pantryItems: pantryNamesFor(user),
      useFirst: expiringItemsFor(user, days),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load pantry for shopping list" });
  }
});

// POST "use this first" for a pantry that is not stored on the server (signed-out guests).
// BODY: { items: [{ name, addedAt, quantity? }], days? }   (days defaults to 3)
// Returns the same shape as GET /expiring: [{ name, quantity, expiresOn, daysLeft }]
app.post('/expiring-items', (req, res) => {
  const { items, days } = req.body ?? {};
  if (!Array.isArray(items) || items.length > 500) {
    return res.status(400).json({ error: "items must be a list of at most 500 entries" });
  }
  const withinDays = Number.isFinite(Number(days)) ? Number(days) : 3;
  return res.status(200).json(expiringFromDates(items, withinDays));
});

// PARAM: username
// BODY: JSON of lists of ingredient-quantity pairs
// PATCH add all ingredients/quantities to ingredients of users
app.patch('/user-ingredients/:user', async (req, res) => {   
    try {
        const { user : username } = req.params
        const user = await UserProfile.findByUsername(username);
        if (!user) return res.status(404).json({ error: "Could not find user" });
        const entries = Object.entries(req.body);
        // Iterate over the [key, value] pairs
        for (const [key, value] of entries) {
          // Checks if user already has ingredient
          // True: Adds new quantity to  old quantity, remove if quantity goes to zero
          // False: Adds new key-value to user ingredients map
          if (user.ingredients.has(key)) {
            const oldQuantity = user.ingredients.get(key);
            if (oldQuantity + value == 0) {
              user.ingredients.delete(key);
              console.log(`Removed ${key}`);
            } else {
              user.ingredients.set(key, oldQuantity + value);
              console.log(`Added ${value} ${key}`);
            }
          } else {
            user.ingredients.set(key, value);
            console.log(`Added ${value} ${key}`);
          }
          // Track when stock was last added (used by /expiring)
          user.ingredientAddedAt ??= new Map();
          if (value > 0) {
            user.ingredientAddedAt.set(key, new Date());
          } else if (!user.ingredients.has(key)) {
            user.ingredientAddedAt.delete(key);
          }
        }
        // Save changes to DB
        await user.save();
        return res.status(200).json(user.ingredients);
    } catch(error){
        console.log(error)
        return res.status(500).json({error: "Error adding new ingredient"});
    }
});

// OCR endpoint to process receipts
app.post('/ocr', upload.single('file'), async (req, res) => {
    try {
        console.log("request file:", req.file)
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = req.file.path;
        const absoluteFilePath = path.resolve(__dirname, filePath);
        const scriptPath = path.resolve(__dirname, "ImageCleaning.py");
        console.log("file path:", filePath);
        console.log("absolute file path:", absoluteFilePath);
        console.log("script path:", scriptPath);

        // Call the Python OCR script with the uploaded image path
        try {
            const result = await runPython(scriptPath, [absoluteFilePath]);
            return res.status(200).json(result ?? {});
        } catch (err) {
            console.error("Python script error:", err.message);
            return res.status(500).json({ error: "OCR processing failed", details: err.message });
        } finally {
            fs.unlink(absoluteFilePath, (err) => {
                if (err && err.code !== 'ENOENT') console.error("Error deleting file:", err);
            });
        }
    } catch (error) {
        console.error("OCR endpoint error:", error);
        return res.status(500).json({ error: "OCR processing failed" });
    }
});

// POST generate recipes with the Gemini pipeline
// BODY: { username, pantryItems, time, difficulty, budget, allergens, appliances, cuisines, shoppingList? }
// With shoppingList: returns { recipes (2-3 sharing ingredients), sharedIngredients, unusedItems }
app.post('/generate_recipes', async (req, res) => {
  try {
    const scriptPath = path.resolve(__dirname, '../llm_pipeline/generate_cli.py');
    const recipes = await runPython(scriptPath, [], req.body ?? {});
    if (recipes && !Array.isArray(recipes)) return res.status(200).json(recipes); // meal prep mode
    return res.status(200).json({ recipes: recipes ?? [] });
  } catch (error) {
    console.error("Recipe generation error:", error.message);
    return res.status(500).json({ error: "Recipe generation failed", details: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const user = await UserProfile.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const verified = await verifyPassword(password, user.password);
    if (!verified) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    
    const safeUser = {
      username: user.username,
      dietaryRestrictions: user.dietaryRestrictions,
      cuisinePreferences: user.cuisinePreferences,
      budget: user.budget,
      timeAvailable: user.timeAvailable,
      appliances: user.appliances,
      recipeRatings: user.recipeRatings,
      ingredients: user.ingredients,
    };

    return res.status(200).json({ message: "Login successful", user: safeUser });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Login failed" });
  }
});



// SNAP store lookup: GET /stores?lat=..&lng=..&radius=..  (see stores.js)
registerStoreRoutes(app);

// Core loop: location and budget in, stores and shopping list out (see shoppingPlan.js)
registerShoppingPlanRoutes(app, { runPython });

// Goal chat; goals saved to the user profile (see goalChat.js)
registerGoalChatRoutes(app, { runPython, UserProfile });

// Uncomment to all Fallback Usage
// registerStoreFallbackRoutes(app)

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});