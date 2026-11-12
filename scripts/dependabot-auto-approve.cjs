'use strict';

// This ruleset was checked with an administrator token: only the Dependabot
// integration can bypass its creation, update, and deletion restrictions.
// Bypass actors are not visible to the workflow token, so any ruleset edit
// requires re-auditing it and updating this timestamp in a reviewed change.
const RULESET_ID = 27071443;
const RULESET_UPDATED_AT = '2026-11-11T22:03:59.448Z';
const DEPENDABOT = 'dependabot[bot]';
const PROVENANCE_WORKFLOW = 'dependabot-branch-provenance.yml';
const REQUIRED_CHECKS = [
  'Coverage (v8)',
  'Test & build check (macos-latest)',
  'Test & build check (ubuntu-latest)',
  'Test & build check (windows-latest)',
];

async function verifyAndApprove({ github, context, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const { owner, repo } = context.repo;
  const eventPr = context.payload.pull_request;
  if (!eventPr || !['opened', 'synchronize'].includes(context.payload.action) ||
      context.payload.sender?.login !== DEPENDABOT || eventPr.user?.login !== DEPENDABOT) {
    throw new Error('Expected a Dependabot pull request event.');
  }

  const pull_number = eventPr.number;
  const expectedSha = eventPr.head.sha;
  const branch = eventPr.head.ref;
  const repository = `${owner}/${repo}`;
  if (!branch.startsWith('dependabot/') || eventPr.head.repo?.full_name !== repository ||
      eventPr.base.ref !== context.payload.repository.default_branch) {
    throw new Error('Pull request must target the default branch from a local Dependabot branch.');
  }

  const { data: ruleset } = await github.rest.repos.getRepoRuleset({
    owner, repo, ruleset_id: RULESET_ID,
  });
  if (ruleset.enforcement !== 'active' || ruleset.source !== repository ||
      Date.parse(ruleset.updated_at) !== Date.parse(RULESET_UPDATED_AT)) {
    throw new Error('Dependabot branch protection changed or is inactive; re-audit the ruleset.');
  }
  const rules = await github.paginate('GET /repos/{owner}/{repo}/rules/branches/{branch}', {
    owner, repo, branch, per_page: 100,
  });
  for (const type of ['creation', 'update', 'deletion']) {
    if (!rules.some(rule => rule.ruleset_id === RULESET_ID && rule.type === type)) {
      throw new Error(`Dependabot branch is missing the protected ${type} rule.`);
    }
  }

  const baseRules = await github.paginate('GET /repos/{owner}/{repo}/rules/branches/{branch}', {
    owner, repo, branch: eventPr.base.ref, per_page: 100,
  });
  const reviewRule = baseRules.find(rule => rule.type === 'pull_request' &&
    rule.parameters?.dismiss_stale_reviews_on_push === true &&
    rule.parameters.required_approving_review_count >= 1);
  const checkRule = baseRules.find(rule => rule.type === 'required_status_checks' &&
    rule.parameters?.strict_required_status_checks_policy === true &&
    REQUIRED_CHECKS.every(name => rule.parameters.required_status_checks?.some(check =>
      check.context === name && check.integration_id === 15368)));
  if (!reviewRule || !checkRule) {
    throw new Error('Default branch is missing the required review or CI protections.');
  }

  // Only a successful create-event workflow for this branch, after the audited
  // ruleset was installed, establishes that the branch was born protected.
  let trustedCreation = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner, repo, workflow_id: PROVENANCE_WORKFLOW, branch, event: 'create', per_page: 100,
    });
    trustedCreation = runs.some(run =>
      run.head_branch === branch && run.event === 'create' &&
      run.actor?.login === DEPENDABOT && run.status === 'completed' &&
      run.conclusion === 'success' && Date.parse(run.created_at) > Date.parse(RULESET_UPDATED_AT)
    );
    if (trustedCreation) { break; }
    if (attempt < 23) { await sleep(5000); }
  }
  if (!trustedCreation) {
    throw new Error('No trusted branch-creation record; review manually or recreate the branch under protection.');
  }

  const { data: currentPr } = await github.rest.pulls.get({ owner, repo, pull_number });
  if (currentPr.state !== 'open' || currentPr.head.sha !== expectedSha ||
      currentPr.head.ref !== branch || currentPr.head.repo?.full_name !== repository ||
      currentPr.user?.login !== DEPENDABOT || currentPr.base.ref !== eventPr.base.ref) {
    throw new Error('Pull request changed since the event; refusing to approve.');
  }

  const commits = await github.paginate(github.rest.pulls.listCommits, {
    owner, repo, pull_number, per_page: 100,
  });
  if (commits.length === 0 || !commits.some(commit => commit.sha === expectedSha)) {
    throw new Error('Pull request commits do not include the expected head.');
  }
  for (const commit of commits) {
    if (commit.author?.login !== DEPENDABOT ||
        ![DEPENDABOT, 'web-flow'].includes(commit.committer?.login)) {
      throw new Error(`Unexpected author or committer on ${commit.sha}.`);
    }
    const result = await github.graphql(`
      query($owner: String!, $repo: String!, $oid: GitObjectID!) {
        repository(owner: $owner, name: $repo) {
          object(oid: $oid) {
            ... on Commit {
              signature { isValid wasSignedByGitHub }
            }
          }
        }
      }
    `, { owner, repo, oid: commit.sha });
    const signature = result.repository?.object?.signature;
    if (signature?.isValid !== true || signature.wasSignedByGitHub !== true) {
      throw new Error(`Commit ${commit.sha} does not have a valid GitHub signature.`);
    }
  }

  const { data: latestPr } = await github.rest.pulls.get({ owner, repo, pull_number });
  if (latestPr.state !== 'open' || latestPr.head.sha !== expectedSha || latestPr.head.ref !== branch ||
      latestPr.base.ref !== eventPr.base.ref) {
    throw new Error('Pull request changed during verification; refusing to approve.');
  }
  await github.rest.pulls.createReview({
    owner, repo, pull_number, commit_id: expectedSha, event: 'APPROVE',
  });
  return expectedSha;
}

module.exports = { verifyAndApprove };
