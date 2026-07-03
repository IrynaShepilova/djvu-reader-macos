const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),

    onOpenFile: (callback) => {
        const listener = (_event, filePath) => {
            callback(filePath);
        };

        ipcRenderer.on('open-file', listener);

        return () => {
            ipcRenderer.removeListener('open-file', listener);
        };
    },

    rendererReady: () => ipcRenderer.send('renderer-ready'),
});
