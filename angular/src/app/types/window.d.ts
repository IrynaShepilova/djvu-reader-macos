export {};

declare global {
  interface Window {
    electronAPI?: {
      selectFolder?: () => Promise<string | null>;
      onOpenFile?: (callback: (filePath: string) => void) => () => void;
      rendererReady?: () => void;
    };
  }
}
