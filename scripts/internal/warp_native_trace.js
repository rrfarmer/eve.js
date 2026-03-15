'use strict';

const config = __TRACE_CONFIG__;
const TRACE_PROFILE = 'activation-gate-flags-v1';

const OFFSETS = {
  entityId: 0x18,
  posX: 0x28,
  posY: 0x30,
  posZ: 0x38,
  effectLike88: 0x88,
  stopDistance: 0x90,
  warpFactor: 0x98,
  maxVelocity: 0x100,
  warpDistance: 0x110,
  motionX: 0x178,
  motionY: 0x180,
  motionZ: 0x188,
  gotoX: 0x1a8,
  gotoY: 0x1b0,
  gotoZ: 0x1b8,
  mode: 0x238,
  latchD2: 0xd2,
  latch478: 0x478,
  tick: 0x1c
};

const GLOBALS = {
  activationGateFlagPrimary: 0xd42d1,
  activationGateFlagSecondary: 0xd42d3
};

const SITES = {
  motionHelper36700: 0x36700,
  motionHelper3e980: 0x3e980,
  activationGateEnter: 0x36a20,
  activationGateCompareEnter: 0x36b10,
  activationGateBranchGt: 0x36b9d,
  activationGateBranchLe: 0x37195,
  activationGateReturn: 0x3724e,
  mode3HelperEnter: 0x372e0,
  mode3Tail38870: 0x38870,
  countdownHelperEnter: 0x374ed,
  countdownWrite88: 0x375dd,
  tickForceWarpDistanceMinusOne: 0x35740,
  warpToWriteMinusOne: 0x427e1,
  warpInitWrite88: 0x42960,
  warpInitWrite110: 0x42982,
  warpSolverEnter: 0x42b20,
  warpSolverFailureLatch: 0x4309b,
  richWarpWrite88: 0x43273
};

const state = {
  moduleBase: null,
  hooksInstalled: false,
  postWarpHooksInstalled: false,
  waitingSent: false,
  egoBall: null,
  egoEntityId: null,
  coeffMonitorInstalled: false,
  warpSequence: 0,
  perWarpCounts: {}
};

const PROFILE_FLAGS = {
  mode3OnlyLite: TRACE_PROFILE === 'mode3-helper-lite-v1' || TRACE_PROFILE === 'activation-gate-lite-v1'
};

function sendEvent(payload) {
  send(payload);
}

function hexPtr(value) {
  if (value === null || value === undefined) return null;
  try {
    return ptr(value).toString();
  } catch (_) {
    return null;
  }
}

function classifySolverCaller(retAddress) {
  try {
    const ret = ptr(retAddress);
    const rva = ret.sub(state.moduleBase).toInt32();
    if (rva === 0x357d1) return 'tick-loop';
    if (rva === 0x0ae96) return 'secondary-ae91';
    return `ret-${ret.toString()}`;
  } catch (_) {
    return 'unknown';
  }
}

function safeRead(ball, offset, fn, fallback = null) {
  try {
    return fn(ball.add(offset));
  } catch (_) {
    return fallback;
  }
}

function readU8(ball, offset) {
  return safeRead(ball, offset, p => p.readU8());
}

function readS32(ball, offset) {
  return safeRead(ball, offset, p => p.readS32());
}

function readU64String(ball, offset) {
  return safeRead(ball, offset, p => p.readU64().toString(), null);
}

function readDouble(ball, offset) {
  return safeRead(ball, offset, p => p.readDouble());
}

function readDoubleAt(address) {
  try {
    return ptr(address).readDouble();
  } catch (_) {
    return null;
  }
}

function readFloat(ball, offset) {
  return safeRead(ball, offset, p => p.readFloat());
}

function readVec3(ball, xOff, yOff, zOff) {
  return {
    x: readDouble(ball, xOff),
    y: readDouble(ball, yOff),
    z: readDouble(ball, zOff)
  };
}

function vecDistance(a, b) {
  if (!a || !b) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  if (![dx, dy, dz].every(Number.isFinite)) return null;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function vecMagnitude(vec) {
  if (!vec) return null;
  const { x, y, z } = vec;
  if (![x, y, z].every(Number.isFinite)) return null;
  return Math.sqrt(x * x + y * y + z * z);
}

function readTick(ballpark) {
  if (ballpark === null || ballpark === undefined) return null;
  try {
    return ptr(ballpark).add(OFFSETS.tick).readS32();
  } catch (_) {
    return null;
  }
}

function readDoubleAt(address) {
  try {
    return ptr(address).readDouble();
  } catch (_) {
    return null;
  }
}

function readU8At(address) {
  try {
    return ptr(address).readU8();
  } catch (_) {
    return null;
  }
}

function readPointer(address) {
  try {
    return ptr(address).readPointer();
  } catch (_) {
    return null;
  }
}

function ballSnapshot(ball, ballpark) {
  return {
    ball: hexPtr(ball),
    entityId: readU64String(ball, OFFSETS.entityId),
    mode: readS32(ball, OFFSETS.mode),
    value88: readS32(ball, OFFSETS.effectLike88),
    maxVelocity: readFloat(ball, 0xe0),
    inertia: readFloat(ball, 0xe4),
    speedFraction: readFloat(ball, 0xf4),
    mass100: readDouble(ball, 0x100),
    value108: readDouble(ball, 0x108),
    warpDistance: readDouble(ball, OFFSETS.warpDistance),
    stopDistance: readDouble(ball, OFFSETS.stopDistance),
    warpFactor: readU64String(ball, OFFSETS.warpFactor),
    d2: readU8(ball, OFFSETS.latchD2),
    value478: readU8(ball, OFFSETS.latch478),
    position: readVec3(ball, OFFSETS.posX, OFFSETS.posY, OFFSETS.posZ),
    motion: readVec3(ball, OFFSETS.motionX, OFFSETS.motionY, OFFSETS.motionZ),
    target: readVec3(ball, OFFSETS.gotoX, OFFSETS.gotoY, OFFSETS.gotoZ),
    coeffA: readVec3(ball, 0x1e8, 0x1f0, 0x1f8),
    coeffB: readVec3(ball, 0x200, 0x208, 0x210),
    tick: readTick(ballpark)
  };
}

function buildActivationGateMetrics(snapshot, source48) {
  const thresholdConstant = 0.01;
  const source = Number(source48);
  const maxVelocity = Number(snapshot.maxVelocity);
  const inertia = Number(snapshot.inertia);
  const speedFraction = Number(snapshot.speedFraction);
  const mass100 = Number(snapshot.mass100);
  const validRatio = [source, maxVelocity, inertia, speedFraction, mass100].every(Number.isFinite) &&
    inertia !== 0 &&
    mass100 !== 0;
  const activationRatio = validRatio
    ? (source * speedFraction * maxVelocity) / (mass100 * inertia)
    : null;

  return {
    source48,
    thresholdConstant,
    activationRatio,
    activationThreshold: activationRatio !== null ? activationRatio * thresholdConstant : null,
    preResetCoeffMagnitude: vecMagnitude(snapshot.coeffA),
    motionMagnitude: vecMagnitude(snapshot.motion)
  };
}

function resetPerWarpCounts() {
  state.perWarpCounts = {};
}

function shouldEmitForWarp(site, limit) {
  const current = state.perWarpCounts[site] || 0;
  if (current >= limit) return false;
  state.perWarpCounts[site] = current + 1;
  return true;
}

function isActiveWarpTrace() {
  return state.warpSequence > 0 && state.egoBall !== null;
}

function sameBall(ball) {
  try {
    return state.egoBall !== null && ptr(ball).equals(state.egoBall);
  } catch (_) {
    return false;
  }
}

function looksLikeBall(ball) {
  if (ball === null || ball === undefined) return false;
  const entityIdText = readU64String(ball, OFFSETS.entityId);
  const mode = readS32(ball, OFFSETS.mode);
  const x = readDouble(ball, OFFSETS.posX);
  const y = readDouble(ball, OFFSETS.posY);
  const z = readDouble(ball, OFFSETS.posZ);

  if (entityIdText === null) return false;
  const entityId = Number(entityIdText);
  if (!Number.isFinite(entityId) || entityId < 100000 || entityId > 9e15) return false;
  if (!Number.isInteger(mode) || mode < 0 || mode > 12) return false;
  if (![x, y, z].every(Number.isFinite)) return false;
  return true;
}

function shouldClaimEntity(entityId) {
  if (config.shipId === null || config.shipId === undefined) return true;
  return String(config.shipId) === String(entityId);
}

function claimEgoBall(ball, reason, ballpark) {
  if (ball === null || ball === undefined) return false;
  if (!looksLikeBall(ball)) return false;
  const entityId = readU64String(ball, OFFSETS.entityId);
  if (!shouldClaimEntity(entityId)) return false;

  state.egoBall = ptr(ball);
  state.egoEntityId = entityId;
  installCoeffMonitor(ptr(ball));

  sendEvent({
    type: 'ego-ball-claimed',
    reason,
    warpSequence: state.warpSequence,
    snapshot: ballSnapshot(ptr(ball), ballpark)
  });
  return true;
}

function installCoeffMonitor(ball) {
  if (state.coeffMonitorInstalled) return;
  if (ball === null || ball === undefined) return;
  try {
    const base = ptr(ball).add(0x1e8);
    MemoryAccessMonitor.enable([{ base, size: 0x30 }], {
      onAccess(details) {
        if (details.operation !== 'write') return;
        if (!sameBall(ball)) return;
        if (!shouldEmitForWarp('coeff-write', 8)) return;
        sendEvent({
          type: 'write',
          site: 'coeff-write',
          address: hexPtr(details.from),
          field: 'coeff-block',
          oldValue: null,
          newValue: null,
          warpSequence: state.warpSequence,
          snapshot: ballSnapshot(ptr(ball), null),
          extra: {
            operation: details.operation,
            from: hexPtr(details.from),
            address: hexPtr(details.address),
            rangeIndex: details.rangeIndex,
            pageIndex: details.pageIndex,
            pagesCompleted: details.pagesCompleted,
            pagesTotal: details.pagesTotal
          }
        });
      }
    });
    state.coeffMonitorInstalled = true;
  } catch (_) {
    // Best-effort tracing only.
  }
}

function ensureInterestingBall(ball, reason, ballpark) {
  if (ball === null || ball === undefined) return false;
  if (sameBall(ball)) return true;
  if (state.egoBall !== null) return false;
  return claimEgoBall(ball, reason, ballpark);
}

function writeEvent(site, context, ball, ballpark, field, oldValue, newValue, extra) {
  if (!sameBall(ball) && !ensureInterestingBall(ball, site, ballpark)) return;
  sendEvent({
    type: 'write',
    site,
    address: hexPtr(context.pc),
    field,
    oldValue,
    newValue,
    warpSequence: state.warpSequence,
    snapshot: ballSnapshot(ptr(ball), ballpark),
    extra: extra || null
  });
}

function selectBallCandidate(candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (sameBall(candidate)) return ptr(candidate);
  }
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (looksLikeBall(candidate)) return ptr(candidate);
  }
  return null;
}

function functionEvent(kind, site, context, ball, ballpark, extra) {
  if (!sameBall(ball) && !ensureInterestingBall(ball, site, ballpark)) return;
  sendEvent({
    type: kind,
    site,
    address: hexPtr(context.pc),
    warpSequence: state.warpSequence,
    snapshot: ballSnapshot(ptr(ball), ballpark),
    extra: extra || null
  });
}

function installPostWarpHooks(at) {
  if (state.postWarpHooksInstalled) return;
  state.postWarpHooksInstalled = true;

  if (
    TRACE_PROFILE === 'activation-gate-lite-v1' ||
    TRACE_PROFILE === 'activation-gate-lite-v2' ||
    TRACE_PROFILE === 'activation-gate-compare-v1' ||
    TRACE_PROFILE === 'activation-gate-flags-v1'
  ) {
    Interceptor.attach(at(SITES.activationGateEnter), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rbx,
          this.context.rdi,
          this.context.rdx,
          this.context.rcx,
          this.context.rsi,
          this.context.r8
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-enter', 3)) return;
        this._ball = ball;
        this._ballpark = ptr(this.context.rbp);
        const snapshot = ballSnapshot(ball, this._ballpark);
        const source48 = readDoubleAt(ptr(this.context.rcx).add(0x48));
        functionEvent('enter', 'activation-gate-enter', this.context, ball, this._ballpark, {
          rcx: hexPtr(this.context.rcx),
          rdx: hexPtr(this.context.rdx),
          rbx: hexPtr(this.context.rbx),
          rbp: hexPtr(this.context.rbp),
          rsi: hexPtr(this.context.rsi),
          rdi: hexPtr(this.context.rdi),
          r8: hexPtr(this.context.r8),
          gateFlagPrimary: readU8At(state.moduleBase.add(GLOBALS.activationGateFlagPrimary)),
          gateFlagSecondary: readU8At(state.moduleBase.add(GLOBALS.activationGateFlagSecondary)),
          ...buildActivationGateMetrics(snapshot, source48)
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateBranchGt), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-branch-gt', 1)) return;
        functionEvent('enter', 'activation-gate-branch-gt', this.context, ball, ptr(this.context.rbp), {
          branch: 'gt-threshold'
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateBranchLe), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-branch-le', 1)) return;
        functionEvent('enter', 'activation-gate-branch-le', this.context, ball, ptr(this.context.rbp), {
          branch: 'le-threshold'
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateCompareEnter), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-compare-enter', 1)) return;
        functionEvent('enter', 'activation-gate-compare-enter', this.context, ball, ptr(this.context.rbp), {
          phase: 'compare-block'
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateReturn), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-return', 1)) return;
        functionEvent('enter', 'activation-gate-return', this.context, ball, ptr(this.context.rbp), {
          phase: 'return-tail'
        });
      }
    });
  }

  Interceptor.attach(at(SITES.countdownWrite88), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rbp);
      if (!shouldEmitForWarp('countdown-write-88', 2)) return;
      writeEvent('countdown-write-88', this.context, ball, ballpark, '+0x88', readS32(ball, OFFSETS.effectLike88), ptr(this.context.rax).toInt32(), null);
    }
  });

  if (TRACE_PROFILE !== 'activation-gate-compare-v1' && TRACE_PROFILE !== 'activation-gate-flags-v1') {
    Interceptor.attach(at(SITES.mode3HelperEnter), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rbx,
          this.context.rdi,
          this.context.rdx,
          this.context.rcx,
          this.context.rsi,
          this.context.r8
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('mode3-helper-enter', 4)) return;
        this._traceMode3 = true;
        this._ball = ball;
        this._ballpark = ptr(this.context.rbp);
        const callerReturn = readPointer(ptr(this.context.rsp));
        functionEvent('enter', 'mode3-helper-enter', this.context, ball, this._ballpark, {
          callerReturn: hexPtr(callerReturn),
          rcx: hexPtr(this.context.rcx),
          rdx: hexPtr(this.context.rdx),
          rbx: hexPtr(this.context.rbx),
          rbp: hexPtr(this.context.rbp),
          rsi: hexPtr(this.context.rsi),
          rdi: hexPtr(this.context.rdi)
        });
      },
      onLeave() {
        if (!this._traceMode3) return;
        functionEvent('leave', 'mode3-helper-leave', this.context, this._ball, this._ballpark, null);
      }
    });
  }

  Interceptor.attach(at(SITES.warpInitWrite88), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rdi);
      if (!shouldEmitForWarp('warp-init-write-88', 1)) return;
      writeEvent('warp-init-write-88', this.context, ball, ballpark, '+0x88', readS32(ball, OFFSETS.effectLike88), ptr(this.context.rax).toInt32(), null);
    }
  });

  Interceptor.attach(at(SITES.warpInitWrite110), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rdi);
      if (!shouldEmitForWarp('warp-init-write-110', 1)) return;
      const snapshot = ballSnapshot(ball, ballpark);
      writeEvent(
        'warp-init-write-110',
        this.context,
        ball,
        ballpark,
        '+0x110',
        snapshot.warpDistance,
        vecDistance(snapshot.position, snapshot.target),
        null
      );
    }
  });
}

function installHooks() {
  if (state.hooksInstalled) return;

  const module = Process.findModuleByName('_destiny.dll');
  if (module === null) {
    if (!state.waitingSent) {
      state.waitingSent = true;
      sendEvent({ type: 'status', message: 'waiting-for-_destiny.dll' });
    }
    return;
  }

  state.moduleBase = module.base;
  state.hooksInstalled = true;

  function at(offset) {
    return module.base.add(offset);
  }

  sendEvent({
    type: 'status',
    message: 'hooks-installed',
    traceProfile: TRACE_PROFILE,
    moduleBase: module.base.toString(),
    modulePath: module.path
  });

  Interceptor.attach(at(SITES.warpToWriteMinusOne), {
    onEnter() {
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rdi);
      if (sameBall(ball) || ensureInterestingBall(ball, 'warp-to-write-minus-one', ballpark)) {
        state.warpSequence += 1;
        resetPerWarpCounts();
        installPostWarpHooks(at);
      }
      writeEvent('warp-to-write-minus-one', this.context, ball, ballpark, '+0x88', readS32(ball, OFFSETS.effectLike88), -1, null);
    }
  });

  return;

  if (TRACE_PROFILE === 'activation-gate-lite-v1') {
    Interceptor.attach(at(SITES.activationGateEnter), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rbx,
          this.context.rdi,
          this.context.rdx,
          this.context.rcx,
          this.context.rsi,
          this.context.r8
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-enter', 3)) return;
        this._traceActivationGate = true;
        this._ball = ball;
        this._ballpark = ptr(this.context.rbp);
        const snapshot = ballSnapshot(ball, this._ballpark);
        const source48 = readDoubleAt(ptr(this.context.rcx).add(0x48));
        functionEvent('enter', 'activation-gate-enter', this.context, ball, this._ballpark, {
          rcx: hexPtr(this.context.rcx),
          rdx: hexPtr(this.context.rdx),
          rbx: hexPtr(this.context.rbx),
          rbp: hexPtr(this.context.rbp),
          rsi: hexPtr(this.context.rsi),
          rdi: hexPtr(this.context.rdi),
          r8: hexPtr(this.context.r8),
          ...buildActivationGateMetrics(snapshot, source48)
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateBranchGt), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-branch-gt', 1)) return;
        functionEvent('enter', 'activation-gate-branch-gt', this.context, ball, ptr(this.context.rbp), {
          branch: 'gt-threshold'
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateBranchLe), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-branch-le', 1)) return;
        functionEvent('enter', 'activation-gate-branch-le', this.context, ball, ptr(this.context.rbp), {
          branch: 'le-threshold'
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateCompareEnter), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-compare-enter', 1)) return;
        functionEvent('enter', 'activation-gate-compare-enter', this.context, ball, ptr(this.context.rbp), {
          phase: 'compare-block'
        });
      }
    });

    Interceptor.attach(at(SITES.activationGateReturn), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rdi,
          this.context.rbx,
          this.context.rdx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('activation-gate-return', 1)) return;
        functionEvent('enter', 'activation-gate-return', this.context, ball, ptr(this.context.rbp), {
          phase: 'return-tail'
        });
      }
    });
  }

  Interceptor.attach(at(SITES.countdownWrite88), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rbp);
      if (!shouldEmitForWarp('countdown-write-88', 2)) return;
      writeEvent('countdown-write-88', this.context, ball, ballpark, '+0x88', readS32(ball, OFFSETS.effectLike88), ptr(this.context.rax).toInt32(), null);
    }
  });

  if (!PROFILE_FLAGS.mode3OnlyLite) {
    Interceptor.attach(at(SITES.countdownHelperEnter), {
      onEnter() {
        if (!isActiveWarpTrace()) return;
        const ball = selectBallCandidate([
          this.context.rbx,
          this.context.rdx,
          this.context.rcx,
          this.context.rsi
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp('countdown-helper-enter', 3)) return;
        this._traceCountdown = true;
        this._ball = ball;
        this._ballpark = ptr(this.context.rbp);
        functionEvent('enter', 'countdown-helper-enter', this.context, ball, this._ballpark, {
          rcx: hexPtr(this.context.rcx),
          rdx: hexPtr(this.context.rdx),
          rbx: hexPtr(this.context.rbx),
          rbp: hexPtr(this.context.rbp),
          rsi: hexPtr(this.context.rsi),
          rdi: hexPtr(this.context.rdi)
        });
      },
      onLeave() {
        if (!this._traceCountdown) return;
        functionEvent('leave', 'countdown-helper-leave', this.context, this._ball, this._ballpark, null);
      }
    });
  }

  Interceptor.attach(at(SITES.mode3HelperEnter), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = selectBallCandidate([
        this.context.rbx,
        this.context.rdi,
        this.context.rdx,
        this.context.rcx,
        this.context.rsi,
        this.context.r8
      ]);
      if (ball === null) return;
      if (!shouldEmitForWarp('mode3-helper-enter', 4)) return;
      this._traceMode3 = true;
      this._ball = ball;
      this._ballpark = ptr(this.context.rbp);
      const callerReturn = readPointer(ptr(this.context.rsp));
      functionEvent('enter', 'mode3-helper-enter', this.context, ball, this._ballpark, {
        callerReturn: hexPtr(callerReturn),
        rcx: hexPtr(this.context.rcx),
        rdx: hexPtr(this.context.rdx),
        rbx: hexPtr(this.context.rbx),
        rbp: hexPtr(this.context.rbp),
        rsi: hexPtr(this.context.rsi),
        rdi: hexPtr(this.context.rdi)
      });
    },
    onLeave() {
      if (!this._traceMode3) return;
      functionEvent('leave', 'mode3-helper-leave', this.context, this._ball, this._ballpark, null);
    }
  });

  Interceptor.attach(at(SITES.warpInitWrite88), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rdi);
      if (!shouldEmitForWarp('warp-init-write-88', 1)) return;
      writeEvent('warp-init-write-88', this.context, ball, ballpark, '+0x88', readS32(ball, OFFSETS.effectLike88), ptr(this.context.rax).toInt32(), null);
    }
  });

  Interceptor.attach(at(SITES.warpInitWrite110), {
    onEnter() {
      if (!isActiveWarpTrace()) return;
      const ball = ptr(this.context.rbx);
      const ballpark = ptr(this.context.rdi);
      if (!shouldEmitForWarp('warp-init-write-110', 1)) return;
      const snapshot = ballSnapshot(ball, ballpark);
      writeEvent(
        'warp-init-write-110',
        this.context,
        ball,
        ballpark,
        '+0x110',
        snapshot.warpDistance,
        vecDistance(snapshot.position, snapshot.target),
        null
      );
    }
  });

  if (!PROFILE_FLAGS.mode3OnlyLite) {
    Interceptor.attach(at(SITES.warpSolverEnter), {
      onEnter() {
        const ball = ptr(this.context.rdx);
        const ballpark = ptr(this.context.rcx);
        const elapsedArg = readDoubleAt(ptr(this.context.rsp).add(0x28));
        const callerReturn = readPointer(ptr(this.context.rsp));
        const callerSite = classifySolverCaller(callerReturn);
        const isPositive = Number.isFinite(elapsedArg) && elapsedArg > 0;
        const site = isPositive ? `warp-solver-enter-positive-${callerSite}` : `warp-solver-enter-zero-${callerSite}`;
        if (!shouldEmitForWarp(site, 1)) return;
        this._traceSolver = { site, callerReturn, callerSite, isPositive };
        this._ball = ball;
        this._ballpark = ballpark;
        this._outputPos = ptr(this.context.r8);
        this._outputVel = ptr(this.context.r9);
        this._elapsedArg = elapsedArg;
        this._controlBool = readU8At(ptr(this.context.rsp).add(0x30));
        this._ballpark2ba = readU8(ballpark, 0x2ba);
        functionEvent('enter', site, this.context, ball, ballpark, {
          elapsedArg: this._elapsedArg,
          controlBool: this._controlBool,
          ballpark2ba: this._ballpark2ba,
          callerReturn: hexPtr(callerReturn),
          callerSite
        });
      },
      onLeave() {
        if (!this._traceSolver) return;
        const leaveSite = this._traceSolver.site.replace('enter', 'leave');
        functionEvent('leave', leaveSite, this.context, this._ball, this._ballpark, {
          elapsedArg: this._elapsedArg,
          controlBool: this._controlBool,
          ballpark2ba: this._ballpark2ba,
          callerReturn: hexPtr(this._traceSolver.callerReturn),
          callerSite: this._traceSolver.callerSite,
          outputPosition: readVec3(this._outputPos, 0x0, 0x8, 0x10),
          outputVelocity: readVec3(this._outputVel, 0x0, 0x8, 0x10)
        });
      }
    });
  }

  if (!PROFILE_FLAGS.mode3OnlyLite) {
    Interceptor.attach(at(SITES.warpSolverFailureLatch), {
      onEnter() {
        const ball = ptr(this.context.rdi);
        const ballpark = ptr(this.context.rsi);
        if (shouldEmitForWarp('warp-solver-failure-latch-d2', 1)) {
          writeEvent('warp-solver-failure-latch-d2', this.context, ball, ballpark, '+0xd2', readU8(ball, OFFSETS.latchD2), 1, null);
        }
        if (shouldEmitForWarp('warp-solver-failure-latch-478', 1)) {
          writeEvent('warp-solver-failure-latch-478', this.context, ball, ballpark, '+0x478', readU8(ball, OFFSETS.latch478), 1, null);
        }
      }
    });
  }

  if (!PROFILE_FLAGS.mode3OnlyLite) {
    Interceptor.attach(at(SITES.tickForceWarpDistanceMinusOne), {
      onEnter() {
        const ball = ptr(this.context.rdi);
        const ballpark = ptr(this.context.r14);
        if (!shouldEmitForWarp('tick-force-warpdistance-minus-one', 1)) return;
        writeEvent('tick-force-warpdistance-minus-one', this.context, ball, ballpark, '+0x110', readDouble(ball, OFFSETS.warpDistance), -1.0, null);
      }
    });
  }

  function installFollowOnHelper(siteName, offset) {
    Interceptor.attach(at(offset), {
      onEnter() {
        const ball = selectBallCandidate([
          this.context.rcx,
          this.context.rdx,
          this.context.r8,
          this.context.r9
        ]);
        if (ball === null) return;
        if (!shouldEmitForWarp(`${siteName}-enter`, 2)) return;
        this._traceFollowOn = true;
        this._ball = ball;
        functionEvent('enter', `${siteName}-enter`, this.context, ball, null, {
          rcx: hexPtr(this.context.rcx),
          rdx: hexPtr(this.context.rdx),
          r8: hexPtr(this.context.r8),
          r9: hexPtr(this.context.r9)
        });
      },
      onLeave() {
        if (!this._traceFollowOn) return;
        functionEvent('leave', `${siteName}-leave`, this.context, this._ball, null, null);
      }
    });
  }

  if (!PROFILE_FLAGS.mode3OnlyLite) {
    installFollowOnHelper('followon-helper-36700', SITES.motionHelper36700);
    installFollowOnHelper('followon-helper-3e980', SITES.motionHelper3e980);
  }
}

installHooks();
setInterval(installHooks, 1000);
