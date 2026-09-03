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
