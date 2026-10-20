/**
 * AI Model Helpers for Creation Scripts
 *
 * Normalizes model names, handles Google Generative AI initialization,
 * and provides robust fallback between Gemini 4 (gemini-4-argon) and
 * Gemini 3.8 (gemini-3.8-flash).
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export const GEMINI_MODELS = {
  FLASH: 'gemini-3.8-flash',
  PRO: 'gemini-4-argon',
};

/**
 * Normalizes user-supplied model strings or shortcuts to canonical Gemini model IDs.
 */
export function resolveGeminiModelId(raw) {
  if (!raw || typeof raw !== 'string') {
    return GEMINI_MODELS.FLASH;
  }
  const clean = raw.trim().toLowerCase();

  if (['gemini-4', 'gemini-4-pro', 'gemini-4-argon', 'pro', '4'].includes(clean)) {
    return GEMINI_MODELS.PRO;
  }
  if (['gemini-3.8', 'gemini-3.8-flash', 'flash', '3.8', 'default'].includes(clean)) {
    return GEMINI_MODELS.FLASH;
  }
  if (['gemini-3.7', 'gemini-3.7-flash', '3.7'].includes(clean)) {
    return 'gemini-3.7-flash';
  }
  if (['gemini-3.6', 'gemini-3.6-flash', '3.6'].includes(clean)) {
    return 'gemini-3.6-flash';
  }
  if (['gemini-3.5', 'gemini-3.5-flash', '3.5'].includes(clean)) {
    return 'gemini-3.5-flash';
  }
  return raw.trim();
}

/**
 * Creates a Google Generative AI model instance.
 */
export function createGeminiModel(apiKey, modelId = GEMINI_MODELS.FLASH) {
  const google = createGoogleGenerativeAI({ apiKey });
  const canonicalId = resolveGeminiModelId(modelId);
  return {
    instance: google(canonicalId),
    modelId: canonicalId,
    google,
  };
}

/**
 * Executes an AI operation with automatic model fallback.
 * If the primary model (e.g. gemini-4-argon) fails due to model availability,
 * rate limits, or 404, it transparently retries with the fallback model (e.g. gemini-3.8-flash).
 */
export async function runWithModelFallback({
  apiKey,
  primaryModelId = GEMINI_MODELS.FLASH,
  fallbackModelId = GEMINI_MODELS.FLASH,
  runner,
  log = console.log,
}) {
  const primaryId = resolveGeminiModelId(primaryModelId);
  const fallbackId = resolveGeminiModelId(fallbackModelId);

  try {
    const primary = createGeminiModel(apiKey, primaryId);
    return await runner(primary.instance, primaryId);
  } catch (err) {
    const errText = String(err?.message || err);
    const isModelAvailabilityError =
      /not found|not supported|unsupported model|404|resource exhausted|quota|permission/i.test(errText);

    if (isModelAvailabilityError && primaryId !== fallbackId) {
      log(`  ⚠️ Primary model ${primaryId} unavailable (${errText.slice(0, 100)}...); falling back to ${fallbackId}...`);
      const fallback = createGeminiModel(apiKey, fallbackId);
      return await runner(fallback.instance, fallbackId);
    }
    throw err;
  }
}
