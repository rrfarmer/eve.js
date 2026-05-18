'use strict';

const PATCH_PLAN = __PATCH_PLAN__;

function emit(payload) {
  send(payload);
}

function normalizeArch(arch) {
  if (arch === 'x64') {
    return 'x86_64';
  }
  return arch;
}

function hexToBytes(hex) {
  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  const out = [];
  for (let index = 0; index < bytes.length; index += 1) {
    out.push(bytes[index].toString(16).padStart(2, '0'));
  }
  return out.join('');
}

function readBytes(address, length) {
  const data = address.readByteArray(length);
  if (data === null) {
    return [];
  }

  return Array.from(new Uint8Array(data));
}

function findTargetModule(name) {
  const suffix = '/' + name;
  const modules = Process.enumerateModules();
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index];
    if (module.name === name || module.path.endsWith(suffix)) {
      return module;
    }
  }
  return null;
}

function applyPatch(module, patch) {
  const beforeHex = patch.beforeHex.toLowerCase();
  const afterHex = patch.afterHex.toLowerCase();
  const afterBytes = hexToBytes(afterHex);
  const target = module.base.add(patch.rva);
  const currentHex = bytesToHex(readBytes(target, afterBytes.length));

  if (currentHex === afterHex) {
    return {
      status: 'already-patched',
      address: target.toString(),
      currentHex: currentHex,
    };
  }

  if (currentHex !== beforeHex && !patch.allowMismatchedBefore) {
    throw new Error(
      `Unexpected bytes at ${patch.offsetHex} (${patch.rvaHex}). Expected ${beforeHex}, got ${currentHex}`
    );
  }

  Memory.patchCode(target, afterBytes.length, function (code) {
    code.writeByteArray(afterBytes);
  });

  const verifyHex = bytesToHex(readBytes(target, afterBytes.length));
  if (verifyHex !== afterHex) {
    throw new Error(
      `Verification failed at ${patch.offsetHex} (${patch.rvaHex}). Expected ${afterHex}, got ${verifyHex}`
    );
  }

  return {
    status: currentHex === beforeHex ? 'patched' : 'patched-relaxed',
    address: target.toString(),
    currentHex: currentHex,
    verifyHex: verifyHex,
  };
}

function tryApplyWhenReady(startTimeMs) {
  const module = findTargetModule(PATCH_PLAN.moduleName);
  if (module === null) {
    if (Date.now() - startTimeMs >= PATCH_PLAN.moduleWaitMs) {
      emit({
        type: 'patch-error',
        message: `Timed out waiting for module ${PATCH_PLAN.moduleName}`,
      });
      return true;
    }
    return false;
  }

  const arch = normalizeArch(Process.arch);
  const patches = PATCH_PLAN.patches.filter(function (patch) {
    return patch.arch === arch;
  });

  if (patches.length === 0) {
    emit({
      type: 'patch-error',
      message: `No runtime blue.so patches are recorded for arch ${arch}`,
      arch: arch,
    });
    return true;
  }

  try {
    const results = patches.map(function (patch) {
      const result = applyPatch(module, patch);
      result.arch = arch;
      result.description = patch.description;
      result.offsetHex = patch.offsetHex;
      result.rvaHex = patch.rvaHex;
      return result;
    });

    emit({
      type: 'patch-complete',
      processArch: arch,
      moduleName: module.name,
      modulePath: module.path,
      moduleBase: module.base.toString(),
      results: results,
    });
  } catch (error) {
    emit({
      type: 'patch-error',
      message: String(error),
      processArch: arch,
      moduleName: module.name,
      moduleBase: module.base.toString(),
    });
  }

  return true;
}

emit({
  type: 'patch-waiting',
  processName: PATCH_PLAN.processName,
  moduleName: PATCH_PLAN.moduleName,
});

const startTimeMs = Date.now();
if (!tryApplyWhenReady(startTimeMs)) {
  const timer = setInterval(function () {
    if (tryApplyWhenReady(startTimeMs)) {
      clearInterval(timer);
    }
  }, PATCH_PLAN.pollIntervalMs);
}
