/// <reference types="vite/client" />
import type { PssApi } from '../../shared/types/api'

declare global {
  interface Window {
    pss: PssApi
  }
}

export {}
