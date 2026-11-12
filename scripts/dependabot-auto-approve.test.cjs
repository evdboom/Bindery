'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyAndApprove } = require('./dependabot-auto-approve.cjs');

function fixture() {
  const repo = 'evdboom/Bindery';
  const branch = 'dependabot/npm_and_yarn/example';
  const pr = {
    number: 42, state: 'open', user: { login: 'dependabot[bot]' },
    head: { sha: 'abc', ref: branch, repo: { full_name: repo } },
    base: { ref: 'main' },
  };
  const state = {
    pr,
    ruleset: { enforcement: 'active', source: repo, updated_at: '2026-11-11T22:03:59.448Z' },
    rules: ['creation', 'update', 'deletion'].map(type => ({ ruleset_id: 27071443, type })),
    baseRules: [
      { type: 'pull_request', parameters: { dismiss_stale_reviews_on_push: true, required_approving_review_count: 1 } },
      { type: 'required_status_checks', parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: ['Coverage (v8)', 'Test & build check (macos-latest)',
          'Test & build check (ubuntu-latest)', 'Test & build check (windows-latest)']
          .map(context => ({ context, integration_id: 15368 })),
      } },
    ],
    runs: [{
      head_branch: branch, event: 'create', actor: { login: 'dependabot[bot]' },
      status: 'completed', conclusion: 'success', created_at: '2026-11-11T22:04:01Z',
    }],
    commits: [{ sha: 'abc', author: { login: 'dependabot[bot]' }, committer: { login: 'web-flow' } }],
    signature: { isValid: true, wasSignedByGitHub: true },
    reviews: [],
  };
  const listWorkflowRuns = () => {};
  const listCommits = () => {};
  const github = {
    rest: {
      repos: { getRepoRuleset: async () => ({ data: state.ruleset }) },
      actions: { listWorkflowRuns },
      pulls: {
        get: async () => ({ data: state.pr }), listCommits,
        createReview: async review => { state.reviews.push(review); },
      },
    },
    paginate: async (method, options) => {
      if (method === 'GET /repos/{owner}/{repo}/rules/branches/{branch}') {
        return options.branch === 'main' ? state.baseRules : state.rules;
      }
      if (method === listWorkflowRuns) { return state.runs; }
      if (method === listCommits) { return state.commits; }
      throw new Error('Unexpected paginated request');
    },
    graphql: async () => ({ repository: { object: { signature: state.signature } } }),
  };
  const context = {
    repo: { owner: 'evdboom', repo: 'Bindery' },
    payload: {
      action: 'opened', sender: { login: 'dependabot[bot]' },
      pull_request: structuredClone(pr), repository: { default_branch: 'main' },
    },
  };
  return { github, context, state, sleep: async () => {} };
}

test('approves the verified head from a protected, bot-created branch', async () => {
  const f = fixture();
  assert.equal(await verifyAndApprove(f), 'abc');
  assert.equal(f.state.reviews.length, 1);
  assert.equal(f.state.reviews[0].commit_id, 'abc');
  assert.equal(f.state.reviews[0].event, 'APPROVE');
});

test('rejects a human event even on a Dependabot PR', async () => {
  const f = fixture();
  f.context.payload.sender.login = 'someone';
  await assert.rejects(verifyAndApprove(f), /Dependabot pull request event/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects a Dependabot PR from a fork or a non-Dependabot branch', async () => {
  const f = fixture();
  f.context.payload.pull_request.head.repo.full_name = 'other/Bindery';
  await assert.rejects(verifyAndApprove(f), /local Dependabot branch/);
  f.context.payload.pull_request.head.repo.full_name = 'evdboom/Bindery';
  f.context.payload.pull_request.head.ref = 'feature/example';
  await assert.rejects(verifyAndApprove(f), /local Dependabot branch/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects changed or missing branch protection', async () => {
  const f = fixture();
  f.state.ruleset.updated_at = '2026-11-11T22:05:00Z';
  await assert.rejects(verifyAndApprove(f), /re-audit/);
  f.state.ruleset.updated_at = '2026-11-11T22:03:59.448Z';
  f.state.rules = f.state.rules.filter(rule => rule.type !== 'update');
  await assert.rejects(verifyAndApprove(f), /missing the protected update rule/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects branches without a successful protected Dependabot creation', async () => {
  const f = fixture();
  f.state.runs[0].actor.login = 'someone';
  await assert.rejects(verifyAndApprove(f), /No trusted branch-creation record/);
  f.state.runs[0].actor.login = 'dependabot[bot]';
  f.state.runs[0].created_at = '2026-11-11T22:03:00Z';
  await assert.rejects(verifyAndApprove(f), /No trusted branch-creation record/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects missing default-branch review or CI safeguards', async () => {
  const f = fixture();
  f.state.baseRules[0].parameters.dismiss_stale_reviews_on_push = false;
  await assert.rejects(verifyAndApprove(f), /required review or CI protections/);
  f.state.baseRules[0].parameters.dismiss_stale_reviews_on_push = true;
  f.state.baseRules[1].parameters.required_status_checks.pop();
  await assert.rejects(verifyAndApprove(f), /required review or CI protections/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects modified PR heads and foreign commits or signatures', async () => {
  const f = fixture();
  f.state.pr.head.sha = 'changed';
  await assert.rejects(verifyAndApprove(f), /changed since the event/);
  f.state.pr.head.sha = 'abc';
  f.state.commits.push({ sha: 'injected', author: { login: 'someone' }, committer: { login: 'web-flow' } });
  await assert.rejects(verifyAndApprove(f), /Unexpected author or committer/);
  f.state.commits.pop();
  f.state.signature.wasSignedByGitHub = false;
  await assert.rejects(verifyAndApprove(f), /valid GitHub signature/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects a head that changes while commit signatures are being checked', async () => {
  const f = fixture();
  f.github.graphql = async () => {
    f.state.pr.head.sha = 'changed';
    return { repository: { object: { signature: f.state.signature } } };
  };
  await assert.rejects(verifyAndApprove(f), /changed during verification/);
  assert.equal(f.state.reviews.length, 0);
});

test('rejects a PR retargeted while commit signatures are being checked', async () => {
  const f = fixture();
  f.github.graphql = async () => {
    f.state.pr.base.ref = 'unprotected';
    return { repository: { object: { signature: f.state.signature } } };
  };
  await assert.rejects(verifyAndApprove(f), /changed during verification/);
  assert.equal(f.state.reviews.length, 0);
});
