# Code signing policy

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.**

Windows installers released from this repository are signed with a certificate issued to the
SignPath Foundation. This page describes who may trigger a signed build and under which rules.

## Project

- Project: Mocu — desktop AI workspace
- Repository: https://github.com/kharchangai/Mocu
- License: Apache License 2.0 (https://github.com/kharchangai/Mocu/blob/main/LICENSE)
- Releases / download page: https://github.com/kharchangai/Mocu/releases
- Privacy policy: https://github.com/kharchangai/Mocu/blob/main/PRIVACY.md

## Team and roles

| Role | Member |
|---|---|
| Author (writes the code) | Meysam (GitHub: [@kharchangai](https://github.com/kharchangai)) |
| Reviewer (reviews the release) | Meysam (GitHub: [@kharchangai](https://github.com/kharchangai)) |
| Approver (approves the signing request) | Meysam (GitHub: [@kharchangai](https://github.com/kharchangai)) |

Mocu is maintained by a single maintainer. Multi-factor authentication is enabled on the
GitHub account listed above, and it is required for any account that can approve a signing
request in SignPath.

## What is signed

Only Windows installers and executables that are built from this repository's source code by
the GitHub Actions release workflow (`.github/workflows/release.yml`) on GitHub-hosted
runners are submitted for signing. No third-party binaries, no locally built files, and no
artifacts from forks are signed.

## Process

1. A release is prepared by pushing a version tag (`v*`), which starts the release workflow.
2. The workflow builds the Windows bundles. The build is the only source of the signed files.
3. The signing request is **approved manually** by the approver listed above. No build is
   signed automatically without that review.
4. The signed installer is published on the project's GitHub Releases page.

## Verification

You can confirm a downloaded installer was signed by the SignPath Foundation from Windows
PowerShell:

```powershell
Get-AuthenticodeSignature .\Mocu_*_x64-setup.exe | Select-Object Status, SignerCertificate
```

`Status` should read `Valid` and the signer should be the SignPath Foundation.

## Contact

Questions about this policy: https://github.com/kharchangai/Mocu/issues