// One in-process event bus for live updates: chat channels ("e12", "s3", …) and each person's
// own line ("u<id>") for their notifications. Zury runs as one process, so this is enough.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);

module.exports = bus;
