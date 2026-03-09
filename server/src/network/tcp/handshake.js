/**
 * HANDSHAKE CONTROLLER
 * (made with AI, revised by Icey)
 * 
 * only supports PLACEBO packets
 *
 * implements the 6 step login handshake modeled after EVEmu EVEClientSession.
 * (most of it is the same! surprising for 10 years of updates towards the game)
 *
 * flow:
 *   step 1: SERVER sends VersionExchangeServer         (on connect)
 *   step 2: CLIENT sends VersionExchangeClient         → SERVER validates, advances
 *   step 3: CLIENT sends VK command (None, "VK", key)  → SERVER validates, advances
 *   step 4: CLIENT sends CryptoRequestPacket           → SERVER sends "OK CC"
 *   step 5: CLIENT sends CryptoChallengePacket (login) → SERVER sends PyInt(2) + CryptoServerHandshake
 *   step 6: CLIENT sends CryptoHandshakeResult         → SERVER sends CryptoHandshakeAck + SessionInit
 * 
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  marshalEncode, // unused
  marshalDecode,
  wrapPacket,    // unused
  encodePacket,
  dictGet,
  strVal,
  bufVal,
} = require(path.join(__dirname, "./utils/marshal"));

// database
const database = require("../../newDatabase")

// The "marshaledNone" from EVE_Consts.h — a pickled Python None object
// 0x74 = cPickle header, then 4-byte length LE, then "None" as ASCII
const MARSHALED_NONE = Buffer.from([
  0x74, 0x04, 0x00, 0x00, 0x00, 0x4e, 0x6f, 0x6e, 0x65,
]);

// ---- handshake states
const State = {
  SEND_VERSION: "SEND_VERSION",
  WAIT_VERSION: "WAIT_VERSION",
  WAIT_COMMAND: "WAIT_COMMAND",
  WAIT_CRYPTO: "WAIT_CRYPTO",
  WAIT_AUTH: "WAIT_AUTH",
  WAIT_FUNC_RESULT: "WAIT_FUNC_RESULT",
  DONE: "DONE",
};

class EVEHandshake {
  constructor(socket) {
    this.socket = socket;
    this.state = State.SEND_VERSION;
    this.userId = 0;
    this.userName = "";
    this.clientId = 0;
    this.role = 0;
    this.address = socket.remoteAddress || "unknown";
    this.languageId = "EN";

    // encryption variables
    // WARNING: this was made in attempt for CryptoAPI support... failed horribly :)
    // only kept because removing them would mean rewriting ~100 lines
    this.sessionKey = null; // raw AES session key (Buffer)
    this.sessionIV = null; // raw AES session IV (Buffer)
    this.encrypted = false; // is connection encrypted?
  }




  /**
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm 
   *  #"   "   #    #      #   "#        #   
   *  "#mmm    #    #mmmmm #mmm#"        #   
   *      "#   #    #      #             #   
   *  "mmm#"   #    #mmmmm #           mmmmm
   * 
   * initiate the handshake: send VersionExchangeServer
   */
  start() {
    log.debug(`[HANDSHAKE] Starting handshake with ${this.address}`);

    const versionTuple = [
      config.eveBirthday,
      config.machoVersion,
      0, // user_count : online count? TODO: replace with amount of online users (variable)
      config.clientVersion, // float
      config.clientBuild,
      config.projectVersion,
      null, // update_info
    ];

    const packet = encodePacket(versionTuple);
    this.socket.write(packet);
    log.debug(`[HANDSHAKE] Sent VersionExchangeServer`);

    this.state = State.WAIT_VERSION;
  }

  /**
   * handle an incoming payload buffer (after stripping the 4byte length prefix)
   * returns { done: false } during handshake, { done: true } when complete
   */
  handlePacket(payload) {
    let decodable = payload;

    // line 69
    // do we even need this?
    if (this.encrypted && this.sessionKey && this.sessionIV) {
      try {
        decodable = this._decrypt(payload);

        // commented for flood prevention
        // log.debug(
        //   `[HANDSHAKE] Decrypted ${payload.length} bytes → ${decodable.length} bytes`,
        // );
      } catch (err) {
        log.err(`[HANDSHAKE] Decryption failed: ${err.message}`);
        // commented for flood prevention
        // log.debug(
        //   `[HANDSHAKE] Raw payload (first 64 bytes): ${payload.toString("hex").substring(0, 128)}`,
        // );
        // log.debug(
        //   `[HANDSHAKE] Session key (${this.sessionKey.length} bytes): ${this.sessionKey.toString("hex")}`,
        // );
        // log.debug(
        //   `[HANDSHAKE] Session IV  (${this.sessionIV.length} bytes): ${this.sessionIV.toString("hex")}`,
        // );
        return { done: false };
      }
    }

    let decoded;
    try {
      decoded = marshalDecode(decodable);
    } catch (err) {
      log.err(
        `[HANDSHAKE] Failed to decode packet in state ${this.state}: ${err.message}`,
      );
      // commented for flood prevention
      // log.debug(
      //   `[HANDSHAKE] Raw payload: ${decodable.toString("hex").substring(0, 100)}...`,
      // );
      return { done: false };
    }

    log.debug(
      `[HANDSHAKE] handshake state: ${this.state}`,
    );
    // commented for flood prevention
    // log.debug(
    //   `[HANDSHAKE] State: ${this.state} | Decoded: ${this._summarize(decoded)}`,
    // );

    // state mapper: what state are we currently in, and whats next?
    switch (this.state) {
      case State.WAIT_VERSION:
        return this._handleVersion(decoded);
      case State.WAIT_COMMAND:
        return this._handleCommand(decoded);
      case State.WAIT_CRYPTO:
        return this._handleCrypto(decoded, payload);
      case State.WAIT_AUTH:
        return this._handleAuthentication(decoded);
      case State.WAIT_FUNC_RESULT:
        return this._handleFuncResult(decoded);
      default:
        log.err(`[HANDSHAKE] unexpected state: ${this.state}`);
        return { done: false };
    }
  }




  /**                                           
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm  mmmmm 
   *  #"   "   #    #      #   "#        #      #   
   *  "#mmm    #    #mmmmm #mmm#"        #      #   
   *      "#   #    #      #             #      #   
   *  "mmm#"   #    #mmmmm #           mm#mm  mm#mm 
   *
   * client responds with VersionExchangeClient
   */
  _handleVersion(decoded) {
    // check if decoded is a valid VersionExchangeClient
    if (!Array.isArray(decoded) || decoded.length < 6) {
      log.err(
        `[HANDSHAKE] Invalid VersionExchangeClient: expected tuple of 6+`,
      );
      return { done: false };
    }

    // grab values from decoded
    const [birthday, machoVer, , versionNum, buildVer, projectVer] = decoded;

    log.debug(
      `[HANDSHAKE] Client version: birthday=${birthday} macho=${machoVer} ver=${versionNum} build=${buildVer} proj=${strVal(projectVer)}`,
    );

    if (birthday !== config.eveBirthday)
      log.warn(
        `[HANDSHAKE] Client birthday mismatch! Expected ${config.eveBirthday}, got ${birthday}`,
      );
    if (machoVer !== config.machoVersion)
      log.warn(
        `[HANDSHAKE] Client macho_version mismatch! Expected ${config.machoVersion}, got ${machoVer}`,
      );

    // update state
    this.state = State.WAIT_COMMAND;
    log.debug(`[HANDSHAKE] Version accepted, waiting for command (VK/QC)`);

    return { done: false };
  }




  /**                                                
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm  mmmmm  mmmmm 
   *  #"   "   #    #      #   "#        #      #      #   
   *  "#mmm    #    #mmmmm #mmm#"        #      #      #   
   *      "#   #    #      #             #      #      #   
   *  "mmm#"   #    #mmmmm #           mm#mm  mm#mm  mm#mm 
   *
   * client sends command tuple             
   */
  _handleCommand(decoded) {
    if (!Array.isArray(decoded)) {
      log.err(`[HANDSHAKE] Invalid command: expected tuple`);
      return { done: false };
    }

    if (decoded.length === 2) {
      // QC (Queue Check)
      const cmdType = strVal(decoded[1]);
      log.debug(`[HANDSHAKE] Got Queue Check command (${cmdType})`);
      const queuePos = encodePacket(0);
      this.socket.write(queuePos);
      this.start();
      return { done: false };
    }

    if (decoded.length === 3) {
      // VK command: (None, "VK", vipKey)
      const cmdType = strVal(decoded[1]);
      const vipKeyBuf = bufVal(decoded[2]);

      // commented for flood prevention
      // log.debug(
      //   `[HANDSHAKE] Got ${cmdType} command, vipKey=${vipKeyBuf ? vipKeyBuf.length + " bytes" : "null"}`,
      // );
      // if (vipKeyBuf) {
      //   log.debug(`[HANDSHAKE] VIP key hex: ${vipKeyBuf.toString("hex")}`);
      // }

      // update state
      this.state = State.WAIT_CRYPTO;
      log.debug(`[HANDSHAKE] VK accepted, waiting for crypto request`);
      return { done: false };
    }

    log.err(`[HANDSHAKE] Unknown command tuple length: ${decoded.length}`);
    return { done: false };
  }




  /**                                               
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm  m    m
   *  #"   "   #    #      #   "#        #    "m  m"
   *  "#mmm    #    #mmmmm #mmm#"        #     #  # 
   *      "#   #    #      #             #     "mm" 
   *  "mmm#"   #    #mmmmm #           mm#mm    ##  
   * 
   * client sends CryptoRequestPacket
   */
  _handleCrypto(decoded, rawPayload) {
    if (!Array.isArray(decoded) || decoded.length < 2) {
      log.err(`[HANDSHAKE] Invalid CryptoRequestPacket: expected tuple of 2`);
      return { done: false };
    }

    const keyVersion = strVal(decoded[0]);
    const keyParams = decoded[1]; // dict

    log.debug(`[HANDSHAKE] Crypto request: keyVersion="${keyVersion}"`);

    // do we even need this?
    if (keyParams && keyParams.type === "dict") {
      const sessionKeyVal = dictGet(keyParams, "crypting_sessionkey");
      const sessionIVVal = dictGet(keyParams, "crypting_sessioniv");

      if (sessionKeyVal) {
        this.sessionKey = bufVal(sessionKeyVal);
        log.debug(
          `[HANDSHAKE] Session key: ${this.sessionKey ? this.sessionKey.length + " bytes" : "null"}`,
        );
        if (this.sessionKey) {
          log.debug(
            `[HANDSHAKE] Session key hex: ${this.sessionKey.toString("hex").substring(0, 64)}...`,
          );
        }
      }

      if (sessionIVVal) {
        this.sessionIV = bufVal(sessionIVVal);
        log.debug(
          `[HANDSHAKE] Session IV: ${this.sessionIV ? this.sessionIV.length + " bytes" : "null"}`,
        );
        if (this.sessionIV) {
          log.debug(
            `[HANDSHAKE] Session IV hex: ${this.sessionIV.toString("hex").substring(0, 64)}...`,
          );
        }
      }

      // If we got key and IV, encryption is active for subsequent packets
      if (this.sessionKey && this.sessionIV) {
        this.encrypted = true;
        log.debug(
          `[HANDSHAKE] Encryption mode: ACTIVE (key=${this.sessionKey.length}B, iv=${this.sessionIV.length}B)`,
        );

        // The raw key/IV might be longer than needed for AES.
        // AES-256-CBC needs exactly 32-byte key and 16-byte IV.
        // Try using the first 32 bytes of the key and first 16 bytes of the IV.
        if (this.sessionKey.length > 32) {
          log.debug(
            `[HANDSHAKE] Trimming session key from ${this.sessionKey.length} to 32 bytes`,
          );
          this.sessionKey = this.sessionKey.slice(0, 32);
        }
        if (this.sessionIV.length > 16) {
          log.debug(
            `[HANDSHAKE] Trimming session IV from ${this.sessionIV.length} to 16 bytes`,
          );
          this.sessionIV = this.sessionIV.slice(0, 16);
        }

        log.debug(
          `[HANDSHAKE] Final key (${this.sessionKey.length}B): ${this.sessionKey.toString("hex")}`,
        );
        log.debug(
          `[HANDSHAKE] Final IV  (${this.sessionIV.length}B): ${this.sessionIV.toString("hex")}`,
        );
      }
    }

    // Send "OK CC"
    const okPacket = encodePacket("OK CC");
    this.socket.write(okPacket);
    log.debug(`[HANDSHAKE] Sent "OK CC" — waiting for login credentials`);

    // update state
    this.state = State.WAIT_AUTH;
    return { done: false };
  }




  /**                                  
   *   mmmm mmmmmmm mmmmmm mmmmm       m    m
   *  #"   "   #    #      #   "#      "m  m"
   *  "#mmm    #    #mmmmm #mmm#"       #  # 
   *      "#   #    #      #            "mm" 
   *  "mmm#"   #    #mmmmm #             ##
   * 
   * client sends CryptoChallengePacket (Login)
   * server responds with PyInt(2) + CryptoServerHandshake back to back
   */
  _handleAuthentication(decoded) {
    if (!Array.isArray(decoded) || decoded.length < 2) {
      log.err(`[HANDSHAKE] Invalid CryptoChallengePacket: expected tuple of 2`);
      return { done: false };
    }

    // grab values from decoded
    const loginData = decoded[1];
    const userName = strVal(dictGet(loginData, "user_name") || "");
    const passwordHash = Buffer.from(dictGet(loginData, "user_password_hash"), "hex").toString("hex")
    // const userPassword = strVal(dictGet(loginData, "user_password") || ""); // user_password does not exist as the client only sends user_password_hash
    const userLanguageId = strVal(
      dictGet(loginData, "user_languageid") || "EN",
    ); // returns a json object TODO: decode json and get language id

    /**
     * the client sends a hashed password, so instead of checking the password
     * we will check the hash against the database's hash. the server never gets
     * to know the password. when we create an account (dev mode) we will put the 
     * hash in the databse and use it to match when user attempts to log in.
     */


    // get the raw password hash as hex (it's binary data, not a UTF-8 string)
    // let userPasswordHashHex = "";
    // if (Buffer.isBuffer(rawHash)) {
    //   userPasswordHashHex = rawHash.toString("hex");
    // } else if (rawHash && typeof rawHash === "string") {
    //   userPasswordHashHex = Buffer.from(rawHash, "binary").toString("hex");
    // }

    log.debug(
      `[HANDSHAKE] Login attempt: user="${userName}" lang="${userLanguageId}"`,
    );

    // send password version (PyInt 2 = "i want hashed passwords")
    // this is required for some reason
    const pwVersionPacket = encodePacket(2);
    this._sendPacket(pwVersionPacket);
    log.debug(`[HANDSHAKE] Sent password version (2)`);

    // validate credentials

    // OLD DB STUFF
    // const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    // const accounts = db.accounts || {};

    const accountResult = database.read("accounts", "/")
    const accounts = accountResult.success ? accountResult.data : {}

    // devmode is enabled: auto create account
    if (!accounts[userName]) {
      if (config.devMode) {
        log.warn(
          `[HANDSHAKE] Account "${userName}" not found - auto creating for dev`,
        );
        accounts[userName] = {
          passwordhash: passwordHash,
          id: Object.keys(accounts).length + 1,
          role: "6917529029788565504", // TODO: change to owner / dev role
          banned: false,
        };
      }

      database.write("accounts", "/", accounts);
    }

    const account = accounts[userName];
    let shouldContinue = true;
    if (config.devMode) {
      log.debug(`[HANDSHAKE] Password accepted for "${userName}" (dev mode)`);
    } else {
      if (account.passwordhash !== passwordHash) {
        log.warn(
          `[HANDSHAKE] Password mismatch for "${userName}"`,
        );
        shouldContinue = false;
      }
    }

    // do we really need this?
    if (account.banned) {
      log.err(`[HANDSHAKE] Account "${userName}" is banned!`);
      shouldContinue = false;
    }

    if (!shouldContinue) {
      log.warn(`[HANDSHAKE] Login attempt failed for "${userName}"`);
      this.socket.end();
      return { done: false };
    }

    this.userId = account.id;
    this.userName = userName;
    this.clientId = 1000000 * account.id + config.proxyNodeId;
    this.role = account.role;
    this.languageId = userLanguageId;

    // send CryptoServerHandshake
    const serverHandshake = [
      "", // serverChallenge
      [MARSHALED_NONE, false], // func tuple: [marshaled_code, verification]
      { type: "dict", entries: [] }, // context
      {
        type: "dict",
        entries: [
          ["challenge_responsehash", "55087"],
          ["macho_version", config.machoVersion],
          ["boot_version", config.clientVersion],
          ["boot_build", config.clientBuild],
          ["boot_codename", config.projectCodename],
          ["boot_region", config.projectRegion],
          ["cluster_usercount", 1],
          ["proxy_nodeid", config.proxyNodeId],
          ["user_logonqueueposition", 1],
          [
            "config_vals",
            {
              type: "dict",
              entries: [["imageserverurl", config.imageServerUrl]],
            },
          ],
        ],
      },
    ];

    const handshakePacket = encodePacket(serverHandshake);
    // commented for flood prevention
    // log.debug(
    //   `[HANDSHAKE] CryptoServerHandshake hex (${handshakePacket.length} bytes): ${handshakePacket.toString("hex")}`,
    // );
    this._sendPacket(handshakePacket);
    log.debug(`[HANDSHAKE] Sent CryptoServerHandshake for user "${userName}"`);

    // update state
    this.state = State.WAIT_FUNC_RESULT;
    return { done: false };
  }




  /**                                        
   *   mmmm mmmmmmm mmmmmm mmmmm       m    m mmmmm 
   *  #"   "   #    #      #   "#      "m  m"   #   
   *  "#mmm    #    #mmmmm #mmm#"       #  #    #   
   *      "#   #    #      #            "mm"    #   
   *  "mmm#"   #    #mmmmm #             ##   mm#mm 
   * 
   * client sends CryptoHandshakeResult                               
   */
  _handleFuncResult(decoded) {
    log.debug(`[HANDSHAKE] Received CryptoHandshakeResult`);

    if (Array.isArray(decoded)) {
      log.debug(`[HANDSHAKE] Result tuple length: ${decoded.length}`);
    }

    // send CryptoHandshakeAck
    const ack = {
      type: "dict",
      entries: [
        ["live_updates", { type: "list", items: [] }],
        [
          "session_init",
          {
            type: "dict",
            entries: [
              ["languageID", this.languageId],
              ["userid", this.userId],
              ["maxSessionTime", null],
              ["userType", 30],
              ["role", { type: "long", value: BigInt(this.role) }],
              ["address", this.address],
              ["inDetention", null],
            ],
          },
        ],
        ["sessionID", { type: "long", value: BigInt(0) }],
        ["client_hash", null],
        ["user_clientid", { type: "long", value: BigInt(this.clientId) }],
      ],
    };

    const ackPacket = encodePacket(ack);
    this._sendPacket(ackPacket);
    log.debug(`[HANDSHAKE] Sent CryptoHandshakeAck`);

    this.state = State.DONE;
    log.success(
      `[HANDSHAKE] Handshake complete for "${this.userName}" (id=${this.userId})`,
    );

    return { done: true };
  }

  // ─── Encryption/Decryption ───────────────────────────────────────────────

  _decrypt(data) {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      this.sessionKey,
      this.sessionIV,
    );
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    // Update IV for CBC chaining (last ciphertext block becomes next IV)
    this.sessionIV = data.slice(-16);
    return decrypted;
  }

  _encrypt(data) {
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      this.sessionKey,
      this.sessionIV,
    );
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    // Update IV for CBC chaining
    this.sessionIV = encrypted.slice(-16);
    return encrypted;
  }

  /**
   * Send a framed packet, encrypting the payload if encryption is active.
   * The input `packet` should already be framed (4-byte length + payload).
   */
  _sendPacket(packet) {
    if (this.encrypted && this.sessionKey && this.sessionIV) {
      // The payload to encrypt is everything after the 4-byte length header
      const payload = packet.slice(4);
      const encrypted = this._encrypt(payload);
      // Re-frame with the new encrypted length
      const header = Buffer.alloc(4);
      header.writeUInt32LE(encrypted.length, 0);
      this.socket.write(Buffer.concat([header, encrypted]));
    } else {
      this.socket.write(packet);
    }
  }

  /**
   * Summarize a decoded value for debug logging (truncate long data).
   */
  _summarize(val) {
    const str = JSON.stringify(val, (key, value) => {
      // Truncate Buffers in JSON output
      if (value && value.type === "Buffer" && Array.isArray(value.data)) {
        return `<Buffer ${value.data.length}B>`;
      }
      return value;
    });
    if (str && str.length > 300) return str.substring(0, 300) + "...";
    return str;
  }
}

module.exports = EVEHandshake;
