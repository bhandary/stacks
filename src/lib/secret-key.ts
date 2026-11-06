const SECRET_KEY =
  /(^|[_-])(password|passwd|secret|token|api[_-]?key|credential|database_url)([_-]|$)/i;

export function isSecretAppStateKey(key: string): boolean {
  return SECRET_KEY.test(key);
}
