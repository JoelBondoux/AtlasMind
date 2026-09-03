Feature: Safe commerce project bootstrap
  AtlasMind must create a reviewable commerce project plan without executing hidden
  network commands or letting a project name become a path or source-code boundary.

  Scenario: Generate a bounded WooCommerce extension plan
    Given a developer selects the WooCommerce extension template
    When AtlasMind plans the files for an extension named "Order Notes"
    Then every planned path is relative and unique
    And the plugin declares WooCommerce and refuses direct PHP access
    And compatibility and privacy records begin as not assessed

  Scenario: Treat a project name as data
    Given a project name contains traversal, Unicode, and a PHP comment terminator
    When AtlasMind plans the WooCommerce extension files
    Then the generated slug is bounded to a safe relative filename
    And the plugin header cannot be escaped by the supplied name

  Scenario: Hand off Catalyst generation without cloning upstream
    Given a developer selects the BigCommerce Catalyst template
    When AtlasMind plans the project files
    Then it records the official generator and its prerequisites
    And it creates no guessed executable storefront source
    And compatibility and privacy remain not assessed

  Scenario: Generate an inert Magento module contract
    Given a developer selects the Magento 2 module template
    When AtlasMind plans the files for a module whose name starts with a number
    Then registration, module XML, and Composer metadata use one valid identifier
    And CI checks syntax and the scaffold contract without installing the module

  Scenario: Keep Wix provisioning under operator control
    Given a developer selects the Wix Commerce template
    When AtlasMind plans the project files
    Then the official generator command disables install, Git, and publish side effects
    And the handoff discloses the remote Wix resources it will still provision
