# Make declaration-backed Lens views useful

Lens has two kinds of input:

- **Code Explorer** follows the active file and uses the installed language service.
- **State Lifecycle** and **Configuration Resolution** read explicit repository declarations from `.atlasmind/lens-state.json` and `.atlasmind/lens-config.json`.

AtlasMind does not infer lifecycle transitions, configuration precedence, or secret values from an arbitrary source file. Use **Set Up Lens Declarations** to see each file's status, create a valid empty starter without overwriting anything, and open it with the extension's JSON Schema guidance and autocomplete.

The starter contains no invented project semantics. Add only declarations your repository can defend; leaving a view unconfigured is more honest than supplying a plausible but false model.
