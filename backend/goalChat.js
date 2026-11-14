// Goal chat: the user talks with an AI coach, which turns what they say into a short list of
// food-shopping health goals. The goals are saved on the user profile (UserProfile.goals) so the
// shopping list (POST /shopping-plan, "goals") can use them later.
//
// POST /goal-chat
//   Body: {
//     username: "maria",               // optional; when given, saved goals are loaded and the
//                                      // updated goals are saved back to this user's profile
//     messages: [                      // the conversation so far, oldest first, last is the user's
//       { role: "user", text: "I want to cut back on sugar" },
//       { role: "assistant", text: "..." }
//     ],
//     goals: ["..."]                   // optional; overrides the saved goals (e.g. for a guest)
//   }
//   200: { reply, goals, done, saved }  // saved is true when the goals were written to the profile;
//                                       // when false, saveError says why (chat still works)
//   400 bad input, 502 the AI step failed
//
// GET /users/:username/goals   200: { goals }
// PUT /users/:username/goals   Body: { goals: ["..."] } (e.g. the user removed one in the UI)
//                              200: { goals }

import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOAL_CHAT_CLI = path.resolve(__dirname, '../llm_pipeline/goal_chat_cli.py');
const MAX_GOALS = 5;
const MAX_GOAL_LENGTH = 80;

function cleanGoals(goals) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(goals) ? goals : []) {
    const text = String(g ?? '').trim().slice(0, MAX_GOAL_LENGTH);
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push(text);
    }
  }
  return out.slice(0, MAX_GOALS);
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return last && last.role === 'user' && String(last.text ?? '').trim() !== '';
}

// Mongoose queues queries while disconnected and only fails after ~10 s; check first instead.
function dbReady() {
  return mongoose.connection.readyState === 1;
}

function lastLine(error) {
  const lines = String(error?.message ?? error).trim().split(/\r?\n/).filter(Boolean);
  return lines[lines.length - 1] ?? 'Unknown error';
}

export function registerGoalChatRoutes(app, { runPython, UserProfile }) {
  app.post('/goal-chat', async (req, res) => {
    const { username, messages, goals } = req.body ?? {};
    if (!validMessages(messages)) {
      return res.status(400).json({ error: 'messages must be a non-empty list ending with a user message' });
    }

    let user = null;
    let saveError = null;
    if (username) {
      if (!dbReady()) {
        saveError = 'Database is not connected';
      } else {
        try {
          user = await UserProfile.findByUsername(String(username));
          if (!user) saveError = 'User not found';
        } catch (error) {
          saveError = 'Could not load the user profile';
          console.error('Goal chat profile lookup error:', error.message);
        }
      }
    }

    const chatRequest = {
      messages,
      goals: Array.isArray(goals) ? cleanGoals(goals) : cleanGoals(user?.goals),
      profile: user ? { dietaryRestrictions: user.dietaryRestrictions ?? [], budget: user.budget } : {},
    };

    let result;
    try {
      result = await runPython(GOAL_CHAT_CLI, [], chatRequest);
    } catch (error) {
      console.error('Goal chat error:', lastLine(error));
      return res.status(502).json({ error: 'The goal coach is unavailable right now', details: lastLine(error) });
    }

    const newGoals = cleanGoals(result?.goals);
    let saved = false;
    if (user) {
      try {
        user.goals = newGoals;
        await user.save();
        saved = true;
      } catch (error) {
        saveError = 'Could not save goals to the profile';
        console.error('Goal chat save error:', error.message);
      }
    }

    return res.status(200).json({
      reply: result?.reply ?? '',
      goals: newGoals,
      done: Boolean(result?.done),
      saved,
      ...(saveError && username ? { saveError } : {}),
    });
  });

  app.get('/users/:username/goals', async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database is not connected' });
    try {
      const user = await UserProfile.findByUsername(req.params.username);
      if (!user) return res.status(404).json({ error: 'Could not find user' });
      return res.status(200).json({ goals: user.goals ?? [] });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch goals' });
    }
  });

  app.put('/users/:username/goals', async (req, res) => {
    if (!Array.isArray(req.body?.goals)) return res.status(400).json({ error: 'goals must be a list' });
    if (!dbReady()) return res.status(503).json({ error: 'Database is not connected' });
    try {
      const user = await UserProfile.findByUsername(req.params.username);
      if (!user) return res.status(404).json({ error: 'Could not find user' });
      user.goals = cleanGoals(req.body.goals);
      await user.save();
      return res.status(200).json({ goals: user.goals });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to save goals' });
    }
  });
}
