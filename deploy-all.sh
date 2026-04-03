#!/bin/bash
# Deploy both QBIM bot and stats dashboard in one command.
# Run from the qbim-bot directory: bash deploy-all.sh

set -e

SAM="/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd"
BOT_DIR="/c/Users/Joe/source/repos/qbim-bot"
DASH_DIR="/c/Users/Joe/source/repos/qbim-stats-dashboard"
API_URL="https://jqoyoafk29.execute-api.us-east-1.amazonaws.com/prod/stats"

echo "=== Deploying QBIM Bot ==="
cd "$BOT_DIR"
"$SAM" build
"$SAM" deploy
echo "Bot deployed."

echo ""
echo "=== Deploying Stats Dashboard ==="
cd "$DASH_DIR"
REACT_APP_API_URL="$API_URL" npx react-scripts build
MSYS_NO_PATHCONV=1 aws s3 sync build/ s3://qbim-stats-dashboard --delete
echo "Dashboard deployed."

echo ""
echo "=== All done! ==="
