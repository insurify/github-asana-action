
# Github-Asana action

This action integrates asana with github.

### Prerequisites

- Asana account with the permission on the particular project you want to integrate with.
- Must provide the task url in the PR description.

## Inputs

### `asana-pat`

**Required** Your public access token of asana, you can find it in [asana docs](https://developers.asana.com/docs/#authentication-basics).

### `trigger-phrase`

**Required** Prefix before the task i.e ASANA TASK: https://app.asana.com/1/2/3/.

### `task-comment`

**Optional** If any comment is provided, the action will add a comment to the specified asana task with the text & pull request link.

### `target-section`

**Optional** Add/Move the task to the provided section i.e `merged`, `review`.


## Example usage

```yaml
uses: https://github.com/insurify/github-actions@master
with:
  asana-pat: 'Your PAT'
  target-section: 'In Review'
  task-comment: 'View Pull Request Here: '
  trigger-phrase: 'Asana Task:'
```