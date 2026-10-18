# Publishing source changes

The source repository is [mgwinthrop/interview-studio](https://github.com/mgwinthrop/interview-studio).

## Before publishing

- Review the diff and confirm that credentials, session data and environment-specific settings are excluded.
- Run the verification commands in the root README.
- Confirm that your GitHub account has write access to the destination repository.

## Push a branch

From the repository checkout:

```sh
git status
git remote -v
git push origin HEAD
```

For contributions, push a branch to a fork and open a pull request against the source repository.

Publishing source code does not deploy the application. See [local setup and deployment](local-setup.md) to run or host the tool. The current prototype requires access controls before public hosting.
