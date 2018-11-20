const _ = require('lodash')
const moment = require('moment')
const mongoose = require('mongoose')
const Logger = require('node-log-it').Logger
mongoose.Promise = global.Promise

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled rejection. Reason:', reason)
})

// -- Config
const CONNECTION = 'mongodb://localhost/monitor_mainnet'
const COLLECTION_LOGS = 'probe_logs'
const COLLECTION_EP_REPORTS = 'endpoint_reports'
/**
 * A hard coded value to start seeking from this timestamp onward.
 * If undefined, then it'll be based on the timestamp of first log.
 * In milliseconds.
 */
const START_TIMESTAMP = undefined
mongoose.connect(CONNECTION, { useMongoClient: true }) // NOTE: This is async

// -- Implementation

class App {
  constructor() {
    // -- Bootstrap
    this.logger = new Logger('Probe', { level: 'debug' })
    this.probeLogModel = this.getProbeLogModel()
    this.endpointReportsModel = this.getEndpointReportsModel()
    this.logger.info('Constructor completed.')
  }

  async sleep(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }

  /**
   * Not rounded.
   */
  getStartTimestamp() {
    this.logger.debug('getStartTimestamp triggered.')
    if (START_TIMESTAMP !== undefined) {
      this.logger.debug('Configurable constant START_TIMESTAMP found.')
      return Promise.resolve(START_TIMESTAMP)
    } else {
      this.logger.debug('Querying for the timestamp of the earliest log.')
      return new Promise((resolve, reject) => {
        this.probeLogModel
          .findOne()
          .sort({ createdAt: 1 })
          .exec((err, res) => {
            if (err) {
              this.logger.warn('getProbeLogModel.findOne() execution failed. error:', err.message)
              return reject(err)
            }
            if (!res) {
              return reject(new Error('No result found.'))
            }
            // this.logger.info('probeLogModel.findOne() res:', res)
            const createdAt = res.createdAt
            const createdAtTimestamp = createdAt.getTime()
            return resolve(createdAtTimestamp)
          })
      })
    }
  }

  getEndpointReportsModel() {
    this.logger.debug('getEndpointReportsModel triggered.')
    const schema = new mongoose.Schema(
      {
        endpoint: String,
        timestamp: Number,
        period: Number,
        endpoint: String,
        averageLatency: Number,
        meanLatency: Number,
        averageShapedLatency: Number,
        meanShapedLatency: Number,
        hasUserAgentChanged: Boolean,
        startUserAgent: String,
        endUserAgent: String,
        logCount: Number,
        probeCount: Number,
      },
      { timestamps: true }
    )
    return mongoose.models[COLLECTION_EP_REPORTS] || mongoose.model(COLLECTION_EP_REPORTS, schema)
  }

  getProbeLogModel() {
    this.logger.debug('getProbeLogModel triggered.')
    const schema = new mongoose.Schema(
      {
        endpoint: String,
        isActive: Boolean,
        height: Number,
        latency: Number,
        shapedLatency: Number,
        userAgent: String,
        reliability: Number,
        probeId: String,
        probeVersion: String,
      },
      { timestamps: true }
    )
    return mongoose.models[COLLECTION_LOGS] || mongoose.model(COLLECTION_LOGS, schema)
  }

  async run() {
    this.logger.debug('run triggered.')

    await this.sleep(2000) // A workaround to make sure the database connection is ready

    // find starting timestamp of interest, convert that to the nearest minute (round down)
    const startTimestamp = await this.getStartTimestamp() // TODO: validate
    this.logger.info('startTimestamp:', startTimestamp)
    const startMinuteMoment = new moment(startTimestamp).utc().startOf('minute')
    this.logger.info('startMinuteMoment.unix():', startMinuteMoment.unix())
    const endMinuteMoment = new moment().utc().startOf('minute') // To be exclusive
    this.logger.info('endMinuteMoment.unix():', endMinuteMoment.unix())
    const INCREMENT = 60 // 1 minute

    for (let i=startMinuteMoment; i<endMinuteMoment; i.add(INCREMENT, 'seconds')) {
      this.logger.info('>', i.unix())
      await this.sleep(100)
    }

    // iterate from the said timestamp to NOW

      // see if report already made for the said timestamp, if so, skip

      // determine a start/end timestamp range of interest (inclusive)

    // when backfill is complete, passively check for interval and see if new minute report can be generated

  }
}

const app = new App()
app.run()
