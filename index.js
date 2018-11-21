const _ = require('lodash')
const moment = require('moment')
const mongoose = require('mongoose')
const Logger = require('node-log-it').Logger
const MathHelper = require('./lib/math-helper')
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
// const START_TIMESTAMP = 1542763597000
const VERSION = require('./package.json').version
const ENDPOINTS = require('./lib/endpoints.json')
mongoose.connect(CONNECTION, { useMongoClient: true }) // NOTE: This is async

// -- Implementation

class App {
  constructor() {
    // -- Init
    this.toKeepRunning = true
    this.isCurrentlyReporting = false

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
   * @returns Promise<object>
   */
  getStartMoment() {
    this.logger.debug('getStartMoment triggered.')
    if (START_TIMESTAMP !== undefined) {
      this.logger.debug('Configurable constant START_TIMESTAMP found.')
      const m = new moment(START_TIMESTAMP).utc().startOf('minute')
      return Promise.resolve(m)
    } else {
      //
      this.logger.debug('Querying for the timestamp of the earliest log.')
      return new Promise((resolve, reject) => {
        this.getEarliestProbeLogDocument()
          .then((res) => {
            const m = new moment(res.createdAt).utc().startOf('minute')
            return resolve(m)
          })
          .catch((err) => reject(err))
      })
    }
  }

  getEarliestProbeLogDocument() {
    this.logger.debug('getEarliestProbeLogDocument triggered.')

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
          return resolve(res)
        })
    })
  }

  getEndpointReportsModel() {
    this.logger.debug('getEndpointReportsModel triggered.')
    const schema = new mongoose.Schema(
      {
        reportTimestamp: Number,
        period: Number,
        endpoint: String,
        meanLatency: Number,
        medianLatency: Number,
        meanShapedLatency: Number,
        hasUserAgentChanged: Boolean,
        startUserAgent: String,
        endUserAgent: String,
        meanReliability: Number,
        logCount: Number,
        probeCount: Number,
        reportVersion: String,
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

  async performFirstRun() {
    this.logger.debug('performFirstRun triggered.')

    let currentMoment = await this.getStartMoment()
    this.logger.info('getStartMoment():', currentMoment)

    while(this.toKeepRunning) {
      // Verify if there's an existing reporting executing
      if (this.isCurrentlyReporting) {
        this.logger.info('A reporting is happening right now, wait out...')
        await this.sleep(1000)
        return
      }

      // Verify if we reached to present time
      if (currentMoment >= (new moment()).startOf('minute')) {
        this.logger.info('We have reached to present time where not enough logs available for reporting, wait out...')
        await this.sleep(15 * 1000)
        return
      }

      // Generate minute report
      this.isCurrentlyReporting = true
      const fromMoment = currentMoment
      const toMoment = currentMoment.clone().add(59, 'seconds')
      await this.generateReports(fromMoment, toMoment)

      // Iterate
      currentMoment.add(1, 'minutes')
      this.isCurrentlyReporting = false
    }
  }

  async generateReports(fromMoment, toMoment) {
    this.logger.debug('generateReports triggered. fromMoment:', fromMoment, 'toMoment:', toMoment)

    for(let i=0; i<ENDPOINTS.length; i++) {
      const endpoint = ENDPOINTS[i].endpoint
      await this.generateReportByEndpoint(endpoint, fromMoment, toMoment)
    }
  }

  async generateReportByEndpoint(endpoint, fromMoment, toMoment) {
    this.logger.debug('generateReportByEndpoint triggered. endpoint:', endpoint)
    await this.sleep(1 * 1000)

    // Check for existing report(s)
    const reportCount = await this.countReport(endpoint, fromMoment, toMoment)
    this.logger.debug('reportCount:', reportCount)
    if (reportCount > 0) {
      this.logger.info('There are already existing report(s) for endpoint:', endpoint, 'count:', reportCount)
      return
    }

    const logs = await this.getProbeLogs(endpoint, fromMoment, toMoment)
    this.logger.debug('logs.length:', logs.length)
    // this.logger.debug('logs:', logs)

    // Create empty report if there's no logs available
    if (logs.length === 0) {
      this.logger.info('Create black report for endpoint:', endpoint)
      const reportDoc = this.generateBlankReportDocument(endpoint, fromMoment, 60)
      await this.setReportDocument(reportDoc)
    }

    // Create report
    const reportDoc = this.generateReportDocument(endpoint, fromMoment, 60, logs)
    await this.setReportDocument(reportDoc)
  }

  generateReportDocument(endpoint, fromMoment, period, logs) {
    this.logger.debug('generateReportDocument triggered.')

    const latencyLogs = _.filter(logs, (log) => _.isNumber(log.latency))
    const shapedLatencyLogs = _.filter(logs, (log) => _.isNumber(log.shapedLatency))
    const reliabilityLogs = _.filter(logs, (log) => _.isNumber(log.reliability))

    const meanLatency = (latencyLogs.length > 0) ? _.meanBy(latencyLogs, 'latency') : undefined
    const medianLatency = (latencyLogs.length > 0) ? MathHelper.median(_.map(latencyLogs, 'latency')) : undefined
    const meanShapedLatency =  (shapedLatencyLogs.length > 0) ? _.meanBy(shapedLatencyLogs, 'shapedLatency') : undefined
    const hasUserAgentChanged = (_.uniqBy(logs, 'userAgent').length > 1) ? true : false
    const startUserAgent = _.min(logs, 'createdAt').userAgent
    const endUserAgent = _.max(logs, 'createdAt').userAgent
    const meanReliability = (reliabilityLogs.length > 0) ? _.meanBy(reliabilityLogs, 'reliability') : undefined
    const probeCount = _.uniqBy(logs, 'probeId').length

    const data = {
      reportTimestamp: fromMoment.unix(),
      period,
      endpoint,
      meanLatency,
      medianLatency,
      meanShapedLatency,
      hasUserAgentChanged,
      startUserAgent,
      endUserAgent,
      meanReliability,
      logCount: logs.length,
      probeCount,
      reportVersion: VERSION,
    }
    return data
  }

  generateBlankReportDocument(endpoint, fromMoment, period) {
    this.logger.debug('generateBlankReportDocument triggered.')
    const data = {
      reportTimestamp: fromMoment.unix(),
      period,
      endpoint,
      logCount: 0,
      probeCount: 0,
      reportVersion: VERSION,
    }
    return data
  }

  async setReportDocument(doc) {
    this.logger.debug('setReportDocument triggered.')

    return new Promise((resolve, reject) => {
      this.endpointReportsModel(doc).save((err) => {
        if (err) {
          this.logger.warn('endpointReportsModel().save() execution failed.')
          reject(err)
        }
        return resolve()
      })
    })
  }

  async getProbeLogs(endpoint, fromMoment, toMoment) {
    this.logger.debug('countReport triggered.')

    return new Promise((resolve, reject) => {
      this.probeLogModel
        .find({
          endpoint: endpoint,
          createdAt: {
            $gte: fromMoment.toDate(),
            $lte: toMoment.toDate(),
          },
        })
        .exec((err, res) => {
          if (err) {
            this.logger.warn('probeLogModel.find() execution failed. error:', err.message)
            return reject(err)
          }
          if (!res) {
            return reject(new Error('No result found.'))
          }
          return resolve(res)
        })
    })
  }

  async countReport(endpoint, fromMoment, toMoment) {
    this.logger.debug('countReport triggered.')

    return new Promise((resolve, reject) => {
      this.endpointReportsModel
        .count({
          endpoint: endpoint,
          reportTimestamp: {
            $gte: fromMoment.unix(),
            $lte: toMoment.unix(),
          },
        })
        .exec((err, res) => {
          if (err) {
            this.logger.warn('endpointReportsModel.count() execution failed. error:', err.message)
            return reject(err)
          }
          return resolve(res)
        })
    })
  }

  run() {
    this.logger.debug('run triggered.')

    mongoose
      .connect(CONNECTION, { useMongoClient: true })
      .then(() => {
        this.logger.info('database connected.')
        this.performFirstRun()
      })
      .catch((err) => {
        this.logger.error('Error establish MongoDB connection. Message:', err.message)
        throw err
      })
  }
}

const app = new App()
app.run()
