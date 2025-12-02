import fs from 'fs';
import path from 'path';

const PUBLISHABLE_KEY_CANDIDATES = [
  'STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_PUBLIC_KEY',
];

const SECRET_KEY_CANDIDATES = [
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET',
  'STRIPE_API_KEY',
];

const BASE_URL_CANDIDATES = [
  'STRIPE_BASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
  'SITE_URL',
];

let cachedFileEnv = null;

function parseEnvLine(line) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (!match) {
    return null;
  }

  const key = match[1].trim();
  if (!key) {
    return null;
  }

  let value = match[2].trim();
  if (!value) {
    return [key, ''];
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    const hashIndex = value.indexOf('#');
    if (hashIndex !== -1) {
      const previousChar = value[hashIndex - 1];
      if (hashIndex === 0 || /\s/.test(previousChar)) {
        const candidate = value.slice(0, hashIndex).trim();
        if (candidate) {
          value = candidate;
        }
      }
    }
  }

  return [key, value];
}

function loadEnvFromFiles() {
  if (cachedFileEnv) {
    return cachedFileEnv;
  }

  cachedFileEnv = {};
  const candidates = ['.env.local', '.env'];
  for (const filename of candidates) {
    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const contents = fs.readFileSync(filePath, 'utf8');
      for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
          continue;
        }

        const entry = parseEnvLine(line);
        if (!entry) {
          continue;
        }

        const [key, value] = entry;
        if (!(key in cachedFileEnv)) {
          cachedFileEnv[key] = value;
        }
      }
    } catch (error) {
      continue;
    }
  }

  return cachedFileEnv;
}

function getEnvValue(name, env = process.env) {
  const direct = env?.[name];
  if (direct && String(direct).trim()) {
    return String(direct).trim();
  }

  const fileEnv = loadEnvFromFiles();
  if (fileEnv?.[name] && String(fileEnv[name]).trim()) {
    return String(fileEnv[name]).trim();
  }

  return null;
}

export function resolvePublishableKey(env = process.env) {
  for (const variable of PUBLISHABLE_KEY_CANDIDATES) {
    const value = getEnvValue(variable, env);
    if (value) {
      return value;
    }
  }
  return null;
}

export function resolveStripeSecretKey(env = process.env) {
  for (const variable of SECRET_KEY_CANDIDATES) {
    const value = getEnvValue(variable, env);
    if (value) {
      return value;
    }
  }

  throw new Error(
    'Missing STRIPE_SECRET_KEY environment variable. Set it to your Stripe secret key.'
  );
}

export function resolveBaseUrl(env = process.env) {
  for (const variable of BASE_URL_CANDIDATES) {
    const value = getEnvValue(variable, env);
    if (value) {
      return value.replace(/\/$/, '');
    }
  }

  return 'http://localhost:5000';
}
