const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { normalizeNumber, normalizeText } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterWallet,
  setCharacterPlexBalance,
} = require(path.join(__dirname, "./walletState"));

const STORE_ID_INGAME = 4;
const PLEX_CURRENCY = "PLX";
const CATEGORY_ROOT_SERVICES = 9000000;
const CATEGORY_GAMETIME = 9000001;
const CATEGORY_ACCOUNT_SERVICES = 9000002;
const PRODUCT_OMEGA = 9100001;
const PRODUCT_MCT = 9100002;
const PRODUCT_SOULBOUND_MCT = 9100003;
const OFFER_OMEGA = 9200001;
const OFFER_MCT = 9200002;
const OFFER_SOULBOUND_MCT = 9200003;

function getKwarg(kwargs, key) {
  if (!kwargs || kwargs.type !== "dict" || !Array.isArray(kwargs.entries)) {
    return undefined;
  }

  const match = kwargs.entries.find((entry) => entry[0] === key);
  return match ? match[1] : undefined;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toMarshalValue(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return {
      type: "list",
      items: value.map((entry) => toMarshalValue(entry)),
    };
  }

  if (typeof value === "object") {
    if (typeof value.type === "string") {
      return value;
    }

    return {
      type: "dict",
      entries: Object.entries(value).map(([key, entryValue]) => [
        key,
        toMarshalValue(entryValue),
      ]),
    };
  }

  return null;
}

function buildCatalog(storeId = STORE_ID_INGAME) {
  const hrefPrefix = `/store/${storeId}`;

  const categories = [
    {
      id: CATEGORY_ROOT_SERVICES,
      name: "Services",
      href: `${hrefPrefix}/categories/services`,
      parent: null,
      tags: [],
    },
    {
      id: CATEGORY_GAMETIME,
      name: "Game Time",
      href: `${hrefPrefix}/categories/game-time`,
      parent: { id: CATEGORY_ROOT_SERVICES },
      tags: ["gametime"],
    },
    {
      id: CATEGORY_ACCOUNT_SERVICES,
      name: "Account Services",
      href: `${hrefPrefix}/categories/account-services`,
      parent: { id: CATEGORY_ROOT_SERVICES },
      tags: [],
    },
  ];

  const products = [
    {
      id: PRODUCT_OMEGA,
      name: "Omega Clone State",
      href: `${hrefPrefix}/products/omega-clone-state`,
    },
    {
      id: PRODUCT_MCT,
      name: "Multiple Character Training",
      href: `${hrefPrefix}/products/multiple-character-training`,
    },
    {
      id: PRODUCT_SOULBOUND_MCT,
      name: "Multiple Character Training Slot",
      href: `${hrefPrefix}/products/multiple-character-training-slot`,
    },
  ];

  const offers = [
    {
      id: OFFER_OMEGA,
      name: "Omega Clone State",
      description: "Activate Omega clone state access.",
      href: `${hrefPrefix}/offers/omega-clone-state`,
      offerPricings: [
        {
          currency: PLEX_CURRENCY,
          price: 500,
          basePrice: 500,
        },
      ],
      imageUrl: "res:/UI/Texture/classes/PlexVault/UpgradeOmega.png",
      products: [
        {
          id: PRODUCT_OMEGA,
          typeId: 0,
          quantity: 1,
          productName: "Omega Clone State",
          imageUrl: "res:/UI/Texture/classes/PlexVault/UpgradeOmega.png",
        },
      ],
      categories: [{ id: CATEGORY_GAMETIME }],
      label: null,
      thirdpartyinfo: null,
      canPurchase: true,
      singlePurchase: false,
    },
    {
      id: OFFER_MCT,
      name: "Multiple Character Training",
      description: "Unlock an additional training slot.",
      href: `${hrefPrefix}/offers/multiple-character-training`,
      offerPricings: [
        {
          currency: PLEX_CURRENCY,
          price: 485,
          basePrice: 485,
        },
      ],
      imageUrl: "res:/UI/Texture/Icons/multiple_training.png",
      products: [
        {
          id: PRODUCT_MCT,
          typeId: 34133,
          quantity: 1,
          productName: "Multiple Character Training",
          imageUrl: "res:/UI/Texture/Icons/multiple_training.png",
        },
      ],
      categories: [{ id: CATEGORY_ACCOUNT_SERVICES }],
      label: null,
      thirdpartyinfo: null,
      canPurchase: true,
      singlePurchase: false,
    },
    {
      id: OFFER_SOULBOUND_MCT,
      name: "Multiple Character Training Slot",
      description: "Unlock an additional training slot.",
      href: `${hrefPrefix}/offers/multiple-character-training-slot`,
      offerPricings: [
        {
          currency: PLEX_CURRENCY,
          price: 485,
          basePrice: 485,
        },
      ],
      imageUrl: "res:/UI/Texture/Icons/multiple_training.png",
      products: [
        {
          id: PRODUCT_SOULBOUND_MCT,
          typeId: 63188,
          quantity: 1,
          productName: "Multiple Character Training Slot",
          imageUrl: "res:/UI/Texture/Icons/multiple_training.png",
        },
      ],
      categories: [{ id: CATEGORY_ACCOUNT_SERVICES }],
      label: null,
      thirdpartyinfo: null,
      canPurchase: true,
      singlePurchase: false,
    },
  ];

  return {
    categories,
    products,
    offers,
  };
}

function getCatalogForStore(storeId) {
  const normalizedStoreId = normalizeNumber(storeId, STORE_ID_INGAME);
  return buildCatalog(normalizedStoreId || STORE_ID_INGAME);
}

function findOfferById(storeId, offerId) {
  const catalog = getCatalogForStore(storeId);
  const numericOfferId = normalizeNumber(offerId, 0);
  return (
    catalog.offers.find((offer) => normalizeNumber(offer.id, 0) === numericOfferId) ||
    null
  );
}

function getOfferPrice(offer, currency) {
  if (!offer || !Array.isArray(offer.offerPricings)) {
    return null;
  }

  const normalizedCurrency = normalizeText(currency, PLEX_CURRENCY).toUpperCase();
  const pricing = offer.offerPricings.find(
    (candidate) =>
      normalizeText(candidate && candidate.currency, "").toUpperCase() ===
      normalizedCurrency,
  );
  if (!pricing) {
    return null;
  }

  return Math.max(0, Math.trunc(normalizeNumber(pricing.price, 0)));
}

class StoreManagerService extends BaseService {
  constructor() {
    super("storeManager");
  }

  Handle_get_offers(args) {
    const storeId = normalizeNumber(args && args[0], STORE_ID_INGAME);
    const offers = cloneValue(getCatalogForStore(storeId).offers);
    log.info(`[StoreManager] get_offers store_id=${storeId} count=${offers.length}`);
    return toMarshalValue(offers);
  }

  Handle_get_categories(args) {
    const storeId = normalizeNumber(args && args[0], STORE_ID_INGAME);
    const categories = cloneValue(getCatalogForStore(storeId).categories);
    log.info(
      `[StoreManager] get_categories store_id=${storeId} count=${categories.length}`,
    );
    return toMarshalValue(categories);
  }

  Handle_get_products(args) {
    const storeId = normalizeNumber(args && args[0], STORE_ID_INGAME);
    const products = cloneValue(getCatalogForStore(storeId).products);
    log.info(
      `[StoreManager] get_products store_id=${storeId} count=${products.length}`,
    );
    return toMarshalValue(products);
  }

  Handle_buy_offer(args, session, kwargs) {
    const offerId = normalizeNumber(args && args[0], 0);
    const currency = normalizeText(args && args[1], PLEX_CURRENCY).toUpperCase();
    const quantity = Math.max(1, Math.trunc(normalizeNumber(args && args[2], 1)));
    const storeId = normalizeNumber(
      getKwarg(kwargs, "store_id"),
      STORE_ID_INGAME,
    );
    const characterId = normalizeNumber(
      getKwarg(kwargs, "from_character_id"),
      session && session.characterID,
    );

    if (!characterId || currency !== PLEX_CURRENCY) {
      log.warn(
        `[StoreManager] buy_offer rejected offer_id=${offerId} currency=${currency} character=${characterId}`,
      );
      return null;
    }

    const offer = findOfferById(storeId, offerId);
    if (!offer) {
      log.warn(
        `[StoreManager] buy_offer missing offer_id=${offerId} store_id=${storeId}`,
      );
      return null;
    }

    const unitPrice = getOfferPrice(offer, currency);
    if (unitPrice === null) {
      log.warn(
        `[StoreManager] buy_offer unsupported currency offer_id=${offerId} currency=${currency}`,
      );
      return null;
    }

    const currentWallet = getCharacterWallet(characterId);
    if (!currentWallet) {
      return null;
    }

    const totalPrice = unitPrice * quantity;
    if (currentWallet.plexBalance < totalPrice) {
      log.warn(
        `[StoreManager] buy_offer insufficient PLEX character=${characterId} price=${totalPrice} balance=${currentWallet.plexBalance}`,
      );
      return null;
    }

    const balanceResult = setCharacterPlexBalance(
      characterId,
      currentWallet.plexBalance - totalPrice,
    );
    if (!balanceResult.success) {
      return null;
    }

    log.info(
      `[StoreManager] buy_offer character=${characterId} offer_id=${offerId} qty=${quantity} ` +
        `price=${totalPrice} remaining=${balanceResult.data.plexBalance}`,
    );

    return toMarshalValue({
      success: true,
      offer_id: offerId,
      quantity,
      currency,
      spent: totalPrice,
      balance: balanceResult.data.plexBalance,
    });
  }

  Handle_GetOffers(args, session, kwargs) {
    return this.Handle_get_offers(args, session, kwargs);
  }

  Handle_GetCategories(args, session, kwargs) {
    return this.Handle_get_categories(args, session, kwargs);
  }

  Handle_GetProducts(args, session, kwargs) {
    return this.Handle_get_products(args, session, kwargs);
  }

  Handle_BuyOffer(args, session, kwargs) {
    return this.Handle_buy_offer(args, session, kwargs);
  }
}

module.exports = StoreManagerService;
