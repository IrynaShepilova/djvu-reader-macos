let scanState = {
    running: false,
    done: false,
    percent: 0,
    processed: 0,
    total: 0,
    added: 0,
    message: ''
};

function getScanState() {
    return scanState;
}

function setScanState(nextState) {
    scanState = nextState;
}

module.exports = {
    getScanState,
    setScanState,
};
