#!/bin/sh

# Xcode Cloud build hook — runs immediately after the repo is cloned,
# before Swift Package resolution and xcodebuild.
#
# This is a Capacitor app, so the iOS build depends on two artifacts that
# are intentionally gitignored and therefore absent in Xcode Cloud's clean
# clone:
#   - node_modules/        CapApp-SPM/Package.swift references every plugin
#                          by local path (../../../node_modules/@capacitor/*),
#                          so SPM resolution fails without it.
#   - ios/App/App/public/  the built web app, copied in by `cap sync`.
# We regenerate both here.

set -e   # fail the build if any step fails
set -x   # echo commands into the Xcode Cloud build log for debugging

# Xcode Cloud images don't ship Node; install it via the preinstalled Homebrew.
brew install node

# This script runs from ci_scripts/; operate from the repo root instead.
cd "$CI_PRIMARY_REPOSITORY_PATH"

# Install JS deps (creates the node_modules the SPM packages point at).
# --include=dev guarantees Vite is present even if NODE_ENV=production.
npm ci --include=dev

# Build the web app (Vite -> dist/) and sync it into the iOS project,
# populating ios/App/App/public/ and the CapApp-SPM local plugin paths.
npm run build
npx cap sync ios
