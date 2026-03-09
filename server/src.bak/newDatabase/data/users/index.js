/**
 * UNIVERSAL DATABASE TABLE CONTROLLER:
 * read or write actual data
 */

const fs = require("fs")
const path = require("path")

const log = require("../../utils/logger")
const dbFile = path.join(__dirname, "data.json")

// ensure file exists, make new file if not
function ensureFile() {
	if (!fs.existsSync(dbFile)) {
		fs.writeFileSync(dbFile, JSON.stringify({}, null, 2))
	}
}

// interpret path to corresponding location in json
function getSegments(pathKey) {
	return pathKey.split("/").filter(Boolean)
}

function read(pathKey) {
	try {
		ensureFile()

		// read the json
		const db = JSON.parse(fs.readFileSync(dbFile))

		// interpret path, then get data
		const segments = getSegments(pathKey)
		let current = db
		for (const segment of segments) {
			if (!(segment in current)) {
				return {
					success: false,
					errorMsg: "ENTRY_NOT_FOUND",
					data: null
				}
			}
			current = current[segment]
		}

		// return success and data
		return {
			success: true,
			errorMsg: null,
			data: current
		}
	} catch (err) {
		log.error("[DATABASE READ ERROR]", err)
		return {
			success: false,
			errorMsg: "READ_ERROR",
			data: null
		}
	}
}

function write(pathKey, data) {
	try {
		ensureFile()

		// read the json
		const db = JSON.parse(fs.readFileSync(dbFile))

		// interpret path, then get data
		const segments = getSegments(pathKey)
		let current = db
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i]
			if (!(segment in current)) {
				current[segment] = {}
			}
			current = current[segment]
		}

		// write data
		const finalKey = segments[segments.length - 1]
		current[finalKey] = data
		fs.writeFileSync(dbFile, JSON.stringify(db, null, 2))

		// return success
		return {
			success: true,
			errorMsg: null
		}
	} catch (err) {
		log.error("[DATABASE WRITE ERROR]", err)
		return {
			success: false,
			errorMsg: "WRITE_ERROR"
		}
	}
}

function remove(pathKey) {
	try {
		ensureFile()

		// read the json
		const db = JSON.parse(fs.readFileSync(dbFile))

		// interpret the path, then get data
		const segments = getSegments(pathKey)
		let current = db
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i]
			if (!(segment in current)) {
				return {
					success: false,
					errorMsg: "ENTRY_NOT_FOUND"
				}
			}
			current = current[segment]
		}

		// make sure data we want to delete is there
		const finalKey = segments[segments.length - 1]
		if (!(finalKey in current)) {
			return {
				success: false,
				errorMsg: "ENTRY_NOT_FOUND"
			}
		}

		// delete the data
		delete current[finalKey]
		fs.writeFileSync(dbFile, JSON.stringify(db, null, 2))

		// return success
		return {
			success: true,
			errorMsg: null
		}
	} catch (err) {
		log.error("[DATABASE DELETE ERROR]", err)
		return {
			success: false,
			errorMsg: "DELETE_ERROR"
		}
	}
}

module.exports = {
	read,
	write,
	remove
}