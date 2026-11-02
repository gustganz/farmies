// Problems the app cannot fix by itself: shown in a dialog, with a prefilled GitHub issue the user
// only has to send (nothing is sent without them).
const os = require('os');

const ISSUES = 'https://github.com/gustganz/farmies/issues/new';
const MAX_URL = 7000; // browsers and GitHub cut longer URLs

/** Link to a new GitHub issue with this title and body (the body shortened to fit into a URL). */
function issueUrl(title, body) {
  const url = (text) => `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
  let text = body;
  while (url(text).length > MAX_URL && text.length > 200) text = `${text.slice(0, Math.floor(text.length * 0.8))}\n…`;
  return url(text);
}

/** The facts every report needs. */
function environment(version) {
  return [`- Farmies: ${version}`, `- System: ${process.platform} ${os.release()} (${process.arch})`];
}

const EDITOR_NAMES = { cursor: 'Cursor', vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', windsurf: 'Windsurf' };
const editorName = (term) => EDITOR_NAMES[term] || term;

/**
 * A click found no window of the editor the session runs in.
 * windows: what the companion extension reports (see editor-focus.js).
 */
function windowNotFound(s, windows, version) {
  const editor = editorName(s.term);
  const outdated = windows.filter((w) => !Array.isArray(w.shells));
  if (outdated.length) {
    // the new extension is installed, but the window still runs the old one until it reloads
    return {
      message: `${editor}-Fenster bitte einmal neu laden`,
      detail:
        `In ${editor} läuft noch die alte Farmies-Erweiterung. Nach dem Neuladen findet ein Klick ` +
        'das Fenster der Session wieder.\n\nBefehlspalette (Strg+Umschalt+P) → „Developer: Reload Window“',
    };
  }
  return {
    message: `Farmies findet das ${editor}-Fenster dieser Session nicht`,
    detail: 'Bitte melde das, damit es behoben werden kann. Du siehst den Text vor dem Absenden.',
    issue: {
      title: `Klick findet das ${editor}-Fenster nicht`,
      body: [
        `Ein Klick auf eine Blase hat das ${editor}-Fenster der Session nicht gefunden.`,
        '',
        ...environment(version),
        `- Editor: ${editor}${s.distro ? ` (WSL: ${s.distro})` : ''}`,
        `- Fenster, die die Farmies-Erweiterung meldet: ${windows.length}` +
          (windows.length ? ` (Versionen: ${[...new Set(windows.map((w) => w.version || 'alt'))].join(', ')})` : ''),
        `- Prozesse der Session: ${s.pids.length}`,
      ].join('\n'),
    },
  };
}

// install places (see hooks.js): WSL editor servers and macOS editors
const PLACES = {
  '.cursor-server': 'Cursor (WSL)', '.vscode-server': 'VS Code (WSL)', '.vscode-server-insiders': 'VS Code Insiders (WSL)',
  '.windsurf-server': 'Windsurf (WSL)', '.cursor': 'Cursor', '.vscode': 'VS Code', '.vscode-insiders': 'VS Code Insiders', '.windsurf': 'Windsurf',
};

/** The companion extension could not be installed into these editor servers. */
function extensionInstallFailed(failures, version) {
  const names = failures.map((f) => PLACES[f.editor] || f.editor).join(', ');
  return {
    message: 'Farmies konnte seine Erweiterung nicht installieren',
    detail:
      `Betroffen: ${names}. Ohne die Erweiterung findet ein Klick das Fenster einer Session nicht ` +
      'immer. Bitte melde das, damit es behoben werden kann. Du siehst den Text vor dem Absenden.',
    issue: {
      title: `Erweiterung lässt sich nicht installieren (${names})`,
      body: [
        'Farmies konnte seine Begleit-Erweiterung nicht installieren.',
        '',
        ...environment(version),
        '',
        ...failures.flatMap((f) => [`**${PLACES[f.editor] || f.editor}** (\`${f.editor}\`)`, '```', f.output || '(keine Ausgabe)', '```']),
      ].join('\n'),
    },
  };
}

module.exports = { issueUrl, windowNotFound, extensionInstallFailed };
