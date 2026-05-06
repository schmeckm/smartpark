/**
 * Mirrors optional API field `signalPreview` (OpenAPI `SignalRuntimePreview`).
 * Additive; Add-on Board UI may ignore until needed.
 */
export type SignalPreviewUsage = 'board' | 'ml' | 'green' | 'generic';

export type SignalPreviewStatus =
  | 'valid'
  | 'disabled'
  | 'missing_signal'
  | 'not_board_eligible'
  | 'not_ml_eligible'
  | 'entity_mismatch'
  | 'no_live_value';

export interface SignalEligibility {
  enabled: boolean;
  boardEligible: boolean;
  mlEligible: boolean;
}

export interface SignalLatestValuePreview {
  value: unknown;
  unit: string | null;
  ts: string;
  quality: string;
  source: string;
}

export interface SignalPreview {
  signalKey: string;
  domain: string;
  metric: string;
  entityType?: string;
  entityId?: string;
  eligibility: SignalEligibility;
  status: SignalPreviewStatus;
  latestValue: SignalLatestValuePreview | null;
}
