## Contributing

This repo is governed by Pictify's [Git workflow hard rules](https://github.com/pictify-io/.github/blob/master/CONTRIBUTING.md). After cloning, point Git at the in-repo hooks once:

```sh
git config core.hooksPath scripts/githooks
```

That installs the `pre-push` hook which refuses direct pushes to `master`/`main`. All changes go through a pull request reviewed by a code owner (see `.github/CODEOWNERS`).
