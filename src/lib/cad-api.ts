/**
 * Centralized CAD backend configuration.
 *
 * All API base URLs are defined here in one place.
 * Override via environment variables for different deployments:
 *   - NEXT_PUBLIC_GEOMETRY_API_URL  (renderer / browser / Electron preload)
 *   - GEOMETRY_API_URL              (Electron main process, server-side)
 *
 * Default: http://127.0.0.1:8400/api/v1/geometry
 */

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_GEOMETRY_API_URL ||
                         'http://127.0.0.1:8400/api/v1/geometry';

export const CAD_API = {
  /** Base URL for all geometry-engine HTTP requests. */
  baseUrl: DEFAULT_BASE_URL,

  /** Full health-check URL. */
  healthUrl: DEFAULT_BASE_URL.replace(/\/api\/v1\/geometry$/, '/api/v1/health'),

  /**
   * Check whether the geometry-engine URL has been customized.
   * Useful for diagnostics / UI warnings.
   */
  isDefault(): boolean {
    return this.baseUrl === 'http://127.0.0.1:8400/api/v1/geometry';
  },
};
