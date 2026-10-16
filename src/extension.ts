import * as vscode from 'vscode';
import { collectDiff, getRepoRoot } from './git';
import { setBuiltInGitCommitMessage } from './git-api';
import { generateCommitMessage, loadLlmConfig } from './llm';

const GENERATING_CONTEXT_KEY = 'gitCommitMsg.isGenerating';

let activeRequest: AbortController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand('setContext', GENERATING_CONTEXT_KEY, false);
  context.subscriptions.push(
    vscode.commands.registerCommand('gitCommitMsg.generate', () =>
      runGenerate().catch((error) => showError(error))
    ),
    vscode.commands.registerCommand('gitCommitMsg.cancel', cancelGenerate)
  );
}

export function deactivate(): void {}

async function runGenerate(): Promise<void> {
  if (activeRequest) {
    return;
  }

  const workspaceFolder = resolveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a folder that contains a git repository first.');
    return;
  }

  const config = loadLlmConfig();
  if (!config.apiKey) {
    const choice = await vscode.window.showErrorMessage(
      'API key is not configured. Open the setting gitCommitMsgGen.apiKey (env:VAR_NAME is supported).',
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'gitCommitMsgGen.apiKey');
    }
    return;
  }

  let repoRoot: string;
  try {
    repoRoot = await getRepoRoot(workspaceFolder.uri.fsPath);
  } catch {
    vscode.window.showWarningMessage('The current folder is not a git repository.');
    return;
  }

  const diff = await collectDiff(repoRoot);
  if (!diff.text.trim()) {
    vscode.window.showInformationMessage('No staged or working tree changes found.');
    return;
  }

  const maxChars = vscode.workspace
    .getConfiguration('gitCommitMsgGen')
    .get<number>('maxDiffCharacters', 60000);
  const truncated = truncateDiff(diff.text, maxChars);

  const controller = new AbortController();
  activeRequest = controller;
  await vscode.commands.executeCommand('setContext', GENERATING_CONTEXT_KEY, true);

  try {
    const message = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating commit message...',
        cancellable: true,
      },
      (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return generateCommitMessage(config, truncated, controller.signal);
      }
    );

    await setCommitMessage(message, diff.source, repoRoot);
  } catch (error) {
    if (isAbortError(error)) {
      vscode.window.showInformationMessage('Commit message generation cancelled.');
    } else {
      throw error;
    }
  } finally {
    activeRequest = undefined;
    await vscode.commands.executeCommand('setContext', GENERATING_CONTEXT_KEY, false);
  }
}

function cancelGenerate(): void {
  activeRequest?.abort();
}

async function setCommitMessage(
  message: string,
  source: 'staged' | 'working-tree',
  repoRoot: string
): Promise<void> {
  const sourceLabel = source === 'staged' ? 'staged changes' : 'working tree changes';
  if (await setBuiltInGitCommitMessage(repoRoot, message)) {
    vscode.window.showInformationMessage(`Commit message generated from ${sourceLabel}.`);
    return;
  }

  if (vscode.scm.inputBox) {
    vscode.scm.inputBox.value = message;
    vscode.window.showInformationMessage(`Commit message generated from ${sourceLabel}.`);
    return;
  }

  // Some source control configurations do not expose the shared input box.
  await vscode.env.clipboard.writeText(message);
  await Promise.resolve(vscode.commands.executeCommand('workbench.scm.focus')).catch(
    () => undefined
  );
  const paste = await vscode.window.showInformationMessage(
    `Generated from ${sourceLabel}. The input box is unavailable, so the message was copied to the clipboard.`,
    'Paste'
  );
  if (paste === 'Paste') {
    await Promise.resolve(vscode.commands.executeCommand('editor.action.clipboardPasteAction')).catch(
      () => undefined
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function resolveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  if (vscode.window.activeTextEditor) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    if (folder) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return `${diff.slice(0, maxChars)}\n\n... diff truncated at ${maxChars} characters`;
}

function showError(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(`Commit message generation failed: ${detail}`);
}
