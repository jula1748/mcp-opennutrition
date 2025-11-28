/**
 * REST API server for ChatGPT Custom GPT Actions
 *
 * This provides HTTP endpoints that can be called by ChatGPT
 * to search foods and calculate recipe nutrition.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { SQLiteDBAdapter } from './SQLiteDBAdapter.js';
import {
  parseSwedishIngredient,
  convertToGrams,
  calculateNutritionForWeight,
  sumNutrition,
  divideNutrition,
  NUTRIENT_NAMES_SV,
} from './SwedishUnits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Initialize database
const db = new SQLiteDBAdapter();

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'opennutrition-api' });
});

/**
 * Search foods by name
 * GET /api/foods/search?q=mjölk&page=1&pageSize=5
 */
app.get('/api/foods/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 5;

    if (!query || query.trim().length === 0) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }

    const foods = await db.searchByName(query, page, pageSize);
    res.json({
      query,
      page,
      pageSize,
      results: foods,
      count: foods.length,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get food by ID
 * GET /api/foods/:id
 */
app.get('/api/foods/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id.startsWith('fd_')) {
      res.status(400).json({ error: 'Food ID must start with "fd_"' });
      return;
    }

    const food = await db.getById(id);

    if (!food) {
      res.status(404).json({ error: 'Food not found' });
      return;
    }

    res.json(food);
  } catch (error) {
    console.error('Get food error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Parse Swedish ingredient text
 * POST /api/parse-ingredient
 * Body: { "text": "2 dl mjölk" }
 */
app.post('/api/parse-ingredient', (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Field "text" is required' });
      return;
    }

    const parsed = parseSwedishIngredient(text);
    res.json(parsed);
  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Calculate recipe nutrition
 * POST /api/calculate-recipe
 * Body: {
 *   "ingredients": [
 *     { "foodId": "fd_123", "quantity": 2, "unit": "dl" }
 *   ],
 *   "servings": 4,
 *   "recipeName": "Pannkakor"
 * }
 */
app.post('/api/calculate-recipe', async (req: Request, res: Response) => {
  try {
    const { ingredients, servings = 1, recipeName } = req.body;

    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      res.status(400).json({ error: 'Field "ingredients" must be a non-empty array' });
      return;
    }

    // Validate ingredients
    for (const ing of ingredients) {
      if (!ing.foodId || !ing.quantity || !ing.unit) {
        res.status(400).json({
          error: 'Each ingredient must have foodId, quantity, and unit'
        });
        return;
      }
    }

    const foodIds = ingredients.map((i: any) => i.foodId);
    const foods = await db.getByIds(foodIds);

    const ingredientResults: Array<{
      foodId: string;
      foodName: string;
      quantity: number;
      unit: string;
      gramsUsed: number | null;
      nutrition: Record<string, number> | null;
      error?: string;
    }> = [];

    const allNutrition: Record<string, number>[] = [];

    for (const ingredient of ingredients) {
      const food = foods.get(ingredient.foodId);

      if (!food) {
        ingredientResults.push({
          foodId: ingredient.foodId,
          foodName: 'Okänd',
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          gramsUsed: null,
          nutrition: null,
          error: `Livsmedel hittades inte: ${ingredient.foodId}`,
        });
        continue;
      }

      const gramsUsed = convertToGrams(ingredient.quantity, ingredient.unit, food.name);

      if (gramsUsed === null) {
        ingredientResults.push({
          foodId: ingredient.foodId,
          foodName: food.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          gramsUsed: null,
          nutrition: null,
          error: `Kan inte konvertera ${ingredient.quantity} ${ingredient.unit} till gram.`,
        });
        continue;
      }

      if (!food.nutrition_100g) {
        ingredientResults.push({
          foodId: ingredient.foodId,
          foodName: food.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          gramsUsed,
          nutrition: null,
          error: 'Näringsvärden saknas för detta livsmedel',
        });
        continue;
      }

      const ingredientNutrition = calculateNutritionForWeight(food.nutrition_100g, gramsUsed);
      allNutrition.push(ingredientNutrition);

      ingredientResults.push({
        foodId: ingredient.foodId,
        foodName: food.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        gramsUsed: Math.round(gramsUsed * 10) / 10,
        nutrition: ingredientNutrition,
      });
    }

    const totalNutrition = sumNutrition(allNutrition);
    const perServingNutrition = divideNutrition(totalNutrition, servings);

    res.json({
      recipeName: recipeName || 'Namnlöst recept',
      servings,
      ingredients: ingredientResults,
      totalNutrition,
      perServingNutrition,
      nutrientNamesSv: NUTRIENT_NAMES_SV,
    });
  } catch (error) {
    console.error('Calculate recipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Combined endpoint: Parse ingredients and calculate nutrition in one call
 * This is the most convenient for ChatGPT to use
 *
 * POST /api/recipe-from-text
 * Body: {
 *   "ingredientTexts": ["2 dl mjölk", "3 st ägg", "2 dl vetemjöl"],
 *   "servings": 4,
 *   "recipeName": "Pannkakor"
 * }
 */
app.post('/api/recipe-from-text', async (req: Request, res: Response) => {
  try {
    const { ingredientTexts, servings = 1, recipeName } = req.body;

    if (!ingredientTexts || !Array.isArray(ingredientTexts) || ingredientTexts.length === 0) {
      res.status(400).json({ error: 'Field "ingredientTexts" must be a non-empty array' });
      return;
    }

    const results: Array<{
      originalText: string;
      parsed: {
        quantity: number;
        unit: string;
        ingredientName: string;
      };
      searchResults: any[];
      selectedFood: any | null;
      gramsUsed: number | null;
      nutrition: Record<string, number> | null;
      error?: string;
    }> = [];

    const allNutrition: Record<string, number>[] = [];

    for (const text of ingredientTexts) {
      const parsed = parseSwedishIngredient(text);

      // Search for the ingredient
      const searchResults = await db.searchByName(parsed.ingredientName, 1, 3);

      if (searchResults.length === 0) {
        results.push({
          originalText: text,
          parsed: {
            quantity: parsed.quantity,
            unit: parsed.unit,
            ingredientName: parsed.ingredientName,
          },
          searchResults: [],
          selectedFood: null,
          gramsUsed: null,
          nutrition: null,
          error: `Kunde inte hitta "${parsed.ingredientName}" i databasen`,
        });
        continue;
      }

      // Use the first (best) match
      const food = searchResults[0];
      const gramsUsed = convertToGrams(parsed.quantity, parsed.unit, food.name);

      if (gramsUsed === null) {
        results.push({
          originalText: text,
          parsed: {
            quantity: parsed.quantity,
            unit: parsed.unit,
            ingredientName: parsed.ingredientName,
          },
          searchResults: searchResults.map(f => ({ id: f.id, name: f.name })),
          selectedFood: { id: food.id, name: food.name },
          gramsUsed: null,
          nutrition: null,
          error: `Kan inte konvertera ${parsed.quantity} ${parsed.unit} till gram`,
        });
        continue;
      }

      if (!food.nutrition_100g) {
        results.push({
          originalText: text,
          parsed: {
            quantity: parsed.quantity,
            unit: parsed.unit,
            ingredientName: parsed.ingredientName,
          },
          searchResults: searchResults.map(f => ({ id: f.id, name: f.name })),
          selectedFood: { id: food.id, name: food.name },
          gramsUsed,
          nutrition: null,
          error: 'Näringsvärden saknas',
        });
        continue;
      }

      const nutrition = calculateNutritionForWeight(food.nutrition_100g, gramsUsed);
      allNutrition.push(nutrition);

      results.push({
        originalText: text,
        parsed: {
          quantity: parsed.quantity,
          unit: parsed.unit,
          ingredientName: parsed.ingredientName,
        },
        searchResults: searchResults.map(f => ({ id: f.id, name: f.name })),
        selectedFood: { id: food.id, name: food.name },
        gramsUsed: Math.round(gramsUsed * 10) / 10,
        nutrition,
      });
    }

    const totalNutrition = sumNutrition(allNutrition);
    const perServingNutrition = divideNutrition(totalNutrition, servings);

    res.json({
      recipeName: recipeName || 'Namnlöst recept',
      servings,
      ingredients: results,
      totalNutrition,
      perServingNutrition,
      nutrientNamesSv: NUTRIENT_NAMES_SV,
    });
  } catch (error) {
    console.error('Recipe from text error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║                                              ║');
  console.log('  ║   🥗  Receptkalkylator är igång!            ║');
  console.log('  ║                                              ║');
  console.log(`  ║   Öppna i webbläsaren:                       ║`);
  console.log(`  ║   👉  http://localhost:${PORT}                    ║`);
  console.log('  ║                                              ║');
  console.log('  ║   Stäng detta fönster för att avsluta.       ║');
  console.log('  ║                                              ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
