# Robust GitHub Actions push step for sharded scrapes

Use this step after the scraping matrix finishes. It only commits when there are staged changes and retries on non-fast-forward errors without forcing pushes.

```yaml
deploy-changes:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - name: Configure git author
      run: |
        git config user.name "github-actions"
        git config user.email "github-actions@users.noreply.github.com"
    - name: Commit and push shard outputs
      env:
        MAX_PUSH_RETRIES: 5
        RETRY_DELAY: 8
      run: |
        set -euo pipefail
        # Stage only if there are differences
        if git diff --quiet && git diff --cached --quiet; then
          echo "No changes to commit"
          exit 0
        fi

        git status --short
        git commit -m "Update CT liquidation data (shard ${{ matrix.shard || 'N/A' }})" || {
          if git diff --cached --quiet; then
            echo "Nothing to commit after staging"
            exit 0
          fi
          echo "git commit failed"
          exit 1
        }

        attempt=1
        while [ "$attempt" -le "${MAX_PUSH_RETRIES}" ]; do
          echo "Push attempt $attempt/${MAX_PUSH_RETRIES}..."
          if git push origin main; then
            echo "Push succeeded"
            break
          fi

          echo "Push failed, rebasing and retrying..."
          git pull --rebase origin main || true
          attempt=$(( attempt + 1 ))
          if [ "$attempt" -le "${MAX_PUSH_RETRIES}" ]; then
            sleep "${RETRY_DELAY}"
          fi
        done

        if [ "$attempt" -gt "${MAX_PUSH_RETRIES}" ]; then
          echo "Giving up after ${MAX_PUSH_RETRIES} attempts"
          exit 1
        fi
```
