import {
  createFakeTimers,
  type FakeTimerOptions,
  type FakeTimers,
  type FakeTimerTarget
} from "../../build/index.js"

const options: FakeTimerOptions = {now: new Date(0)}
const timers: FakeTimers = createFakeTimers(options)
const target: FakeTimerTarget = {
  Date,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
}

timers.install(target)
const now: number = timers.now
const count: number = timers.timerCount
timers.advanceBy(10)
timers.runPending()
timers.setSystemTime(20)
timers.setSystemTime(new Date(30))
timers.restore()
void now
void count

// @ts-expect-error Current fake wall time is readonly.
timers.now = 10
// @ts-expect-error Pending timer count is readonly.
timers.timerCount = 0
// @ts-expect-error Initial wall time is numeric or a Date.
createFakeTimers({now: "tomorrow"})
// @ts-expect-error Time advancement is numeric.
timers.advanceBy("10")
// @ts-expect-error System time is numeric or a Date.
timers.setSystemTime("later")
// @ts-expect-error An install target must provide every supported timer global.
timers.install({Date, setTimeout, clearTimeout})
