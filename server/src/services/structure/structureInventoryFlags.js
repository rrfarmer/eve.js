const STRUCTURE_SERVICE_SLOT_FLAGS = Object.freeze([
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  171,
]);

const STRUCTURE_FUEL_FLAG = 172;
const STRUCTURE_DEED_FLAG = 180;
const STRUCTURE_AMMO_FLAG = 5;
const STRUCTURE_FIGHTER_FLAG = 158;
const STRUCTURE_MOON_MATERIAL_FLAG = 186;
const GROUP_STRUCTURE_DEED = 4086;
const GROUP_MOON_MATERIALS = 427;

const STRUCTURE_CONTEXT_BAY_FLAGS = Object.freeze([
  STRUCTURE_AMMO_FLAG,
  STRUCTURE_FIGHTER_FLAG,
  STRUCTURE_FUEL_FLAG,
  STRUCTURE_DEED_FLAG,
  STRUCTURE_MOON_MATERIAL_FLAG,
]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function isStructureServiceFlag(flagID) {
  return STRUCTURE_SERVICE_SLOT_FLAGS.includes(toInt(flagID, 0));
}

function isStructureFuelFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_FUEL_FLAG;
}

function isStructureDeedFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_DEED_FLAG;
}

function isStructureAmmoFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_AMMO_FLAG;
}

function isStructureFighterFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_FIGHTER_FLAG;
}

function isStructureMoonMaterialFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_MOON_MATERIAL_FLAG;
}

function isStructureOwnedBayFlag(flagID) {
  return (
    isStructureServiceFlag(flagID) ||
    isStructureFuelFlag(flagID) ||
    isStructureDeedFlag(flagID)
  );
}

function isStructureContextOwnedBayFlag(flagID) {
  return (
    isStructureOwnedBayFlag(flagID) ||
    STRUCTURE_CONTEXT_BAY_FLAGS.includes(toInt(flagID, 0))
  );
}

module.exports = {
  STRUCTURE_SERVICE_SLOT_FLAGS,
  STRUCTURE_FUEL_FLAG,
  STRUCTURE_DEED_FLAG,
  STRUCTURE_AMMO_FLAG,
  STRUCTURE_FIGHTER_FLAG,
  STRUCTURE_MOON_MATERIAL_FLAG,
  STRUCTURE_CONTEXT_BAY_FLAGS,
  GROUP_STRUCTURE_DEED,
  GROUP_MOON_MATERIALS,
  isStructureServiceFlag,
  isStructureFuelFlag,
  isStructureDeedFlag,
  isStructureAmmoFlag,
  isStructureFighterFlag,
  isStructureMoonMaterialFlag,
  isStructureOwnedBayFlag,
  isStructureContextOwnedBayFlag,
};
