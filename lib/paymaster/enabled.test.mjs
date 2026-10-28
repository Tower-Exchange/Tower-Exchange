import test from "node:test";
import assert from "node:assert/strict";

const load = async (value) => {
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_PAYMASTER_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_PAYMASTER_ENABLED = value;
  }

  return (await import(`./enabled.ts?v=${Math.random()}`)).isPaymasterEnabled();
};

test("the Gas Account is on by default", async () => {
  assert.equal(await load(undefined), true);
  assert.equal(await load(""), true);
  assert.equal(await load("true"), true);
});

test("only an explicit false turns it off", async () => {
  assert.equal(await load("false"), false);
  assert.equal(await load(" FALSE "), false);
});
