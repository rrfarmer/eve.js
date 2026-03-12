const crypto = require("crypto");
const path = require("path");
const protobuf = require("protobufjs");

const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { findShipItemById } = require(path.join(
  __dirname,
  "../../services/inventory/itemStore",
));
const {
  getAppliedSkinRecord,
  getAppliedSkinRecordsForOwner,
  getAllLicensedSkinRecords,
  getEffectiveLicenseRecord,
} = require(path.join(__dirname, "../../services/ship/shipCosmeticsState"));

const GATEWAY_INSTANCE_UUID = Buffer.from(
  crypto.randomUUID().replace(/-/g, ""),
  "hex",
);
const ACTIVE_NOTICE_STREAMS = new Set();
const UNKNOWN_REQUEST_COUNTS = new Map();
const GRPC_RESPONSE_HEADERS = {
  ":status": 200,
  "content-type": "application/grpc+proto",
  "grpc-encoding": "identity",
  "grpc-accept-encoding": "identity",
};
const EMPTY_PAYLOAD = Buffer.alloc(0);
const PUBLIC_GATEWAY_ORIGIN = "eve.js local gateway";
const PROTO_ROOT = protobuf.Root.fromJSON({
  nested: {
    google: {
      nested: {
        protobuf: {
          nested: {
            Any: {
              fields: {
                type_url: { type: "string", id: 1 },
                value: { type: "bytes", id: 2 },
              },
            },
            Empty: {
              fields: {},
            },
            Timestamp: {
              fields: {
                seconds: { type: "int64", id: 1 },
                nanos: { type: "int32", id: 2 },
              },
            },
          },
        },
      },
    },
    eve_public: {
      nested: {
        Request: {
          fields: {
            issued: { type: "google.protobuf.Timestamp", id: 1 },
            correlation_uuid: { type: "bytes", id: 2 },
            payload: { type: "google.protobuf.Any", id: 3 },
            external_origin: { type: "string", id: 4 },
            application_instance_uuid: { type: "bytes", id: 5 },
            authoritative_context: {
              type: "eve_public.AuthoritativeContext",
              id: 6,
            },
          },
        },
        Response: {
          fields: {
            dispatched: { type: "google.protobuf.Timestamp", id: 1 },
            correlation_uuid: { type: "bytes", id: 2 },
            status_code: { type: "uint32", id: 3 },
            status_message: { type: "string", id: 4 },
            payload: { type: "google.protobuf.Any", id: 5 },
            internal_origin: { type: "string", id: 6 },
            application_instance_uuid: { type: "bytes", id: 7 },
            gateway_instance_uuid: { type: "bytes", id: 8 },
          },
        },
        Notice: {
          fields: {
            dispatched: { type: "google.protobuf.Timestamp", id: 1 },
            uuid: { type: "bytes", id: 2 },
            internal_origin: { type: "string", id: 3 },
            tenant: { type: "string", id: 4 },
            payload: { type: "google.protobuf.Any", id: 5 },
            target_group: { type: "eve_public.Notice.TargetGroup", id: 6 },
          },
          nested: {
            TargetGroup: {
              oneofs: {
                group: {
                  oneof: [
                    "application_instance_uuid",
                    "solar_system",
                    "user",
                    "character",
                    "corporation",
                    "alliance",
                    "bubble_instance_uuid",
                  ],
                },
              },
              fields: {
                application_instance_uuid: { type: "bytes", id: 1 },
                solar_system: { type: "uint32", id: 2 },
                user: { type: "int64", id: 3 },
                character: { type: "uint32", id: 4 },
                corporation: { type: "uint32", id: 5 },
                alliance: { type: "int32", id: 6 },
                bubble_instance_uuid: { type: "bytes", id: 7 },
              },
            },
          },
        },
        AuthoritativeContext: {
          fields: {
            active_character: {
              type: "eve_public.character.Identifier",
              id: 7,
            },
            identity: {
              type: "eve_public.ActiveIdentity",
              id: 10,
            },
          },
        },
        ActiveIdentity: {
          fields: {
            character: {
              type: "eve_public.character.Identifier",
              id: 1,
            },
          },
        },
        character: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint32", id: 1 },
              },
            },
          },
        },
        ship: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint64", id: 1 },
              },
            },
          },
        },
        user: {
          nested: {
            license: {
              nested: {
                Identifier: {
                  fields: {
                    license_type: { type: "string", id: 1 },
                  },
                },
                Attributes: {
                  oneofs: {
                    has_expiry_date: {
                      oneof: ["no_expiry_date", "expiry_date"],
                    },
                  },
                  fields: {
                    no_expiry_date: { type: "bool", id: 1 },
                    expiry_date: {
                      type: "google.protobuf.Timestamp",
                      id: 2,
                    },
                    last_modified: {
                      type: "google.protobuf.Timestamp",
                      id: 3,
                    },
                  },
                },
                api: {
                  nested: {
                    GetRequest: {
                      fields: {
                        license: {
                          type: "eve_public.user.license.Identifier",
                          id: 1,
                        },
                      },
                    },
                    GetResponse: {
                      fields: {
                        license: {
                          type: "eve_public.user.license.Attributes",
                          id: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        cosmetic: {
          nested: {
            ship: {
              nested: {
                api: {
                  nested: {
                    GetRequest: {
                      fields: {
                        ship: {
                          type: "eve_public.ship.Identifier",
                          id: 1,
                        },
                      },
                    },
                    GetResponse: {
                      fields: {
                        state: {
                          type: "eve_public.cosmetic.ship.State",
                          id: 1,
                        },
                      },
                    },
                    GetAllInBubbleRequest: {
                      fields: {},
                    },
                    GetAllInBubbleResponse: {
                      fields: {
                        states: {
                          rule: "repeated",
                          type: "eve_public.cosmetic.ship.State",
                          id: 1,
                        },
                      },
                    },
                    SetNotice: {
                      fields: {
                        state: {
                          type: "eve_public.cosmetic.ship.State",
                          id: 1,
                        },
                      },
                    },
                    SetAllInBubbleNotice: {
                      fields: {
                        state: {
                          rule: "repeated",
                          type: "eve_public.cosmetic.ship.State",
                          id: 1,
                        },
                      },
                    },
                  },
                },
                State: {
                  fields: {
                    character: {
                      type: "eve_public.character.Identifier",
                      id: 1,
                    },
                    ship: {
                      type: "eve_public.ship.Identifier",
                      id: 2,
                    },
                    skin: {
                      type: "eve_public.cosmetic.ship.State.Skin",
                      id: 3,
                    },
                  },
                  nested: {
                    Skin: {
                      oneofs: {
                        skin: {
                          oneof: ["firstparty", "thirdparty", "no_skin"],
                        },
                      },
                      fields: {
                        firstparty: {
                          type: "eve_public.cosmetic.ship.State.Skin.FirstParty",
                          id: 1,
                        },
                        thirdparty: {
                          type: "eve_public.cosmetic.ship.State.Skin.ThirdParty",
                          id: 2,
                        },
                        no_skin: { type: "bool", id: 3 },
                      },
                      nested: {
                        FirstParty: {
                          fields: {
                            identifier: {
                              type: "eve_public.cosmetic.ship.skin.firstparty.Identifier",
                              id: 1,
                            },
                          },
                        },
                        ThirdParty: {
                          fields: {
                            identifier: {
                              type: "eve_public.cosmetic.ship.skin.thirdparty.Identifier",
                              id: 1,
                            },
                          },
                        },
                      },
                    },
                  },
                },
                skin: {
                  nested: {
                    firstparty: {
                      nested: {
                        Identifier: {
                          fields: {
                            sequential: { type: "uint64", id: 1 },
                          },
                        },
                        license: {
                          nested: {
                            Owned: {
                              fields: {
                                identifier: {
                                  type: "eve_public.cosmetic.ship.skin.firstparty.Identifier",
                                  id: 1,
                                },
                              },
                            },
                            api: {
                              nested: {
                                GetOwnedRequest: {
                                  fields: {},
                                },
                                GetOwnedResponse: {
                                  fields: {
                                    licenses: {
                                      rule: "repeated",
                                      type: "eve_public.cosmetic.ship.skin.firstparty.license.Owned",
                                      id: 1,
                                    },
                                  },
                                },
                                GetRequest: {
                                  fields: {
                                    skin: {
                                      type: "eve_public.cosmetic.ship.skin.firstparty.Identifier",
                                      id: 1,
                                    },
                                  },
                                },
                                GetResponse: {
                                  fields: {
                                    license: {
                                      type: "eve_public.cosmetic.ship.skin.firstparty.license.Owned",
                                      id: 1,
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    thirdparty: {
                      nested: {
                        Identifier: {
                          fields: {
                            hex: { type: "string", id: 1 },
                          },
                        },
                        component: {
                          nested: {
                            Identifier: {
                              fields: {
                                hex: { type: "string", id: 1 },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            market: {
              nested: {
                skin: {
                  nested: {
                    listing: {
                      nested: {
                        Owned: {
                          fields: {
                            identifier: {
                              type: "eve_public.cosmetic.ship.skin.firstparty.Identifier",
                              id: 1,
                            },
                          },
                        },
                        api: {
                          nested: {
                            GetAllOwnedRequest: {
                              fields: {},
                            },
                            GetAllOwnedResponse: {
                              fields: {
                                listings: {
                                  rule: "repeated",
                                  type: "eve_public.cosmetic.market.skin.listing.Owned",
                                  id: 1,
                                },
                              },
                            },
                            GetAllRequest: {
                              fields: {},
                            },
                            GetAllResponse: {
                              fields: {
                                listings: {
                                  rule: "repeated",
                                  type: "eve_public.cosmetic.market.skin.listing.Owned",
                                  id: 1,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});
const RequestEnvelope = PROTO_ROOT.lookupType("eve_public.Request");
const ResponseEnvelope = PROTO_ROOT.lookupType("eve_public.Response");
const NoticeEnvelope = PROTO_ROOT.lookupType("eve_public.Notice");
const ShipStateGetRequest = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.api.GetRequest",
);
const ShipStateGetResponse = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.api.GetResponse",
);
const ShipStateGetAllInBubbleResponse = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.api.GetAllInBubbleResponse",
);
const ShipStateSetNotice = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.api.SetNotice",
);
const ShipStateSetAllInBubbleNotice = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.api.SetAllInBubbleNotice",
);
const UserLicenseGetRequest = PROTO_ROOT.lookupType(
  "eve_public.user.license.api.GetRequest",
);
const UserLicenseGetResponse = PROTO_ROOT.lookupType(
  "eve_public.user.license.api.GetResponse",
);
const FirstPartySkinLicenseGetOwnedResponse = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.skin.firstparty.license.api.GetOwnedResponse",
);
const FirstPartySkinLicenseGetRequest = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.skin.firstparty.license.api.GetRequest",
);
const FirstPartySkinLicenseGetResponse = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.ship.skin.firstparty.license.api.GetResponse",
);
const MarketSkinListingGetAllOwnedResponse = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.market.skin.listing.api.GetAllOwnedResponse",
);
const MarketSkinListingGetAllResponse = PROTO_ROOT.lookupType(
  "eve_public.cosmetic.market.skin.listing.api.GetAllResponse",
);

const OMEGA_USER_LICENSE_TYPE = "eve_clonestate_omega";
const OMEGA_LICENSE_EXPIRY_SECONDS = 4102444800; // 2100-01-01T00:00:00Z

function timestampNow() {
  const now = Date.now();
  return {
    seconds: Math.floor(now / 1000),
    nanos: (now % 1000) * 1000000,
  };
}

function bufferFromBytes(value) {
  if (!value) {
    return EMPTY_PAYLOAD;
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  return Buffer.from(String(value), "utf8");
}

function uuidBuffer() {
  return Buffer.from(crypto.randomUUID().replace(/-/g, ""), "hex");
}

function normalizeProtoNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function removeNoticeStream(stream) {
  if (ACTIVE_NOTICE_STREAMS.delete(stream)) {
    log.info(
      `[PublicGatewayLocal] Notices.Consume disconnected active=${ACTIVE_NOTICE_STREAMS.size}`,
    );
  }
}

function extractTypeName(typeUrl) {
  const normalized = String(typeUrl || "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function correlationLabel(requestEnvelope) {
  const correlation = bufferFromBytes(
    requestEnvelope && requestEnvelope.correlation_uuid,
  );
  if (!correlation.length) {
    return "none";
  }

  return correlation.toString("hex").slice(0, 16);
}

function shouldLogUnknownCount(count) {
  return count <= 3 || (count & (count - 1)) === 0;
}

function buildAny(typeName, payloadBuffer) {
  return {
    type_url: `type.googleapis.com/${typeName}`,
    value: payloadBuffer,
  };
}

function createGrpcFrame(messageBuffer) {
  const payload = Buffer.from(messageBuffer || EMPTY_PAYLOAD);
  const frame = Buffer.allocUnsafe(5 + payload.length);
  frame[0] = 0;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function createGrpcFrameParser(onFrame) {
  let pending = EMPTY_PAYLOAD;

  return function parseChunk(chunk) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);

    while (pending.length >= 5) {
      const compressed = pending[0];
      const payloadLength = pending.readUInt32BE(1);
      if (pending.length < 5 + payloadLength) {
        return;
      }

      const payload = pending.subarray(5, 5 + payloadLength);
      pending = pending.subarray(5 + payloadLength);

      if (compressed !== 0) {
        log.warn(
          `[PublicGatewayLocal] Ignoring compressed gRPC frame flag=${compressed}`,
        );
        continue;
      }

      onFrame(Buffer.from(payload));
    }
  };
}

function getActiveCharacterID(requestEnvelope) {
  const identityCharacter =
    requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.identity &&
    requestEnvelope.authoritative_context.identity.character
      ? normalizeProtoNumber(
          requestEnvelope.authoritative_context.identity.character.sequential,
        )
      : 0;
  if (identityCharacter) {
    return identityCharacter;
  }

  return requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.active_character
    ? normalizeProtoNumber(
        requestEnvelope.authoritative_context.active_character.sequential,
      )
    : 0;
}

function buildShipStateObject(shipID, activeCharacterID) {
  const numericShipID = normalizeProtoNumber(shipID);
  if (!numericShipID) {
    return null;
  }

  const appliedRecord = getAppliedSkinRecord(numericShipID);
  const shipItem = findShipItemById(numericShipID);
  if (!appliedRecord && !shipItem) {
    return null;
  }

  const ownerID =
    normalizeProtoNumber(
      appliedRecord && appliedRecord.ownerID ? appliedRecord.ownerID : 0,
    ) ||
    normalizeProtoNumber(shipItem && shipItem.ownerID ? shipItem.ownerID : 0) ||
    normalizeProtoNumber(activeCharacterID);
  const skinID = normalizeProtoNumber(
    appliedRecord && appliedRecord.skinID ? appliedRecord.skinID : 0,
  );

  const state = {
    character: {
      sequential: ownerID,
    },
    ship: {
      sequential: numericShipID,
    },
    skin: skinID
      ? {
          firstparty: {
            identifier: {
              sequential: skinID,
            },
          },
        }
      : {
          no_skin: true,
        },
  };

  return state;
}

function buildShipStateResponsePayload(requestEnvelope) {
  const decoded = ShipStateGetRequest.decode(
    bufferFromBytes(requestEnvelope.payload && requestEnvelope.payload.value),
  );
  const shipID = normalizeProtoNumber(decoded && decoded.ship && decoded.ship.sequential);
  const state = buildShipStateObject(shipID, getActiveCharacterID(requestEnvelope));
  if (!state) {
    return null;
  }

  return Buffer.from(
    ShipStateGetResponse.encode(
      ShipStateGetResponse.create({
        state,
      }),
    ).finish(),
  );
}

function buildShipStatesInBubblePayload(requestEnvelope) {
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  const states = getAppliedSkinRecordsForOwner(activeCharacterID)
    .map((record) => buildShipStateObject(record.shipID, activeCharacterID))
    .filter(Boolean);

  return Buffer.from(
    ShipStateGetAllInBubbleResponse.encode(
      ShipStateGetAllInBubbleResponse.create({
        states,
      }),
    ).finish(),
  );
}

function omegaLicenseEnabled() {
  return Boolean(config.omegaLicenseEnabled);
}

function buildUserLicenseResponsePayload(requestEnvelope) {
  const decoded = UserLicenseGetRequest.decode(
    bufferFromBytes(requestEnvelope.payload && requestEnvelope.payload.value),
  );
  const licenseType = String(
    decoded && decoded.license && decoded.license.license_type
      ? decoded.license.license_type
      : "",
  );

  if (licenseType !== OMEGA_USER_LICENSE_TYPE) {
    return {
      payloadBuffer: Buffer.from(
        UserLicenseGetResponse.encode(
          UserLicenseGetResponse.create({}),
        ).finish(),
      ),
      hasLicense: false,
      licenseType,
    };
  }

  if (!omegaLicenseEnabled()) {
    return {
      payloadBuffer: Buffer.from(
        UserLicenseGetResponse.encode(
          UserLicenseGetResponse.create({}),
        ).finish(),
      ),
      hasLicense: false,
      licenseType,
    };
  }

  return {
    payloadBuffer: Buffer.from(
      UserLicenseGetResponse.encode(
        UserLicenseGetResponse.create({
          license: {
            // This client build ignores no_expiry_date on parse and then
            // compares expiry_date directly in is_expired().
            expiry_date: {
              seconds: OMEGA_LICENSE_EXPIRY_SECONDS,
              nanos: 0,
            },
            last_modified: timestampNow(),
          },
        }),
      ).finish(),
    ),
    hasLicense: true,
    licenseType,
  };
}

function buildOwnedFirstPartyLicenseObjects(activeCharacterID) {
  return getAllLicensedSkinRecords(activeCharacterID).map((record) => ({
    identifier: {
      sequential: normalizeProtoNumber(record && record.skinID ? record.skinID : 0),
    },
  }));
}

function buildFirstPartySkinGetOwnedPayload(requestEnvelope) {
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  return Buffer.from(
    FirstPartySkinLicenseGetOwnedResponse.encode(
      FirstPartySkinLicenseGetOwnedResponse.create({
        licenses: buildOwnedFirstPartyLicenseObjects(activeCharacterID),
      }),
    ).finish(),
  );
}

function buildFirstPartySkinGetPayload(requestEnvelope) {
  const decoded = FirstPartySkinLicenseGetRequest.decode(
    bufferFromBytes(requestEnvelope.payload && requestEnvelope.payload.value),
  );
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  const skinID = normalizeProtoNumber(
    decoded && decoded.skin && decoded.skin.sequential ? decoded.skin.sequential : 0,
  );
  const record = getEffectiveLicenseRecord(activeCharacterID, skinID, {
    allowCatalogFallback: true,
  });

  return Buffer.from(
    FirstPartySkinLicenseGetResponse.encode(
      FirstPartySkinLicenseGetResponse.create({
        license: record
          ? {
              identifier: {
                sequential: normalizeProtoNumber(record.skinID),
              },
            }
          : null,
      }),
    ).finish(),
  );
}

function buildOwnedMarketListingObjects(activeCharacterID) {
  return getAllLicensedSkinRecords(activeCharacterID).map((record) => ({
    identifier: {
      sequential: normalizeProtoNumber(record && record.skinID ? record.skinID : 0),
    },
  }));
}

function buildMarketSkinListingGetAllOwnedPayload(requestEnvelope) {
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  return Buffer.from(
    MarketSkinListingGetAllOwnedResponse.encode(
      MarketSkinListingGetAllOwnedResponse.create({
        listings: buildOwnedMarketListingObjects(activeCharacterID),
      }),
    ).finish(),
  );
}

function buildMarketSkinListingGetAllPayload(requestEnvelope) {
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  return Buffer.from(
    MarketSkinListingGetAllResponse.encode(
      MarketSkinListingGetAllResponse.create({
        listings: buildOwnedMarketListingObjects(activeCharacterID),
      }),
    ).finish(),
  );
}

function encodeNoticeEnvelope(noticeTypeName, noticePayloadBuffer, targetGroup) {
  const noticeEnvelope = NoticeEnvelope.create({
    dispatched: timestampNow(),
    uuid: uuidBuffer(),
    internal_origin: PUBLIC_GATEWAY_ORIGIN,
    tenant: "",
    payload: buildAny(noticeTypeName, noticePayloadBuffer || EMPTY_PAYLOAD),
    target_group: targetGroup,
  });

  return Buffer.from(NoticeEnvelope.encode(noticeEnvelope).finish());
}

function broadcastNoticeEnvelope(noticeBuffer) {
  const grpcFrame = createGrpcFrame(noticeBuffer);

  for (const stream of [...ACTIVE_NOTICE_STREAMS]) {
    if (stream.destroyed || stream.closed) {
      ACTIVE_NOTICE_STREAMS.delete(stream);
      continue;
    }

    try {
      stream.write(grpcFrame);
    } catch (error) {
      log.warn(
        `[PublicGatewayLocal] Failed writing notice to stream: ${error.message}`,
      );
      ACTIVE_NOTICE_STREAMS.delete(stream);
    }
  }
}

function publishShipStateSetNotice(shipID, activeCharacterID = 0) {
  const state = buildShipStateObject(shipID, activeCharacterID);
  if (!state) {
    log.warn(
      `[PublicGatewayLocal] Skipped SetNotice for shipID=${shipID}; state unavailable`,
    );
    return false;
  }

  const targetCharacterID =
    normalizeProtoNumber(state.character && state.character.sequential) ||
    normalizeProtoNumber(activeCharacterID);
  if (!targetCharacterID) {
    log.warn(
      `[PublicGatewayLocal] Skipped SetNotice for shipID=${shipID}; target character unavailable`,
    );
    return false;
  }

  const noticePayload = Buffer.from(
    ShipStateSetNotice.encode(
      ShipStateSetNotice.create({
        state,
      }),
    ).finish(),
  );
  const noticeEnvelope = encodeNoticeEnvelope(
    "eve_public.cosmetic.ship.api.SetNotice",
    noticePayload,
    {
      character: targetCharacterID,
    },
  );

  log.info(
    `[PublicGatewayLocal] Notices.Publish eve_public.cosmetic.ship.api.SetNotice shipID=${normalizeProtoNumber(
      shipID,
    )} skinID=${normalizeProtoNumber(
      state &&
        state.skin &&
        state.skin.firstparty &&
        state.skin.firstparty.identifier
        ? state.skin.firstparty.identifier.sequential
        : 0,
    )} targetCharacterID=${targetCharacterID} streams=${ACTIVE_NOTICE_STREAMS.size}`,
  );
  broadcastNoticeEnvelope(noticeEnvelope);
  return true;
}

function publishShipStateSetAllInBubbleNotice(activeCharacterID) {
  const numericCharacterID = normalizeProtoNumber(activeCharacterID);
  if (!numericCharacterID) {
    return false;
  }

  const states = getAppliedSkinRecordsForOwner(numericCharacterID)
    .map((record) => buildShipStateObject(record.shipID, numericCharacterID))
    .filter(Boolean);
  const noticePayload = Buffer.from(
    ShipStateSetAllInBubbleNotice.encode(
      ShipStateSetAllInBubbleNotice.create({
        state: states,
      }),
    ).finish(),
  );
  const noticeEnvelope = encodeNoticeEnvelope(
    "eve_public.cosmetic.ship.api.SetAllInBubbleNotice",
    noticePayload,
    {
      character: numericCharacterID,
    },
  );

  log.info(
    `[PublicGatewayLocal] Notices.Publish eve_public.cosmetic.ship.api.SetAllInBubbleNotice targetCharacterID=${numericCharacterID} states=${states.length} streams=${ACTIVE_NOTICE_STREAMS.size}`,
  );
  broadcastNoticeEnvelope(noticeEnvelope);
  return true;
}

function getDefaultResponseTypeName(requestTypeName) {
  if (!requestTypeName || !requestTypeName.endsWith("Request")) {
    return null;
  }

  return `${requestTypeName.slice(0, -7)}Response`;
}

function getEmptySuccessResponseType(requestTypeName) {
  if (!requestTypeName) {
    return null;
  }

  if (
    requestTypeName.startsWith(
      "eve_public.cosmetic.ship.skin.thirdparty.license.api.",
    ) &&
    ["GetOwnedRequest", "ActivateRequest", "ApplyRequest", "UnapplyRequest"].some(
      (suffix) => requestTypeName.endsWith(suffix),
    )
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.startsWith(
      "eve_public.cosmetic.ship.skin.thirdparty.component.license.api.",
    ) &&
    requestTypeName.endsWith("GetOwnedRequest")
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.startsWith("eve_public.cosmetic.market.skin.listing.api.") &&
    ["GetAllOwnedRequest", "GetAllRequest"].some((suffix) =>
      requestTypeName.endsWith(suffix),
    )
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.includes("eve_public.entitlement.character") &&
    requestTypeName.endsWith("GetAllRequest")
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.startsWith(
      "eve_public.cosmetic.ship.skin.thirdparty.sequencing.job.api.",
    ) &&
    requestTypeName.endsWith("GetAllActiveRequest")
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.startsWith(
      "eve_public.cosmetic.ship.skin.thirdparty.draft.api.",
    ) &&
    ["GetAllSavedRequest", "GetSaveCapacityRequest"].some((suffix) =>
      requestTypeName.endsWith(suffix),
    )
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.startsWith("eve_public.pirate.corruption.api.") &&
    requestTypeName.endsWith("GetSystemInfoRequest")
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  if (
    requestTypeName.startsWith("eve_public.plex.vault.api.") &&
    requestTypeName.endsWith("BalanceRequest")
  ) {
    return getDefaultResponseTypeName(requestTypeName);
  }

  return null;
}

function encodeResponseEnvelope(
  requestEnvelope,
  statusCode,
  statusMessage,
  responseTypeName,
  responsePayloadBuffer,
) {
  const responseEnvelope = ResponseEnvelope.create({
    dispatched: timestampNow(),
    correlation_uuid: bufferFromBytes(requestEnvelope.correlation_uuid),
    status_code: statusCode,
    status_message: statusMessage || "",
    payload:
      responseTypeName !== null
        ? buildAny(responseTypeName, responsePayloadBuffer || EMPTY_PAYLOAD)
        : null,
    internal_origin: PUBLIC_GATEWAY_ORIGIN,
    application_instance_uuid: bufferFromBytes(
      requestEnvelope.application_instance_uuid,
    ),
    gateway_instance_uuid: GATEWAY_INSTANCE_UUID,
  });

  return Buffer.from(ResponseEnvelope.encode(responseEnvelope).finish());
}

function buildRequestContext(requestEnvelope, requestTypeName, frameBuffer) {
  return {
    requestEnvelope,
    requestTypeName,
    activeCharacterID: getActiveCharacterID(requestEnvelope),
    correlation: correlationLabel(requestEnvelope),
    requestBytes: Buffer.byteLength(frameBuffer || EMPTY_PAYLOAD),
  };
}

function logGatewaySummary(context, result) {
  const message =
    `[PublicGatewayLocal] Requests.Send type=${context.requestTypeName || "<unknown>"} ` +
    `status=${result.statusCode} duration_ms=${result.durationMs.toFixed(2)} ` +
    `responseType=${result.responseTypeName || "<none>"} ` +
    `activeCharacterID=${context.activeCharacterID || 0} ` +
    `correlation=${context.correlation}`;

  if (result.statusCode >= 400) {
    log.warn(message + ` error="${result.statusMessage || ""}"`);
    return;
  }

  log.info(message);
}

function logUnknownRequest(context) {
  const key = context.requestTypeName || "<unknown>";
  const count = (UNKNOWN_REQUEST_COUNTS.get(key) || 0) + 1;
  UNKNOWN_REQUEST_COUNTS.set(key, count);

  if (!shouldLogUnknownCount(count)) {
    return;
  }

  log.warn(
    `[PublicGatewayLocal] Unknown eve_public request type=${key} ` +
      `count=${count} requestBytes=${context.requestBytes} ` +
      `activeCharacterID=${context.activeCharacterID || 0} ` +
      `correlation=${context.correlation}`,
  );
}

function buildGatewayResponseForRequest(frameBuffer) {
  const startedAt = process.hrtime.bigint();
  const requestEnvelope = RequestEnvelope.decode(frameBuffer);
  const requestTypeName = extractTypeName(
    requestEnvelope &&
      requestEnvelope.payload &&
      requestEnvelope.payload.type_url
      ? requestEnvelope.payload.type_url
      : "",
  );
  const context = buildRequestContext(
    requestEnvelope,
    requestTypeName,
    frameBuffer,
  );

  let result;

  if (requestTypeName === "eve_public.cosmetic.ship.api.GetRequest") {
    const payloadBuffer = buildShipStateResponsePayload(requestEnvelope);
    if (!payloadBuffer) {
      result = {
        statusCode: 404,
        statusMessage: "ship cosmetic state not found",
        responseTypeName: null,
        responsePayloadBuffer: null,
      };
    } else {
      result = {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: "eve_public.cosmetic.ship.api.GetResponse",
        responsePayloadBuffer: payloadBuffer,
      };
    }
  }

  if (!result && requestTypeName === "eve_public.cosmetic.ship.api.GetAllInBubbleRequest") {
    result = {
      statusCode: 200,
      statusMessage: "",
      responseTypeName: "eve_public.cosmetic.ship.api.GetAllInBubbleResponse",
      responsePayloadBuffer: buildShipStatesInBubblePayload(requestEnvelope),
    };
  }

  if (!result && requestTypeName === "eve_public.user.license.api.GetRequest") {
    const licenseResult = buildUserLicenseResponsePayload(requestEnvelope);
    result = {
      statusCode: 200,
      statusMessage: "",
      responseTypeName: "eve_public.user.license.api.GetResponse",
      responsePayloadBuffer: licenseResult.payloadBuffer,
    };
    log.info(
      `[PublicGatewayLocal] UserLicense.Get license_type=${licenseResult.licenseType || "<unknown>"} ` +
        `hasLicense=${licenseResult.hasLicense} omegaLicenseEnabled=${omegaLicenseEnabled()}`,
    );
  }

  if (
    !result &&
    requestTypeName === "eve_public.cosmetic.ship.skin.firstparty.license.api.GetOwnedRequest"
  ) {
    result = {
      statusCode: 200,
      statusMessage: "",
      responseTypeName:
        "eve_public.cosmetic.ship.skin.firstparty.license.api.GetOwnedResponse",
      responsePayloadBuffer: buildFirstPartySkinGetOwnedPayload(requestEnvelope),
    };
  }

  if (
    !result &&
    requestTypeName === "eve_public.cosmetic.ship.skin.firstparty.license.api.GetRequest"
  ) {
    result = {
      statusCode: 200,
      statusMessage: "",
      responseTypeName:
        "eve_public.cosmetic.ship.skin.firstparty.license.api.GetResponse",
      responsePayloadBuffer: buildFirstPartySkinGetPayload(requestEnvelope),
    };
  }

  if (
    !result &&
    requestTypeName === "eve_public.cosmetic.market.skin.listing.api.GetAllOwnedRequest"
  ) {
    result = {
      statusCode: 200,
      statusMessage: "",
      responseTypeName: "eve_public.cosmetic.market.skin.listing.api.GetAllOwnedResponse",
      responsePayloadBuffer: buildMarketSkinListingGetAllOwnedPayload(requestEnvelope),
    };
  }

  if (
    !result &&
    requestTypeName === "eve_public.cosmetic.market.skin.listing.api.GetAllRequest"
  ) {
    result = {
      statusCode: 200,
      statusMessage: "",
      responseTypeName: "eve_public.cosmetic.market.skin.listing.api.GetAllResponse",
      responsePayloadBuffer: buildMarketSkinListingGetAllPayload(requestEnvelope),
    };
  }

  if (!result) {
    const emptySuccessResponseType = getEmptySuccessResponseType(requestTypeName);
    if (emptySuccessResponseType) {
      result = {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: emptySuccessResponseType,
        responsePayloadBuffer: EMPTY_PAYLOAD,
      };
    }
  }

  if (!result) {
    logUnknownRequest(context);
    result = {
      statusCode: 404,
      statusMessage: `eve.js local gateway has no handler for ${requestTypeName || "unknown request"}`,
      responseTypeName: null,
      responsePayloadBuffer: null,
    };
  }

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
  const responseBuffer = encodeResponseEnvelope(
    requestEnvelope,
    result.statusCode,
    result.statusMessage,
    result.responseTypeName,
    result.responsePayloadBuffer,
  );
  logGatewaySummary(context, {
    ...result,
    durationMs,
  });

  return responseBuffer;
}

function finalizeGrpcStream(stream) {
  if (stream.destroyed || stream.closed) {
    return;
  }

  stream.end();
}

function initializeGrpcStream(stream) {
  stream.respond(GRPC_RESPONSE_HEADERS, { waitForTrailers: true });
  stream.on("wantTrailers", () => {
    try {
      stream.sendTrailers({ "grpc-status": "0" });
    } catch (error) {
      log.debug(`[PublicGatewayLocal] Failed to send trailers: ${error.message}`);
    }
  });
}

function handleUnaryPing(stream, label) {
  initializeGrpcStream(stream);
  stream.on("data", () => {});
  stream.on("end", () => {
    log.debug(`[PublicGatewayLocal] ${label} ping`);
    stream.write(createGrpcFrame(EMPTY_PAYLOAD));
    finalizeGrpcStream(stream);
  });
  stream.on("error", (error) => {
    log.warn(`[PublicGatewayLocal] ${label} ping error: ${error.message}`);
  });
}

function handleRequestsSendStream(stream) {
  initializeGrpcStream(stream);
  const parseChunk = createGrpcFrameParser((payload) => {
    const responseBuffer = buildGatewayResponseForRequest(payload);
    stream.write(createGrpcFrame(responseBuffer));
  });

  stream.on("data", parseChunk);
  stream.on("end", () => finalizeGrpcStream(stream));
  stream.on("error", (error) => {
    log.warn(`[PublicGatewayLocal] Requests.Send error: ${error.message}`);
  });
}

function handleNoticesConsumeStream(stream) {
  initializeGrpcStream(stream);
  ACTIVE_NOTICE_STREAMS.add(stream);
  log.info(
    `[PublicGatewayLocal] Notices.Consume connected active=${ACTIVE_NOTICE_STREAMS.size}`,
  );

  const parseChunk = createGrpcFrameParser(() => {});
  stream.on("data", parseChunk);
  stream.on("end", () => {
    log.debug(
      "[PublicGatewayLocal] Notices.Consume request completed; keeping stream open",
    );
  });
  stream.on("close", () => {
    removeNoticeStream(stream);
  });
  stream.on("error", (error) => {
    log.warn(`[PublicGatewayLocal] Notices.Consume error: ${error.message}`);
    removeNoticeStream(stream);
  });
}

function handleEventsPublishStream(stream) {
  initializeGrpcStream(stream);
  const parseChunk = createGrpcFrameParser(() => {
    stream.write(createGrpcFrame(EMPTY_PAYLOAD));
  });

  stream.on("data", parseChunk);
  stream.on("end", () => finalizeGrpcStream(stream));
  stream.on("error", (error) => {
    log.warn(`[PublicGatewayLocal] Events.Publish error: ${error.message}`);
  });
}

function handleGatewayStream(stream, headers) {
  const routePath = String(headers[":path"] || "");

  if (routePath === "/eve_public.gateway.Requests/Ping") {
    handleUnaryPing(stream, "Requests");
    return true;
  }

  if (routePath === "/eve_public.gateway.Notices/Ping") {
    handleUnaryPing(stream, "Notices");
    return true;
  }

  if (routePath === "/eve_public.gateway.Events/Ping") {
    handleUnaryPing(stream, "Events");
    return true;
  }

  if (routePath === "/eve_public.gateway.Requests/Send") {
    handleRequestsSendStream(stream);
    return true;
  }

  if (routePath === "/eve_public.gateway.Notices/Consume") {
    handleNoticesConsumeStream(stream);
    return true;
  }

  if (routePath === "/eve_public.gateway.Events/Publish") {
    handleEventsPublishStream(stream);
    return true;
  }

  return false;
}

module.exports = {
  buildGatewayResponseForRequest,
  createGrpcFrame,
  handleGatewayStream,
  publishShipStateSetAllInBubbleNotice,
  publishShipStateSetNotice,
};
