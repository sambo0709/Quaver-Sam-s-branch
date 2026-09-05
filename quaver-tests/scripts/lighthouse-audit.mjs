import { spawn } from 'node:child_process';
import process from 'node:process';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';
let server;

async function isReady() {
  try {
    const response = await fetch(origin + '/api/health');
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Quaver did not start in time.');
}

try {
  if (!(await isReady())) {
    server = spawn('npm', ['start'], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'ignore',
    });
    await waitForServer();
  }

  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const result = await lighthouse(origin, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
    if (!result) throw new Error('Lighthouse did not return a report.');

    const scores = Object.fromEntries(Object.entries(result.lhr.categories).map(([key, category]) => {
      return [key, Math.round((category.score || 0) * 100)];
    }));
    console.log(JSON.stringify(scores, null, 2));

    const minimums = { performance: 70, accessibility: 90, 'best-practices': 90, seo: 80 };
    const failures = Object.entries(minimums).filter(([key, minimum]) => scores[key] < minimum);
    if (failures.length) {
      throw new Error('Lighthouse thresholds missed: ' + failures.map(([key, minimum]) => key + ' ' + scores[key] + ' < ' + minimum).join(', '));
    }
  } finally {
    await chrome.kill();
  }
} finally {
  if (server) server.kill('SIGTERM');
}
