import {createMockScope} from "../../build/index.js"

const scope = createMockScope()
const stringTarget = {method() { return "string" }}
const symbolKey = Symbol("method")
const symbolTarget = {[symbolKey]() { return "symbol" }}

class Constructed {
  value: string

  constructor(value: string) { this.value = value }
}

const callable = scope.fn((value: string) => value)
callable("value")
const ConstructorDouble = scope.fn(Constructed)
const constructed = new ConstructorDouble("constructed")
void constructed

scope.spyOn(stringTarget, "method")
scope.stub(stringTarget, "method", () => "stubbed")
scope.spyOn(symbolTarget, symbolKey)
scope.stub(symbolTarget, symbolKey, () => "stubbed")

// @ts-expect-error Runtime and declarations only accept string or symbol keys.
scope.spyOn({1() {}}, 1)
// @ts-expect-error Runtime and declarations only accept string or symbol keys.
scope.stub({1() {}}, 1)
