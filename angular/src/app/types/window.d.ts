export {};

declare global {
  interface Window {
    electronAPI?: {
      selectFolder?: () => Promise<string | null>;
      showItemInFolder?: (filePath: string) => Promise<{
        ok: boolean;
        code?: string;
        volumePath?: string;
      }>;
      openExternalUrl?: (url: string) => Promise<{
        ok: boolean;
        cancelled?: boolean;
        code?: string;
      }>;
      onOpenFile?: (callback: (filePath: string) => void) => () => void;
      onOpenFiles?: (callback: (filePaths: string[]) => void) => () => void;
      rendererReady?: () => void;
    };
  }
}
