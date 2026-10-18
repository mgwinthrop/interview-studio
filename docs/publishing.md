# Publishing to Michael’s personal GitHub

Prepared destination: `mgwinthrop/mg-interview-studio` (public).

Authenticate the GitHub CLI as `mgwinthrop`:

```sh
gh auth login --hostname github.com --git-protocol https --web
gh api user --jq .login
```

The second command must return `mgwinthrop`. From this repository:

```sh
gh repo create mgwinthrop/mg-interview-studio --public --source=. --remote=origin --push --description "Voice-first interview practice with an animated AI interviewer"
```

The checkout has a clean initial commit containing only the prepared source. The original repository and its history are not changed or published. No license has been chosen for the pre-existing code; preserve the provenance in the README.

Verification: 106 backend tests passed, frontend lint passed, frontend/backend builds passed, and focused audio playback checks passed. The frontend build reports existing ONNX bundling warnings. Live provider integration and a browser preview have not been verified in this environment.
