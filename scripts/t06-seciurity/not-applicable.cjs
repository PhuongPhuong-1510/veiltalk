// Source inventory evidence for conditional scenarios in the T06 specification.
module.exports = new Map([
  ['AUTH-022', 'No password reset/update endpoint exists in the current AuthController or UserProfileController; the scenario explicitly permits N/A in that case.'],
  ['SUPPLY-006', 'No CI workflow or pipeline manifest exists in the current repository; there is no CI credential scope to inspect yet. Reopen when CI is added.'],
]);
