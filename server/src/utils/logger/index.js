const pc = require("picocolors");

function info(c) {
  console.log(pc.blue(`[LOG]: ${c}`));
}

function debug(c) {
  console.log(pc.cyan(`[DBG]: ${c}`));
}

function warn(c) {
  console.log(pc.yellow(`[WRN]: ${c}`));
}

function err(c) {
  console.log(pc.red(`[ERR]: ${c}`));
}

function success(c) {
  console.log(pc.green(`[SUC]: ${c}`));
}

function logAsciiLogo() {
  console.log(
    pc.blue(
      `--------------------------------------------------      

     mmmmmm m    m mmmmmm         "         
     #      "m  m" #            mmm    mmm  
     #mmmmm  #  #  #mmmmm         #   #   " 
     #       "mm"  #        ##    #    """m 
     #mmmmm   ##   #mmmmm   ##    #   "mmm" 
                                  #         
                                ""
--------------------------------------------------`,
    ),
  );
}
module.exports = {
  info,
  debug,
  warn,
  err,
  error: err,
  success,
  logAsciiLogo,
};
