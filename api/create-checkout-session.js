import Stripe from 'stripe';
import { sendJson, methodNotAllowed } from '../lib/http.js';
import { PLAN_CONFIG, SUPPORTED_LOCALES } from '../lib/stripe/constants.js';
import { resolveStripeSecretKey, resolveBaseUrl } from '../lib/stripe/env.js';
import { readJsonBody } from '../lib/request.js';

let cachedStripe = null;
let cachedSecretKey = null;

function getStripeClient() {
  const secretKey = resolveStripeSecretKey();
  if (!cachedStripe || cachedSecretKey !== secretKey) {
    cachedStripe = new Stripe(secretKey, {
      apiVersion: process.env.STRIPE_API_VERSION || '2022-11-15',
    });
    cachedSecretKey = secretKey;
  }
  return cachedStripe;
}

function normaliseLocale(input) {
  if (!input) {
    return 'en';
  }
  const value = String(input).split('-')[0].toLowerCase();
  return SUPPORTED_LOCALES.has(value) ? value : 'en';
}

export default async function handler(req, res) {
  if (req?.method && req.method !== 'POST') {
    return methodNotAllowed(res, 'POST');
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'Invalid JSON payload.' });
  }

  const planKey = payload?.plan;
  const planConfig = planKey ? PLAN_CONFIG[planKey] : null;
  if (!planConfig) {
    return sendJson(res, 400, { error: 'Unknown pricing plan.' });
  }

  const locale = normaliseLocale(payload?.locale);
  const name = (payload?.name || planConfig.defaultName || '').toString().trim();
  const description = (payload?.description || planConfig.defaultDescription || '')
    .toString()
    .trim();

  const baseUrl = resolveBaseUrl();
  const successUrl =
    process.env.STRIPE_SUCCESS_URL ||
    `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = process.env.STRIPE_CANCEL_URL || `${baseUrl}/cancel`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      locale,
      success_url: successUrl,
      cancel_url: cancelUrl,
      automatic_tax: { enabled: false },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'cad',
            unit_amount: planConfig.amount,
            product_data: {
              name: name || planConfig.defaultName,
              description: description || planConfig.defaultDescription,
            },
          },
        },
      ],
    });

    return sendJson(res, 200, { sessionId: session.id });
  } catch (error) {
    const statusCode =
      error?.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    const message =
      error?.raw?.message || error?.message || 'Unable to create Stripe Checkout session.';

    return sendJson(res, statusCode, { error: message });
  }
}
