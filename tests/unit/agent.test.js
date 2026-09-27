import test from 'node:test';
import assert from 'node:assert/strict';

const { agentReadiness, robotsBlockedAgents, AGENT_CHECKS } = await import('../../server/lib/agent.js');

/* ------------------------------------------------------------- robots.txt --- */

test('a blanket Disallow: / blocks the agents of its group', () => {
  assert.deepEqual(robotsBlockedAgents('User-agent: *\nDisallow: /').sort(), ['*']);
  assert.deepEqual(
    robotsBlockedAgents('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /').sort(),
    ['claudebot', 'gptbot'],
  );
});

test('partial rules, comments and Allow overrides are not a site-wide block', () => {
  assert.deepEqual(robotsBlockedAgents('User-agent: *\nDisallow: /api/\n# Disallow: /'), []);
  assert.deepEqual(robotsBlockedAgents('User-agent: *\nDisallow: /\nAllow: /products/'), []);
  assert.deepEqual(robotsBlockedAgents(''), []);
});

/* ------------------------------------------------------------ the checks --- */

const allPass = {
  violations: [],
  passes: ['button-name', 'link-name', 'label', 'select-name', 'landmark-one-main', 'heading-order', 'html-has-lang', 'html-lang-valid'].map((id) => ({ id })),
  incomplete: [],
};
const goodRaw = { title: 'Northline Goods', description: 'Trail gear', robots: '', links: { uncrawlable: 0 }, robotsTxt: { status: 200, blocked: [] } };
const goodSignals = { linkText: { value: true } };

test('a clean page passes all eight checks and scores 100', () => {
  const r = agentReadiness(allPass, goodRaw, goodSignals);
  assert.equal(r.total, AGENT_CHECKS.length);
  assert.equal(r.passed, r.total);
  assert.equal(r.score, 100);
});

test('a violated rule fails its check even when it also passed elsewhere', () => {
  const merged = { ...allPass, violations: [{ id: 'button-name' }] };
  const r = agentReadiness(merged, goodRaw, goodSignals);
  assert.equal(r.checks.find((c) => c.id === 'buttons').pass, false);
  assert.equal(r.score, Math.round((7 / 8) * 100));
});

test('checks that could not be evaluated are left out, not failed', () => {
  const merged = { ...allPass, passes: allPass.passes.filter((p) => p.id !== 'label' && p.id !== 'select-name') };
  const r = agentReadiness(merged, goodRaw, goodSignals);
  assert.equal(r.checks.some((c) => c.id === 'forms'), false, 'a page with no forms is not marked down');
  assert.equal(r.total, 7);
  assert.equal(r.score, 100);
});

test('noindex, a blanket robots block or an AI-crawler block fail "crawlers allowed"', () => {
  const fails = (raw) => agentReadiness(allPass, { ...goodRaw, ...raw }, goodSignals).checks.find((c) => c.id === 'crawlersAllowed');
  assert.equal(fails({ robots: 'noindex, nofollow' }).pass, false);
  assert.equal(fails({ robotsTxt: { status: 200, blocked: ['*'] } }).pass, false);
  const ai = fails({ robotsTxt: { status: 200, blocked: ['gptbot'] } });
  assert.equal(ai.pass, false);
  assert.match(ai.detail, /gptbot/);
  assert.equal(fails({ robotsTxt: { status: 200, blocked: ['some-seo-tool'] } }).pass, true, 'other bots do not count');
});

test('javascript: links, a missing description and vague link text are caught', () => {
  const r = agentReadiness(allPass, { ...goodRaw, description: '', links: { uncrawlable: 2 } }, { linkText: { value: false, detail: '3 of 9 links have vague text' } });
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(by.crawlableLinks.pass, false);
  assert.equal(by.summary.pass, false);
  assert.equal(by.links.pass, false);
  assert.match(by.links.detail, /vague/);
});
