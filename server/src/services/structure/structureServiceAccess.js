const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SERVICE_NAME_BY_ID,
} = require(path.join(__dirname, "./structureConstants"));
const {
  characterHasStructureService,
} = require(path.join(__dirname, "./structurePayloads"));

const SERVICE_LABELS = Object.freeze({
  market: "Market",
  medical: "Clone Bay",
  jump_clone: "Jump Clone",
  offices: "Office",
  loyalty_store: "Loyalty Store",
});

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric);
  }
  return fallback;
}

function resolvePlayerStructureByLocationID(locationID, options = {}) {
  const numericLocationID = normalizePositiveInteger(locationID, 0);
  if (!numericLocationID) {
    return null;
  }
  if (worldData.getStationByID(numericLocationID)) {
    return null;
  }
  return structureState.getStructureByID(numericLocationID, {
    refresh: options.refresh !== false,
  });
}

function getServiceLabel(serviceID) {
  const serviceName = STRUCTURE_SERVICE_NAME_BY_ID[normalizePositiveInteger(serviceID, 0)];
  if (!serviceName) {
    return "Structure";
  }
  return SERVICE_LABELS[serviceName] || serviceName
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStructureServiceAccess(session, locationID, serviceID, options = {}) {
  const structure = resolvePlayerStructureByLocationID(locationID, options);
  if (!structure) {
    return {
      isStructure: false,
      allowed: true,
      structure: null,
    };
  }
  return {
    isStructure: true,
    allowed: characterHasStructureService(session, structure, serviceID),
    structure,
  };
}

function hasStructureServiceAtLocation(session, locationID, serviceID, options = {}) {
  return getStructureServiceAccess(session, locationID, serviceID, options).allowed;
}

function throwStructureServiceUnavailable(serviceID, message = null) {
  throwWrappedUserError("CustomNotify", {
    notify:
      message ||
      `The ${getServiceLabel(serviceID)} service is not available at this structure.`,
  });
}

function requireStructureServiceAtLocation(session, locationID, serviceID, options = {}) {
  const access = getStructureServiceAccess(session, locationID, serviceID, options);
  if (access.isStructure && !access.allowed) {
    throwStructureServiceUnavailable(serviceID, options.message);
  }
  return access;
}

module.exports = {
  resolvePlayerStructureByLocationID,
  getStructureServiceAccess,
  hasStructureServiceAtLocation,
  requireStructureServiceAtLocation,
  throwStructureServiceUnavailable,
};
