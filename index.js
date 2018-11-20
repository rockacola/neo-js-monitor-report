const _ = require('lodash')
// const moment = require('moment')
const mongoose = require('mongoose')
const Logger = require('node-log-it').Logger
mongoose.Promise = global.Promise

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled rejection. Reason:', reason)
})

// -- Config
const CONNECTION = 'mongodb://localhost/monitor_mainnet'
mongoose.connect(CONNECTION, { useMongoClient: true }) // NOTE: This is async

// -- Implementation

class App {
  constructor() {
    // -- Bootstrap
    this.logger = new Logger('Probe', { level: 'info' })
    this.logger.info('Constructor completed.')
  }

  async sleep(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }

  run() {
    this.logger.debug('run triggered.')
  }
}

const app = new App()
app.run()
