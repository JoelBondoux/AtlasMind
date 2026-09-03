Feature: Safety-first mobile bootstrap prefabs
  AtlasMind should cover maintained mobile application paths without silently
  installing dependencies, generating native projects, using cloud services, or publishing a build.

  Scenario: Hand off every mobile generator without executing it
    Given the React Native, Expo, and Flutter mobile prefabs
    When AtlasMind builds their template plans
    Then each plan contains only reviewable documentation
    And every command uses literal placeholders instead of project-name shell text
    And privacy and compatibility evidence begins Not assessed

  Scenario: Prefer a framework for a new React Native application
    Given a new React Native application
    When AtlasMind builds the bare Community CLI handoff
    Then it records React Native's framework-first recommendation
    And it requires a written constraint before the project owns both native toolchains

  Scenario: Keep Expo native generation and cloud services explicit
    Given a new Expo application
    When AtlasMind builds the Expo handoff
    Then dependency installation and generated agent instructions are disabled
    And Continuous Native Generation and optional EAS services remain separate decisions

  Scenario: Disclose Flutter naming and dependency retrieval
    Given a new Flutter application
    When AtlasMind builds the Flutter handoff
    Then the Dart package name follows lowercase_with_underscores
    And the handoff states that project initialization retrieves dependencies
