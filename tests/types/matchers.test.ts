import {
  any as anyValue,
  anything,
  arrayContaining,
  expect,
  isArrayContaining,
  isObjectContaining,
  matchArrayContaining,
  matchObject,
  objectContaining,
  stringContaining,
  stringMatching,
  type AsymmetricMatcher,
  type CustomMatcher,
  type CustomMatcherContext,
  type CustomMatcherDefinitions,
  type CustomMatcherResult
} from "@velocious/testing"

declare module "@velocious/testing" {
  interface Expect {
    toBeDivisibleBy(divisor: number): void | Promise<void>
  }

  interface PromiseExpectation {
    toBeDivisibleBy(divisor: number): Promise<void>
  }
}

const asymmetricValues: AsymmetricMatcher[] = [
  anything(),
  anyValue(Number),
  arrayContaining([1]),
  objectContaining({id: 1}),
  stringContaining("value"),
  stringMatching(/value/u),
  expect.anything(),
  expect.any(Number),
  expect.stringContaining("value"),
  expect.stringMatching("value")
]
void asymmetricValues

const arrayMatcher = arrayContaining([1])
const objectMatcher = objectContaining({id: 1})
const arrayMatcherCheck: boolean = isArrayContaining(arrayMatcher)
const objectMatcherCheck: boolean = isObjectContaining(objectMatcher)
const arrayMatchResult = matchArrayContaining([{id: 1}], [objectMatcher])
const objectMatchResult = matchObject({id: 1, name: "Ada"}, {id: 1})
const arrayMatches: boolean = arrayMatchResult.matches
const objectDifferences: Record<string, [any, any]> = objectMatchResult.differences
void arrayMatcherCheck
void objectMatcherCheck
void arrayMatches
void objectDifferences

// @ts-expect-error matchArrayContaining() requires an expected array.
matchArrayContaining([], {id: 1})
// @ts-expect-error matchObject() requires an expected object or array.
matchObject({}, 1)

// @ts-expect-error any() requires a constructor function.
anyValue(null)
// @ts-expect-error stringContaining() accepts only strings.
stringContaining(1)
// @ts-expect-error stringMatching() accepts only strings or regular expressions.
stringMatching({})

const contextConsumer = (context: CustomMatcherContext): string => context.format(1)
void contextConsumer
const explicitResult: CustomMatcherResult = {pass: true, message: "unused"}
void explicitResult
const explicitMatcher: CustomMatcher = function (received, expected) {
  return {pass: this.equals(received, expected), message: this.diff(received, expected)}
}
void explicitMatcher

const structuralThenable: PromiseLike<CustomMatcherResult> = {
  then(onfulfilled, onrejected) {
    return Promise.resolve(explicitResult).then(onfulfilled, onrejected)
  }
}
const promiseLikeMatcher: CustomMatcher = function () { return structuralThenable }
void promiseLikeMatcher

const customDefinitions: CustomMatcherDefinitions = {
  toBeDivisibleBy(received, divisor) {
    return {
      pass: typeof received === "number" && received % divisor === 0,
      message: `Expected ${this.format(received)} ${this.isNot ? "not " : ""}to be divisible by ${divisor}`
    }
  }
}
expect.extend(customDefinitions)

const synchronousCustomResult: void | Promise<void> = expect(6).toBeDivisibleBy(3)
const asynchronousCustomResult: Promise<void> = expect(Promise.resolve(6)).resolves.toBeDivisibleBy(3)
void synchronousCustomResult
void asynchronousCustomResult
// @ts-expect-error Custom matcher augmentation preserves argument types.
expect(6).toBeDivisibleBy("3")
// @ts-expect-error Promise custom matcher augmentation preserves argument types.
expect(Promise.resolve(6)).resolves.toBeDivisibleBy("3")

const resolvedResult: Promise<void> = expect(Promise.resolve({id: 1})).resolves.toEqual({id: 1})
const rejectedResult: Promise<void> = expect(Promise.reject(new Error("failure"))).rejects.toThrow(Error)
void resolvedResult
void rejectedResult

// @ts-expect-error Custom matcher pass must be boolean.
const invalidDefinitions: CustomMatcherDefinitions = {invalid() { return {pass: "yes", message: "unused"} }}
void invalidDefinitions
