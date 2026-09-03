import {createMockScope} from "../../build/index.js"

const scope = createMockScope()
const stringTarget = {method() { return "string" }}
const symbolKey = Symbol("method")
const symbolTarget = {[symbolKey]() { return "symbol" }}

class Constructed {
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
  .mockResolvedValue("resolved")
// @ts-expect-error Resolve helpers retain the promised result contract.
asyncMock.mockResolvedValue(123)

const ConstructorDouble = scope.fn(Constructed)
const constructed: Constructed = new ConstructorDouble("constructed")
void constructed
ConstructorDouble.mockImplementation(Constructed).mockImplementationOnce(Constructed)
// @ts-expect-error The supplied constructor's argument types are preserved.
new ConstructorDouble(123)
// @ts-expect-error The supplied constructor's instance type is preserved.
const invalidConstructed: string = new ConstructorDouble("constructed")

const unconfigured = scope.fn()
unconfigured("callable fallback")
new unconfigured("constructable fallback")
unconfigured.mockImplementation((value: string) => value)

scope.spyOn(stringTarget, "method")
scope.stub({method() { return "optional" }}, "method")
scope.stub(stringTarget, "method", () => "stubbed")
scope.spyOn(symbolTarget, symbolKey)
scope.stub(symbolTarget, symbolKey, () => "stubbed")

// @ts-expect-error Runtime and declarations only accept string or symbol keys.
scope.spyOn({1() {}}, 1)
// @ts-expect-error Runtime and declarations only accept string or symbol keys.
scope.stub({1() {}}, 1)
