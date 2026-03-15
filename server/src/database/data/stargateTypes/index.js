const path = require("path");

const createTableController = require(path.join(
  __dirname,
  "../../createTableController",
));

module.exports = createTableController(__dirname);
