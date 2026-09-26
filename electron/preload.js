const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item-in-folder', filePath),

    onOpenFile: (callback) => {
        const listener = (_event, filePath) => {
            callback(filePath);
        };

        ipcRenderer.on('open-file', listener);

        return () => {
            ipcRenderer.removeListener('open-file', listener);
        };
    },
    onOpenFiles: (callback) => {
        const listener = (_event, filePaths) => {
            callback(filePaths);
        };

        ipcRenderer.on('open-files', listener);

        return () => {
            ipcRenderer.removeListener('open-files', listener);
        };
    },

    rendererReady: () => ipcRenderer.send('renderer-ready'),
});
