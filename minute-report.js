const App = require('./lib/app')

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled rejection. Reason:', reason)
})

// -- Execution

const app = new App()
app.runMinuteReport()
