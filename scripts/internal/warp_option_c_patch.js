'use strict';

const PATCH_PROFILE = 'option-c-v4';

const PATCH_RVAS = Object.freeze({
  suppressLatchD2: 0x4309b,
  suppressLatch478: 0x430a2,
  suppressResetToStopCall: 0x430af,
  suppressWarpDistancePoison: 0x35740,
  suppressTickLoopPoisonFollowup: 0x3574d,
  suppressHigherLevelResetCall: 0x4526a
});

const state = {
  waitingSent: false,
  patched: false
};

function sendEvent(payload) {
  send(payload);
}

function nopInstruction(address) {
  const instruction = Instruction.parse(address);
  Memory.patchCode(address, instruction.size, code => {
    const writer = new X86Writer(code, { pc: address });
    for (let index = 0; index < instruction.size; index += 1) {
      writer.putNop();
    }
    writer.flush();
  });
  return {
    address: address.toString(),
    size: instruction.size,
    mnemonic: instruction.mnemonic,
    opStr: instruction.opStr
  };
}

function tryApplyPatch() {
  if (state.patched) {
    return true;
  }

  const module = Process.findModuleByName('_destiny.dll');
  if (!module) {
    if (!state.waitingSent) {
      state.waitingSent = true;
      sendEvent({
        type: 'status',
        message: 'waiting-for-_destiny.dll',
        patchProfile: PATCH_PROFILE
      });
    }
    return false;
  }

  const base = module.base;
  const patches = [];
  for (const [name, rva] of Object.entries(PATCH_RVAS)) {
    const address = base.add(rva);
    patches.push({
      name,
      rva: `0x${rva.toString(16)}`,
      ...nopInstruction(address)
    });
  }

  state.patched = true;
  sendEvent({
    type: 'status',
    message: 'option-c-patch-applied',
    patchProfile: PATCH_PROFILE,
    moduleBase: base.toString(),
    modulePath: module.path,
    patches
  });
  return true;
}

const timer = setInterval(() => {
  if (tryApplyPatch()) {
    clearInterval(timer);
  }
}, 250);

setImmediate(() => {
  tryApplyPatch();
});
