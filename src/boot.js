// Entry point: starts the newest small update package (src/app-package.js) if there is one for
// this Electron version, else the code built into the exe/.app. Keep this file small and stable:
// installed apps run their own copy of it for good, packages only replace what it loads.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const pkg = require('./app-package');

const userData = app.getPath('userData');
const debug = (line) => {
  if (process.env.FARMIES_DEBUG) fs.appendFileSync(path.join(userData, 'debug.log'), `${line}\n`);
};

let chosen = null;
try {
  chosen = app.isPackaged ? pkg.choose(userData, app.getVersion(), process.versions.electron) : null;
  if (chosen && !pkg.countStart(chosen.dir)) {
    pkg.markBad(userData, chosen.version);
    debug(`boot package ${chosen.version} given up after failed starts`);
    chosen = null;
  }
} catch (e) {
  debug(`error boot ${e.stack || e}`);
  chosen = null;
}

if (chosen) {
  debug(`boot package ${chosen.version}`);
  const { dir, version } = chosen;
  // the version shown, sent to GitHub issues and compared by the updater is the package's
  app.getVersion = () => version;
  // the package's main calls this once its window has drawn: the start counts as good
  global.farmiesStarted = () => pkg.started(dir);
  try {
    require(path.join(dir, 'src', 'main.js'));
  } catch (e) {
    // broken package: never again, and this time the built-in code
    debug(`error boot package ${version}: ${e.stack || e}`);
    pkg.markBad(userData, version);
    delete app.getVersion;
    require('./main');
  }
} else {
  require('./main');
}
