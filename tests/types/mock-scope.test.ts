import {createMockScope} from "../../build/index.js"

const scope = createMockScope()
const stringTarget = {method(value: string) { return value.toUpperCase() }}
const symbolKey = Symbol("method")
const symbolTarget = {[symbolKey](value: number) { return value + 1 }}

class Constructed {
  value: string

  constructor(value: string) { this.value = value }
}

class StaticConstructed {
  static label = "implementation-only"
  value: string

  constructor(value: string) { this.value = value }
}

const callable = scope.fn((value: string, count: number) => ({value, count}))
const callResult: {value: string, count: number} = callable("value", 1)
void callResult
// @ts-expect-error The supplied implementation's argument types are preserved.
callable(123, 1)
// @ts-expect-error The supplied implementation's result type is preserved.
const invalidCallResult: number = callable("value", 1)

const configured = scope.fn((value: string) => value)
  .mockImplementation((value: string) => value.toUpperCase())
  .mockImplementationOnce((value: string) => value.toLowerCase())
  .mockReturnValue("configured")
const configuredResult: string = configured("value")
void configuredResult
// @ts-expect-error Replacement implementations retain the original call contract.
configured.mockImplementation((value: number) => String(value))
// @ts-expect-error Return helpers retain the original result contract.
configured.mockReturnValue(123)

const asyncMock = scope.fn(async (value: number) => String(value))
  .mockResolvedValueOnce("resolved once")
  .mockResolvedValue("resolved")
// @ts-expect-error Resolve helpers retain the promised result contract.
asyncMock.mockResolvedValue(123)

// @ts-expect-error Resolved helpers cannot replace a typed synchronous return contract with a Promise.
scope.fn((value: string) => value).mockResolvedValue("resolved")
const synchronousOnceMock = scope.fn((value: string) => value)
// @ts-expect-error One-shot resolved helpers cannot replace a typed synchronous return contract with a Promise.
const invalidSynchronousResolvedResult: string = synchronousOnceMock.mockResolvedValueOnce("resolved")("value")

const ConstructorDouble = scope.fn(Constructed)
const constructed: Constructed = new ConstructorDouble("constructed")
void constructed
ConstructorDouble.mockImplementation(Constructed).mockImplementationOnce(Constructed)
// @ts-expect-error The supplied constructor's argument types are preserved.
new ConstructorDouble(123)
// @ts-expect-error The supplied constructor's instance type is preserved.
const invalidConstructed: string = new ConstructorDouble("constructed")

const StaticConstructorDouble = scope.fn(StaticConstructed)
const staticConstructed: StaticConstructed = new StaticConstructorDouble("constructed")
void staticConstructed
// @ts-expect-error Mock wrappers do not copy implementation static properties.
StaticConstructorDouble.label

const implementationWithProperty = Object.assign(
  (value: string) => value.length,
  {label: "implementation-only"}
)
const signatureOnlyMock = scope.fn(implementationWithProperty)
const signatureOnlyResult: number = signatureOnlyMock("value")
void signatureOnlyResult
signatureOnlyMock.mockImplementation((value: string) => value.length)
// @ts-expect-error Mock wrappers do not copy attached implementation properties.
signatureOnlyMock.label

const unconfigured = scope.fn()
unconfigured("callable fallback")
new unconfigured("constructable fallback")
unconfigured.mockImplementation((value: string) => value)
unconfigured.mockResolvedValue("resolved fallback")

const stringSpy = scope.spyOn(stringTarget, "method")
const stringSpyResult: string = stringSpy("value")
void stringSpyResult
stringSpy.mockImplementation((value: string) => value.toLowerCase())
  .mockImplementationOnce((value: string) => value.trim())
  .mockReturnValue("string return")
// @ts-expect-error Property spy arguments retain the selected method contract.
stringSpy(123)
// @ts-expect-error Property spy call results retain the selected method contract.
const invalidStringSpyResult: number = stringSpy("value")
// @ts-expect-error Property spy replacement arguments retain the selected method contract.
stringSpy.mockImplementation((value: number) => value)
// @ts-expect-error Property spy replacement results retain the selected method contract.
stringSpy.mockImplementation((value: string) => value.length)
// @ts-expect-error Property spy return helpers retain the selected method result contract.
stringSpy.mockReturnValue(123)

scope.stub({method() { return "optional" }}, "method")
const stringStub = scope.stub(stringTarget, "method", (value: string) => `stubbed:${value}`)
const stringStubResult: string = stringStub("value")
void stringStubResult
// @ts-expect-error Stub implementations retain the selected method argument and result contract.
scope.stub(stringTarget, "method", (value: number) => value)

const symbolSpy = scope.spyOn(symbolTarget, symbolKey)
const symbolSpyResult: number = symbolSpy(1)
void symbolSpyResult
symbolSpy.mockImplementation((value: number) => value - 1).mockReturnValue(2)
const symbolStub = scope.stub(symbolTarget, symbolKey, (value: number) => value * 2)
const symbolStubResult: number = symbolStub(2)
void symbolStubResult
// @ts-expect-error Symbol-keyed stubs retain the selected method contract.
scope.stub(symbolTarget, symbolKey, (value: string) => value)

// @ts-expect-error Property doubles only accept function-valued property keys.
scope.spyOn({value: 1}, "value")

// @ts-expect-error Runtime and declarations only accept string or symbol keys.
scope.spyOn({1() {}}, 1)
// @ts-expect-error Runtime and declarations only accept string or symbol keys.
scope.stub({1() {}}, 1)
