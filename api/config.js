import { sendJson, methodNotAllowed } from '../lib/http.js';
import { resolvePublishableKey } from '../lib/stripe/env.js';

export default function handler(req, res) {
  if (req?.method && req.method !== 'GET') {
    return methodNotAllowed(res, 'GET');
  }

  const publishableKey = resolvePublishableKey();
  if (!publishableKey) {
    return sendJson(res, 500, {
      error:
        'Missing STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY or STRIPE_PUBLIC_KEY environment variable.',
    });
  }

  return sendJson(res, 200, { publishableKey });
}
