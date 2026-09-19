const assert = require("assert");
const { STATES, createFlow, createMockTransport } = require("../comdirect-test-flow.js");

(async () => {
  const flow = createFlow(createMockTransport());
  assert.strictEqual(flow.snapshot().state, STATES.IDLE);
  let state = await flow.start({ client_id:"c", client_secret:"s", access_number:"a", pin:"p" });
  assert.strictEqual(state.state, STATES.AWAITING_2FA);
  assert.strictEqual(state.challenge.type, "P_TAN_PUSH");
  assert.strictEqual(state.diagnostic, null);
  state = await flow.confirm({});
  assert.strictEqual(state.state, STATES.COMPLETE);
  assert.strictEqual(state.challenge, null);
  assert.deepStrictEqual(state.diagnostic, { ok:true, stage:"accounts", account_count:2, transaction_count:null,
    session_terminated:true, credentials_retained:false, transactions_imported:0, error_code:null });

  const missing = createFlow(createMockTransport());
  state = await missing.start({});
  assert.strictEqual(state.state, STATES.FAILED);
  assert.strictEqual(state.diagnostic.error_code, "missing_credentials");

  const unsafe = createFlow({
    async start(){ return {status:"awaiting_2fa",challenge_id:"x"}; },
    async confirm(){ return {status:"complete",diagnostic:{ok:true,credentials_retained:true,transactions_imported:0}}; }
  });
  await unsafe.start({client_id:"c"});
  state = await unsafe.confirm({});
  assert.strictEqual(state.state, STATES.FAILED);
  assert.strictEqual(state.diagnostic.error_code, "unsafe_diagnostic_response");

  const serialized = JSON.stringify(flow.snapshot());
  for (const secret of ["c","s","a","p"]) assert.ok(!serialized.includes('"'+secret+'"'));
  console.log("comdirect interactive mock flow tests passed");
})().catch((error)=>{console.error(error);process.exit(1)});
