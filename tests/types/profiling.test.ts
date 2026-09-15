import {validateTestActivityName, type TestActivityName} from "../../build/profiling.js"

const activity: TestActivityName = validateTestActivityName("cache-warmup")
void activity

// @ts-expect-error Activity names are validated strings, not numbers.
validateTestActivityName(42)
