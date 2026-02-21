function getConfig() {
    const devUrl = process.env.ELECTRON_START_URL || '';

    const backendHost = process.env.BACKEND_HOST || '127.0.0.1';
    const backendPort = Number(process.env.BACKEND_PORT || 3000);

    const base = `http://${backendHost}:${backendPort}`;

    return {
        devUrl,
        backend: {
            host: backendHost,
            port: backendPort,
            healthUrl: process.env.API_HEALTH_URL || `${base}/api/health`,
            startUrl: process.env.PROD_START_URL || `${base}/library`,
        },
    };
}

module.exports = { getConfig };
