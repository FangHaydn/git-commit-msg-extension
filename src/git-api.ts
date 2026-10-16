import * as vscode from 'vscode';

interface GitInputBox {
  value: string;
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: GitInputBox;
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/**
 * Writes to the built-in Git extension's input box. The public vscode.scm.inputBox
 * is only for an extension's own source controls, not VS Code's built-in Git view.
 */
export async function setBuiltInGitCommitMessage(
  repoRoot: string,
  message: string
): Promise<boolean> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    return false;
  }

  const exports = extension.isActive ? extension.exports : await extension.activate();
  const api = exports.getAPI(1);
  const repository = api.repositories.find(
    (repo) => repo.rootUri.fsPath === repoRoot
  );
  if (!repository) {
    return false;
  }

  repository.inputBox.value = message;
  return true;
}
