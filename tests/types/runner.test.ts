import {createTestContext} from "../../build/index.js"
import {runNodeTests} from "../../build/node/index.js"
import {
  TestRunner,
  runTests,
  type SuiteHookExecutor,
  type SuiteHookExecutorInput,
  type TestRunnerOptions
} from "../../build/runner.js"

const suiteHookExecutor: SuiteHookExecutor = async (input: SuiteHookExecutorInput) => {
  const phase: "beforeAll" | "afterAll" = input.phase
  const timeoutMs: number = input.timeoutMs
  const fullName: string = input.fullName

  input.context
  input.suite
  input.hook.callback
  await input.defaultExecute()
  await input.defaultExecute([{configuration: true}])

  void phase
  void timeoutMs
  void fullName

  // @ts-expect-error Suite hook arguments must be supplied as an array.
  await input.defaultExecute({configuration: true})
}

const context = createTestContext()
const options: TestRunnerOptions = {context, suiteHookExecutor}
const runner = new TestRunner(options)
const runResult = runTests(options)
const nodeResult = runNodeTests({context, importer: async () => {}, suiteHookExecutor})

void runner
void runResult
void nodeResult

// @ts-expect-error The executor phase is supplied by the runner.
const invalidInput: SuiteHookExecutorInput = {phase: "beforeEach"}
void invalidInput
