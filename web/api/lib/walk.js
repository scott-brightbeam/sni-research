const SAFE_PARAM = /^[\w-]+$/

export function validateParam(value, name) {
  if (!SAFE_PARAM.test(value)) throw new Error(`Invalid ${name}: ${value}`)
}
