/**
 * Swedish cooking unit conversions and ingredient parsing utilities.
 *
 * Common Swedish cooking measurements:
 * - msk (matsked) = tablespoon = 15ml
 * - tsk (tesked) = teaspoon = 5ml
 * - krm (kryddmått) = pinch = ~1ml
 * - dl (deciliter) = 100ml
 * - l (liter) = 1000ml
 * - g (gram)
 * - kg (kilogram) = 1000g
 * - st (styck) = piece/unit
 * - cl (centiliter) = 10ml
 * - ml (milliliter)
 */

export interface ParsedIngredient {
  [key: string]: unknown; // Index signature for MCP SDK compatibility
  originalText: string;
  quantity: number;
  unit: string;
  unitInGrams: number | null; // null if unit is 'st' (pieces) or unknown
  ingredientName: string;
  gramsEquivalent: number | null;
}

export interface RecipeIngredient {
  foodId: string;
  quantity: number;
  unit: string;
  ingredientName: string;
}

// Volume to ml conversions
const VOLUME_TO_ML: Record<string, number> = {
  'msk': 15,
  'matsked': 15,
  'tsk': 5,
  'tesked': 5,
  'krm': 1,
  'kryddmått': 1,
  'dl': 100,
  'deciliter': 100,
  'l': 1000,
  'liter': 1000,
  'cl': 10,
  'centiliter': 10,
  'ml': 1,
  'milliliter': 1,
};

// Weight to grams conversions
const WEIGHT_TO_GRAMS: Record<string, number> = {
  'g': 1,
  'gram': 1,
  'kg': 1000,
  'kilogram': 1000,
  'hg': 100,
  'hekto': 100,
  'hektogram': 100,
};

// Approximate densities for common ingredients (g/ml)
// Used to convert volume measurements to weight
const INGREDIENT_DENSITIES: Record<string, number> = {
  // Liquids
  'vatten': 1.0,
  'water': 1.0,
  'mjölk': 1.03,
  'milk': 1.03,
  'grädde': 1.0,
  'cream': 1.0,
  'olja': 0.92,
  'oil': 0.92,
  'olivolja': 0.92,
  'rapsolja': 0.92,
  'smör': 0.91,
  'butter': 0.91,
  'honung': 1.42,
  'honey': 1.42,
  'sirap': 1.4,
  'syrup': 1.4,

  // Flours and powders
  'vetemjöl': 0.53,
  'mjöl': 0.53,
  'flour': 0.53,
  'socker': 0.85,
  'sugar': 0.85,
  'strösocker': 0.85,
  'florsocker': 0.56,
  'potatismjöl': 0.54,
  'maizena': 0.54,
  'bakpulver': 0.72,
  'bikarbonat': 0.69,
  'kakao': 0.35,
  'cocoa': 0.35,
  'kanel': 0.45,
  'cinnamon': 0.45,
  'salt': 1.2,

  // Grains and rice
  'ris': 0.85,
  'rice': 0.85,
  'havregryn': 0.35,
  'oats': 0.35,
  'pasta': 0.45,
  'couscous': 0.60,

  // Nuts and seeds
  'mandel': 0.46,
  'almonds': 0.46,
  'valnötter': 0.45,
  'walnuts': 0.45,
  'sesamfrön': 0.58,
  'linfrön': 0.51,

  // Dairy
  'ost': 1.1,
  'cheese': 1.1,
  'riven ost': 0.45,
  'kvarg': 1.0,
  'yoghurt': 1.03,
  'crème fraiche': 1.0,
  'créme fraiche': 1.0,

  // Default density for unknown ingredients
  'default': 0.8,
};

/**
 * Convert a Swedish unit and quantity to grams.
 * Returns null if the unit is 'st' (pieces) or cannot be converted.
 */
export function convertToGrams(
  quantity: number,
  unit: string,
  ingredientName: string
): number | null {
  const normalizedUnit = unit.toLowerCase().trim();
  const normalizedIngredient = ingredientName.toLowerCase().trim();

  // Direct weight conversion
  if (WEIGHT_TO_GRAMS[normalizedUnit]) {
    return quantity * WEIGHT_TO_GRAMS[normalizedUnit];
  }

  // Volume conversion - need to multiply by density
  if (VOLUME_TO_ML[normalizedUnit]) {
    const ml = quantity * VOLUME_TO_ML[normalizedUnit];
    const density = findDensity(normalizedIngredient);
    return ml * density;
  }

  // Pieces - cannot convert to grams without more context
  if (normalizedUnit === 'st' || normalizedUnit === 'styck' || normalizedUnit === 'stycken') {
    return null;
  }

  // Unknown unit
  return null;
}

/**
 * Find the density for an ingredient, checking for partial matches.
 */
function findDensity(ingredientName: string): number {
  // Check for exact match first
  if (INGREDIENT_DENSITIES[ingredientName]) {
    return INGREDIENT_DENSITIES[ingredientName];
  }

  // Check if ingredient name contains any known ingredient
  for (const [key, density] of Object.entries(INGREDIENT_DENSITIES)) {
    if (ingredientName.includes(key) || key.includes(ingredientName)) {
      return density;
    }
  }

  return INGREDIENT_DENSITIES['default'];
}

/**
 * Parse a Swedish ingredient string into structured data.
 *
 * Examples:
 * - "2 dl mjölk" -> { quantity: 2, unit: "dl", ingredientName: "mjölk" }
 * - "200g kycklingbröst" -> { quantity: 200, unit: "g", ingredientName: "kycklingbröst" }
 * - "1 msk olivolja" -> { quantity: 1, unit: "msk", ingredientName: "olivolja" }
 * - "3 st ägg" -> { quantity: 3, unit: "st", ingredientName: "ägg" }
 * - "1/2 tsk salt" -> { quantity: 0.5, unit: "tsk", ingredientName: "salt" }
 */
export function parseSwedishIngredient(text: string): ParsedIngredient {
  const originalText = text.trim();

  // Normalize the text
  let normalized = originalText.toLowerCase();

  // Handle fractions like 1/2, 1/4, 3/4
  normalized = normalized.replace(/(\d+)\/(\d+)/g, (_, num, den) => {
    return (parseInt(num) / parseInt(den)).toString();
  });

  // Handle mixed fractions like "1 1/2" or "2 1/4"
  normalized = normalized.replace(/(\d+)\s+(\d+)\/(\d+)/g, (_, whole, num, den) => {
    return (parseInt(whole) + parseInt(num) / parseInt(den)).toString();
  });

  // Pattern to match: number (with optional decimal), optional space, unit, rest is ingredient name
  // Units can be attached to the number or separated by space
  const allUnits = [
    ...Object.keys(VOLUME_TO_ML),
    ...Object.keys(WEIGHT_TO_GRAMS),
    'st', 'styck', 'stycken'
  ].join('|');

  const pattern = new RegExp(
    `^([\\d.,]+)\\s*(${allUnits})\\s+(.+)$`,
    'i'
  );

  const match = normalized.match(pattern);

  if (match) {
    const quantity = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase();
    const ingredientName = match[3].trim();
    const gramsEquivalent = convertToGrams(quantity, unit, ingredientName);

    return {
      originalText,
      quantity,
      unit,
      unitInGrams: getUnitToGrams(unit, ingredientName),
      ingredientName,
      gramsEquivalent,
    };
  }

  // Try pattern without space between number and unit: "200g kött"
  const attachedPattern = new RegExp(
    `^([\\d.,]+)(${allUnits})\\s*(.+)$`,
    'i'
  );

  const attachedMatch = normalized.match(attachedPattern);

  if (attachedMatch) {
    const quantity = parseFloat(attachedMatch[1].replace(',', '.'));
    const unit = attachedMatch[2].toLowerCase();
    const ingredientName = attachedMatch[3].trim();
    const gramsEquivalent = convertToGrams(quantity, unit, ingredientName);

    return {
      originalText,
      quantity,
      unit,
      unitInGrams: getUnitToGrams(unit, ingredientName),
      ingredientName,
      gramsEquivalent,
    };
  }

  // Fallback: try to extract just a number and treat the rest as ingredient name with unknown unit
  const simplePattern = /^([\d.,]+)\s+(.+)$/;
  const simpleMatch = normalized.match(simplePattern);

  if (simpleMatch) {
    const quantity = parseFloat(simpleMatch[1].replace(',', '.'));
    const ingredientName = simpleMatch[2].trim();

    return {
      originalText,
      quantity,
      unit: 'st', // assume pieces if no unit specified
      unitInGrams: null,
      ingredientName,
      gramsEquivalent: null,
    };
  }

  // No quantity found - treat entire text as ingredient name with quantity 1
  return {
    originalText,
    quantity: 1,
    unit: 'st',
    unitInGrams: null,
    ingredientName: normalized,
    gramsEquivalent: null,
  };
}

/**
 * Get the grams equivalent for a single unit of the given type.
 */
function getUnitToGrams(unit: string, ingredientName: string): number | null {
  const normalizedUnit = unit.toLowerCase();
  const normalizedIngredient = ingredientName.toLowerCase();

  if (WEIGHT_TO_GRAMS[normalizedUnit]) {
    return WEIGHT_TO_GRAMS[normalizedUnit];
  }

  if (VOLUME_TO_ML[normalizedUnit]) {
    const ml = VOLUME_TO_ML[normalizedUnit];
    const density = findDensity(normalizedIngredient);
    return ml * density;
  }

  return null;
}

/**
 * Calculate nutrition for a given weight of food based on nutrition per 100g.
 */
export function calculateNutritionForWeight(
  nutritionPer100g: Record<string, number>,
  weightInGrams: number
): Record<string, number> {
  const result: Record<string, number> = {};
  const factor = weightInGrams / 100;

  for (const [nutrient, value] of Object.entries(nutritionPer100g)) {
    result[nutrient] = Math.round(value * factor * 100) / 100; // Round to 2 decimal places
  }

  return result;
}

/**
 * Sum multiple nutrition objects together.
 */
export function sumNutrition(
  nutritionObjects: Record<string, number>[]
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const nutrition of nutritionObjects) {
    for (const [nutrient, value] of Object.entries(nutrition)) {
      result[nutrient] = (result[nutrient] || 0) + value;
    }
  }

  // Round all values to 2 decimal places
  for (const nutrient of Object.keys(result)) {
    result[nutrient] = Math.round(result[nutrient] * 100) / 100;
  }

  return result;
}

/**
 * Divide nutrition values by a number (e.g., to get per-serving values).
 */
export function divideNutrition(
  nutrition: Record<string, number>,
  divisor: number
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [nutrient, value] of Object.entries(nutrition)) {
    result[nutrient] = Math.round((value / divisor) * 100) / 100;
  }

  return result;
}

/**
 * Get Swedish name for common nutrients.
 */
export const NUTRIENT_NAMES_SV: Record<string, string> = {
  'energy_kcal': 'Energi (kcal)',
  'energy_kj': 'Energi (kJ)',
  'protein': 'Protein',
  'fat': 'Fett',
  'saturated_fat': 'Mättat fett',
  'carbohydrates': 'Kolhydrater',
  'sugars': 'Sockerarter',
  'fiber': 'Fiber',
  'salt': 'Salt',
  'sodium': 'Natrium',
  'calcium': 'Kalcium',
  'iron': 'Järn',
  'vitamin_a': 'Vitamin A',
  'vitamin_c': 'Vitamin C',
  'vitamin_d': 'Vitamin D',
  'vitamin_e': 'Vitamin E',
  'vitamin_b12': 'Vitamin B12',
  'folate': 'Folat',
  'potassium': 'Kalium',
  'magnesium': 'Magnesium',
  'zinc': 'Zink',
  'cholesterol': 'Kolesterol',
};
