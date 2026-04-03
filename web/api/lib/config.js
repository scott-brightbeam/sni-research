import { resolve } from 'path'

function env(key, fallback) {
  return process.env[key] ?? fallback
}

const ROOT = env('SNI_ROOT', resolve(import.meta.dir, '../../..'))
const isProduction = env('NODE_ENV', 'development') === 'production'

export default {
  ROOT,
  PORT: parseInt(env('PORT', '3900')),
  CORS_ORIGIN: env('SNI_CORS_ORIGIN', isProduction ? '' : 'http://localhost:5173'),
  TOKEN_CEILING: parseInt(env('SNI_TOKEN_CEILING', '500000')),
  INGEST_URL: env('SNI_INGEST_URL', 'http://127.0.0.1:3847'),
  PIPELINE_ENABLED: env('SNI_PIPELINE_ENABLED', 'true') === 'true',
  isProduction,
  SESSION_SECRET: env('SNI_SESSION_SECRET', ''),
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID', ''),
  GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET', ''),
  AUTH_DOMAIN: env('SNI_AUTH_DOMAIN', ''),
}
