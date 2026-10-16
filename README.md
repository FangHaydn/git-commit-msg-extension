# Git Commit Message Generator (VSCode Extension)

Generate a git commit message from your changes using an LLM.

- If the index (staged changes) is non-empty, the staged diff is used.
- Otherwise the working tree diff (including untracked files) is used.
- Supported APIs: OpenAI-compatible Chat Completions, OpenAI Responses, Anthropic Messages.

## Usage

1. Configure the extension in VSCode Settings:

   ```json
   {
     "gitCommitMsgGen.provider": "openai-chat",
     "gitCommitMsgGen.baseUrl": "https://api.openai.com/v1",
     "gitCommitMsgGen.apiKey": "env:OPENAI_API_KEY",
     "gitCommitMsgGen.model": "gpt-4o-mini",
     "gitCommitMsgGen.language": "en",
     "gitCommitMsgGen.conventionalCommits.enabled": true,
     "gitCommitMsgGen.conventionalCommits.types": [
       "feat",
       "fix",
       "docs",
       "style",
       "refactor",
       "perf",
       "test",
       "build",
       "ci",
       "chore",
       "revert"
     ],
     "gitCommitMsgGen.conventionalCommits.scopeRequired": false,
     "gitCommitMsgGen.conventionalCommits.subjectMaxLength": 72,
     "gitCommitMsgGen.conventionalCommits.additionalInstructions": "Prefer repository-level scopes."
   }
   ```

   Set `gitCommitMsgGen.conventionalCommits.enabled` to `false` to generate free-form commit messages.

   For Anthropic:

   ```json
   {
     "gitCommitMsgGen.provider": "anthropic",
     "gitCommitMsgGen.baseUrl": "https://api.anthropic.com",
     "gitCommitMsgGen.apiKey": "env:ANTHROPIC_API_KEY",
     "gitCommitMsgGen.model": "claude-3-5-haiku-latest"
   }
   ```

2. Click the sparkle icon in the top-right action area of the Source Control view (next to other git actions).
3. While generating, the icon switches to a spinner; click it again to cancel.
4. The generated message is inserted directly into the input box.

## Build & package

```bash
npm install
npm run compile
npx @vscode/vsce package
```

Then install the generated `.vsix` file in VSCode.

```bash
code --install-extension /Users/fanghaidong/Projects/git-commit-msg-extension/git-commit-msg-extension-0.1.0.vsix --force
```
