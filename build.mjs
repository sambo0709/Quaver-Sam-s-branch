/**
 * Quaver build: concatenate + minify + content-hash the front-end assets.
 *
 * The front end has no module system — every file is a classic <script> that
 * shares global scope, and inline on* handlers in the HTML call those globals by
 * name. So the JS is concatenated in the exact <script> order and only
 * whitespace-minified (never identifier-mangled). CSS is fully minified.
 *
 * Output goes to dist/ (a full built copy of public/). server.js serves dist/
 * when dist/Index.html exists, otherwise public/ — so the site still runs
 * unbundled if this never ran.
 *
 * Keep APP_SCRIPTS in sync with the <script> tags in public/Index.html.
 */
import esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const SRC = 'public';
const OUT = 'dist';

// The app shell (Index.html), in load order. Order is load-bearing:
// home-core.js defines shared script-scope bindings used by later home-*.js files.
const APP_SCRIPTS = [
  'app-shell.js',
  'search.js',
  'mood-collections.js',
  'playlists.js',
  'discover.js',
  'profile-core.js',
  'profile-player.js',
  'profile-data.js',
  'profile-story.js',
  'settings.js',
  'archive.js',
  'taste-ui.js',
  'home-core.js',
  'home-state.js',
  'home-recommendations.js',
  'home-personalization.js',
  'home-session.js',
  'home-player.js',
  'home-playlists.js',
  'home-search-ui.js',
  'mood-pad.js',
  'spotify-player.js',
];

// Local module scripts that a template page may still list but that the shell
// already loads. When such a page is used as an SPA view template only its
// elements are imported (scripts never execute), so these tags are dead weight.
const TEMPLATE_DEAD_SCRIPTS = new Set(
  APP_SCRIPTS.filter((f) => f !== 'spotify-player.js'),
);

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

async function bundleJs(files, name) {
  const parts = [];
  for (const f of files) {
    parts.push(`/* ${f} */\n${await readFile(path.join(SRC, f), 'utf8')}\n`);
  }
  const { code } = await esbuild.transform(parts.join('\n;\n'), {
    loader: 'js',
    // Whitespace only: syntax/identifier minification is deliberately off because
    // top-level function declarations must stay reachable as window globals.
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    legalComments: 'none',
  });
  const outName = `${name}.${hash(code)}.js`;
  await writeFile(path.join(OUT, outName), code);
  return outName;
}

async function bundleCss(file, name) {
  const { code } = await esbuild.transform(await readFile(path.join(SRC, file), 'utf8'), {
    loader: 'css',
    minify: true,
    legalComments: 'none',
  });
  const outName = `${name}.${hash(code)}.css`;
  await writeFile(path.join(OUT, outName), code);
  return outName;
}

function rewriteHtml(html, file, assets) {
  html = html.replace(/href="\/?styles\.css"/g, `href="/${assets.css}"`);

  if (file.toLowerCase() === 'index.html') {
    for (const s of APP_SCRIPTS) {
      html = html.replace(new RegExp(`\\s*<script src="${s}"></script>`, 'g'), '');
    }
    html = html.replace('</body>', `<script src="/${assets.appJs}"></script>\n</body>`);
    return html;
  }

  if (file.toLowerCase() === 'share.html') {
    // The only non-shell page that still executes JS.
    html = html.replace(
      /<script src="spotify-player\.js"><\/script>/g,
      `<script src="/${assets.shareJs}"></script>`,
    );
  } else {
    // Template pages: the shell already loads every module, and scripts never
    // run when the page is imported as a view. Drop the dead tags.
    for (const s of [...TEMPLATE_DEAD_SCRIPTS, 'spotify-player.js']) {
      html = html.replace(new RegExp(`\\s*<script src="${s}"></script>`, 'g'), '');
    }
  }
  return html;
}

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, {
    recursive: true,
    filter: (src) => !src.endsWith('.DS_Store'),
  });

  const assets = {
    appJs: await bundleJs(APP_SCRIPTS, 'app'),
    css: await bundleCss('styles.css', 'styles'),
    shareJs: await bundleJs(['spotify-player.js'], 'share'),
  };

  for (const f of new Set([...APP_SCRIPTS, 'spotify-player.js', 'styles.css'])) {
    await rm(path.join(OUT, f), { force: true });
  }

  for (const hf of (await readdir(OUT)).filter((f) => f.endsWith('.html'))) {
    const p = path.join(OUT, hf);
    await writeFile(p, rewriteHtml(await readFile(p, 'utf8'), hf, assets));
  }

  await writeFile(
    path.join(OUT, 'asset-manifest.json'),
    `${JSON.stringify({ 'app.js': assets.appJs, 'styles.css': assets.css, 'share.js': assets.shareJs }, null, 2)}\n`,
  );
  console.log('[build] dist/ ready:', assets);
}

run().catch((err) => {
  console.error('[build] failed:', err);
  process.exit(1);
});
