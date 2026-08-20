import type { PssApi } from '../../shared/types/api'

/** Typed access to the preload-exposed main-process API. */
export const api: PssApi = window.pss
