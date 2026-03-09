/**
 * DATABASE CONTROLLER:
 * controls data being read and written to the json db
 */

const path = require("path")
const fs = require("fs")

const config = require("../config")
const log = require("../utils/logger")

function read(table, pth) {
	// example usage: database.read("users", "/123")

	// get file
	const file = path.join(__dirname, "data", table)

	// check if file exists, warn and return null if not
	if (!fs.existsSync(file)) {
		log.warn(`[DATABASE] database table: '${table}' not found!`)
		return {
			success: false,
			errorMsg: "TABLE_NOT_FOUND",
			data: null
		}
	}

	// delete cached data, get table and success
	delete require.cache[require.resolve(file)]
	const tableFile = require(file)

	// get data
	const { success, errorMsg, data } = tableFile.read(pth)

	// return data
	return {
		success: success,
		errorMsg: errorMsg,
		data: data
	}
}

function write(table, pth, data) {
	// example usage: database.write("users", "/123", {name: "John Doe"})

	// get file
	const file = path.join(__dirname, "data", table)

	// check if file exists, warn and return null if not
	if (!fs.existsSync(file)) {
		log.warn(`[DATABASE] database table: '${table}' not found!`)
		return {
			success: false,
			errorMsg: "TABLE_NOT_FOUND"
		}
	}

	// delete cached data, get table and success
	delete require.cache[require.resolve(file)]
	const tableFile = require(file)
	const { success, errorMsg } = tableFile.write(pth, data)

	// return success
	return {
		success: success,
		errorMsg: errorMsg
	}
}

function remove(table, pth) {
	// example usage: database.remove("users", "/123")

	// get file
	const file = path.join(__dirname, "data", table)

	// check if file exists, warn and return null if not
	if (!fs.existsSync(file)) {
		log.warn(`[DATABASE] database table: '${table}' not found!`)
		return {
			success: false,
			errorMsg: "TABLE_NOT_FOUND"
		}
	}

	// delete cached data, get table and success
	delete require.cache[require.resolve(file)]
	const tableFile = require(file)
	const { success, errorMsg } = tableFile.remove(pth)

	// return success
	return {
		success: success,
		errorMsg: errorMsg
	}
}

module.exports = {
	read,
	write,
	remove
}