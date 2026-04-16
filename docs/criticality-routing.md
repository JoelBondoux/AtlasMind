────────────────────────────────────────
Criticality-Aware Routing Documentation
────────────────────────────────────────

Overview
========
Criticality-aware routing optimizes task execution by determining the criticality level of a task and routing it to the most appropriate LLM. It balances speed, cost, and quality by dynamically selecting one of three modes: Cheap, Balanced, or Quality.

Key Concepts
------------
• Cheap Mode: Prioritizes speed and cost efficiency, ideal for low-criticality tasks.
• Balanced Mode: The default setting offering a balance between speed, cost, and quality for tasks with moderate criticality.
• Quality Mode: Ensures the highest quality output for high-criticality tasks, albeit with higher resource usage.

How It Works
============
The routing engine assesses each task's description and metadata to determine its criticality using both configurable patterns and explicit overrides:

1. Configurable Patterns: The system scans the task description for keywords or regular expressions that correlate with predefined criticality levels. Patterns are defined in a routing configuration file (e.g., routing-config.json or routing-config.yaml).

2. Explicit Overrides: Developers can manually set a task's criticality by including a "criticality" parameter in the task payload, forcing the routing engine to use the specified mode.

Based on this evaluation, tasks are routed according to the following modes:

• Cheap Mode: Uses cost-effective, high-speed LLM options with adequate quality for non-critical tasks.
• Balanced Mode: Provides a compromise by balancing cost, speed, and output quality for the majority of tasks.
• Quality Mode: Engages high-quality LLM configurations for tasks that demand superior output quality, even at higher cost or slower processing times.

Configuring Criticality Patterns
=================================
You can customize the automatic evaluation of task criticality in your project’s routing configuration file. For example, a JSON configuration might look like this:

-------------------------------------------------
{
  "criticalityPatterns": [
    {
      "pattern": "urgent|critical|blocker",
      "modeOverride": "Quality"
    },
    {
      "pattern": "low|minor|info",
      "modeOverride": "Cheap"
    }
  ],
  "defaultCriticality": "Balanced"
}
-------------------------------------------------
In this configuration:
- Tasks matching patterns such as "urgent", "critical", or "blocker" are routed using Quality Mode.
- Tasks with words like "low", "minor", or "info" are handled in Cheap Mode.
- All other tasks default to Balanced Mode.

Default Behavior in Routing Modes
==================================
The system’s behavior for each routing mode is as follows:

• Cheap Mode:
  - Targets tasks with low criticality, emphasizing faster, cost-effective responses with a potential trade-off in output refinement.

• Balanced Mode:
  - Acts as the default routing mode. Tasks are processed here when no explicit criticality is provided and no matching patterns are found.

• Quality Mode:
  - Reserved for high-criticality tasks that demand top quality output. This mode may involve increased resource usage or processing time.

Explicitly Setting Criticality
================================
In addition to pattern-based evaluation, tasks can manually override the detected criticality by specifying it explicitly. This is particularly useful in scenarios where task context does not align well with predefined patterns.

Example API Call Override (JSON):
-------------------------------------------------
{
  "taskDescription": "Run end-to-end tests on new feature",
  "criticality": "Quality"
}
-------------------------------------------------
This explicit setting directs the routing engine to process the task using Quality Mode, regardless of any automatic detection.

Summary
=======
Criticality-aware routing provides a robust mechanism to align task importance with the appropriate LLM configuration. By leveraging both configurable patterns and explicit overrides, the system ensures that:

• Tasks receive processing commensurate with their urgency and importance.
• Resource usage is optimized, balancing performance, cost, and quality.
• Developers have the flexibility to directly influence routing decisions as needed.

For further configuration details and integration tips, consult the main routing documentation and your project’s configuration guides.