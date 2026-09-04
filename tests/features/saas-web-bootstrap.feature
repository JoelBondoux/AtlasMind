Feature: Safety-first SaaS and web bootstrap prefabs
  AtlasMind should accelerate common web stacks without silently accepting
  package, identity, database, repository, or deployment side effects.

  Scenario: Hand off maintained application generators without executing them
    Given the Next.js, React Router, Laravel, Django, and Astro content prefabs
    When AtlasMind builds their template plans
    Then each plan contains only reviewable documentation
    And every command uses literal placeholders instead of project-name shell text
    And the handoff names the effects that remain under operator control

  Scenario: Use the maintained React Router path for Remix applications
    Given a new Remix-style application
    When AtlasMind builds the React Router prefab
    Then the handoff names create-react-router
    And it does not direct the operator to the retired create-remix generator

  Scenario: Generate a dependency-free static website contract
    Given a hostile project name containing HTML markup
    When AtlasMind builds the static-site prefab
    Then the project name is escaped before reaching HTML
    And the site has no inline script or style
    And Node's built-in test runner enforces the accessibility and CSP contract
    And the CI workflow has read-only repository permissions

  Scenario: Keep content ownership explicit for a blog or CMS
    Given the Astro content prefab
    When AtlasMind builds its generator handoff
    Then dependency installation, Git initialization, and external agent instructions are disabled
    And repository-owned, build-time remote, and live CMS content remain explicit choices
