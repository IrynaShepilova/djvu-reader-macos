const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const VOLUMES_PATH = path.resolve('/Volumes');

function getVolumePath(filePath) {
    const normalizedPath = path.resolve(filePath);
    const relativePath = path.relative(VOLUMES_PATH, normalizedPath);

    if (
        relativePath === '' ||
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        return null;
    }

    const [volumeName] = relativePath.split(path.sep);
    return volumeName ? path.join(VOLUMES_PATH, volumeName) : null;
}

function getMountedPaths() {
    const output = childProcess.execFileSync('/sbin/mount', { encoding: 'utf8' });

    return output
        .split('\n')
        .map(line => line.match(/ on (.+) \(/)?.[1])
        .filter(Boolean)
        .map(mountPath => path.resolve(mountPath));
}

function getBookFileAccess(filePath, dependencies = {}) {
    const {
        platform = process.platform,
        accessSync = fs.accessSync,
        statSync = fs.statSync,
        getMountedVolumePaths = getMountedPaths,
    } = dependencies;

    const volumePath = platform === 'darwin' ? getVolumePath(filePath) : null;

    if (volumePath) {
        let mountedPaths;

        try {
            mountedPaths = getMountedVolumePaths();
            accessSync(volumePath, fs.constants.R_OK | fs.constants.X_OK);
        } catch {
            return {
                available: false,
                code: 'NETWORK_VOLUME_UNAVAILABLE',
                volumePath,
            };
        }

        if (!mountedPaths.includes(volumePath)) {
            return {
                available: false,
                code: 'NETWORK_VOLUME_UNAVAILABLE',
                volumePath,
            };
        }
    }

    try {
        const stat = statSync(filePath);

        return stat.isFile()
            ? { available: true }
            : { available: false, code: 'FILE_NOT_FOUND' };
    } catch {
        return { available: false, code: 'FILE_NOT_FOUND' };
    }
}

module.exports = {
    getBookFileAccess,
    getMountedPaths,
    getVolumePath,
};
