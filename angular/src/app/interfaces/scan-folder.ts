export interface ScanFolder {
  id: string;
  path: string;
  enabled: boolean;
  type: 'default' | 'custom';
  status: string;
  errorMessage?: string;
  lastCheckedAt?: string;
}
