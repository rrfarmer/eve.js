/**
 * EVE.js — Main Entry Point
 *
 * Initializes the service manager, registers core game services,
 * and starts the TCP server.
 */

const fs = require("fs");
const path = require("path");
const log = require(path.join(__dirname, "./src/utils/logger"));
const config = require(path.join(__dirname, "./src/config"));

// Service framework
const ServiceManager = require(
  path.join(__dirname, "./src/services/serviceManager"),
);

// network
const startTCPServer = require(path.join(__dirname, "./src/network/tcp"));

// main startup

log.logAsciiLogo();
console.log();
log.info("starting eve.js...");
console.log();

// Display version info
log.debug(`Project: ${config.projectVersion}`);
log.debug(`Client Version: ${config.clientVersion}`);
log.debug(`Client Build: ${config.clientBuild}`);
log.debug(`MachoNet Version: ${config.machoVersion}`);
console.log();

// create and populate service manager
const serviceManager = new ServiceManager();

// register services
const servicesDir = path.join(__dirname, "./src/services");

function loadServices(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      loadServices(fullPath);
    } else if (
      file.isFile() &&
      file.name.endsWith("Service.js") &&
      file.name !== "baseService.js" &&
      file.name !== "serviceManager.js"
    ) {
      try {
        const exported = require(fullPath);
        if (typeof exported === "function") {
          serviceManager.register(new exported());
        } else if (typeof exported === "object" && exported !== null) {
          for (const key in exported) {
            if (typeof exported[key] === "function") {
              serviceManager.register(new exported[key]());
            }
          }
        }
      } catch (err) {
        log.err(`failed to load service from ${fullPath}: ${err.message}`);
      }
    }
  }
}

loadServices(servicesDir);

log.success(`registered ${serviceManager.count} services`);
console.log();

// register secondary services
const secondaryServicesDir = path.join(__dirname, "./src/_secondary");

function loadSecondaryServices(dir) {
  if (!fs.existsSync(dir)) {
    log.debug(`secondary services directory not found: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      loadSecondaryServices(fullPath);
      continue;
    }

    if (file.isFile() && file.name.endsWith(".js")) {
      try {
        const service = require(fullPath);
        if (service.enabled === true) {
          log.debug(`starting secondary service: ${service.serviceName}`);
          service.exec();
        } else {
          log.debug(
            `skipping service: ${service.serviceName} as it is not enabled`,
          );
        }
        console.log();
      } catch (err) {
        log.err(
          `failed to start secondary service ${fullPath}: ${err.message}`,
        );
        console.log();
      }
    }
  }
}

loadSecondaryServices(secondaryServicesDir);

// Start the TCP server with the service manager
startTCPServer(serviceManager);
